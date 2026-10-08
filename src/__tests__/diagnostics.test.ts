import request from 'supertest';
import nock from 'nock';
import app from '../server';
import { config } from '../config';
import { executeUpstreamRequest } from '../services/upstreamProxy';

const TEST_UPSTREAM = 'http://test-upstream.local';

describe('Student Login Support - Single-Page Workflow Test Suite', () => {
  beforeAll(() => {
    config.upstreamBaseUrl = TEST_UPSTREAM;
    config.supportRetryDelayMs = 0; // instant retries in tests
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // 1. Health check
  it('health endpoint returns status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'student-support' });
  });

  // 2. Input validation
  it('validates mobile number and rejects invalid inputs with 400', async () => {
    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ mobile: '123' }); // too short

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  // 3. Complete 3-step authorized upstream workflow
  it('executes full authorized workflow and captures diagnostic events', async () => {
    nock(TEST_UPSTREAM)
      .post('/authorized/login-support').reply(200, {
        studentId: 'STU9981',
        status: 'PENDING_VERIFICATION',
        token: 'secret-auth-token-12345', // should be redacted
      })
      .post('/authorized/verification-state').reply(200, {
        state: 'SMS_SENT',
        otpExpiry: '2026-10-08T15:00:00Z',
      })
      .get(/\/authorized\/status\/.+/).reply(200, {
        active: true,
        accountLocked: false,
      });

    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ mobile: '9876543210' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.diagnostics).toBeDefined();
    expect(res.body.diagnostics.requestCount).toBe(3);
    expect(res.body.diagnostics.responseCount).toBe(3);

    // Verify secret redaction
    const loginEvt = res.body.diagnostics.events[0];
    expect(loginEvt.response.studentId).toBe('STU9981');
    expect(loginEvt.response.token).toBe('[REDACTED]');
  });

  // 4. Empty upstream response and bounded retries
  it('retries on empty upstream response and returns EMPTY_UPSTREAM_RESPONSE on exhaustion', async () => {
    nock(TEST_UPSTREAM)
      .post('/authorized/login-support').times(4).reply(200, '');

    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ mobile: '9876543210' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMPTY_UPSTREAM_RESPONSE');
    expect(res.body.error.attempts).toBe(4);
  });

  // 5. Upstream 500 error handling
  it('captures HTTP 500 response without crashing the server', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/500').reply(500, { error: 'Upstream Database Unavailable' });

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/500' }, 0, 0);
    expect(evt.status).toBe(500);
    expect(evt.responseType).toBe('json');
    expect((evt.response as { error: string }).error).toBe('Upstream Database Unavailable');
  });

  // 6. Malformed JSON handling
  it('handles malformed upstream JSON gracefully without crashing', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/badjson').reply(200, '<html><head><title>502 Bad Gateway</title></head><body><h1>Bad Gateway</h1></body></html>', {
        'content-type': 'text/html',
      });

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/badjson' }, 0, 0);
    expect(evt.status).toBe(200);
    expect(evt.responseType).toBe('text');
    expect(typeof evt.response).toBe('string');
    expect(evt.response).toContain('502 Bad Gateway');
  });

  // 7. Timeout handling
  it('handles upstream timeout gracefully', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/timeout').delayConnection(2000).reply(200, 'ok');

    const origTimeout = config.upstreamTimeoutMs;
    config.upstreamTimeoutMs = 100;

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/timeout' }, 0, 0);
    expect(evt.status).toBe(0);
    expect(evt.responseType).toBe('error');
    expect((evt.response as { error: string }).error).toBe('UPSTREAM_TIMEOUT');

    config.upstreamTimeoutMs = origTimeout;
  });

  // 8. SSRF Protection: Method rejection
  it('rejects non-allowlisted HTTP methods to prevent SSRF', async () => {
    await expect(
      executeUpstreamRequest({ method: 'DELETE' as any, path: '/authorized/login-support' }, 0, 0)
    ).rejects.toThrow('SSRF Prevention');
  });

  // 9. SSRF Protection: Path rejection
  it('rejects non-allowlisted upstream paths to prevent SSRF', async () => {
    await expect(
      executeUpstreamRequest({ method: 'GET', path: '/admin/dump-all-keys' }, 0, 0)
    ).rejects.toThrow('SSRF Prevention');
  });

  // 10. Serve single-page frontend
  it('serves static HTML frontend on GET /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Student Login Support');
  });
});
