import request from 'supertest';
import nock from 'nock';
import bcrypt from 'bcryptjs';
import app from '../app';
import db from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { executeUpstreamRequest } from '../services/upstreamProxy';
import { redactSecrets, maskMobile } from '../security/redactSecrets';

const TEST_UPSTREAM = 'http://test-upstream.local';

describe('Student Login Support - Diagnostics & Security Test Suite', () => {
  let sessionId: string;
  let adminId: number;

  beforeAll(() => {
    config.upstreamBaseUrl = TEST_UPSTREAM;
    // Set 0ms delay in tests for instant execution
    config.supportRetryDelayMs = 0;

    let admin = db.prepare<{ id: number }>('SELECT id FROM admins WHERE username = ?').get('admin');
    if (!admin) {
      const hash = bcrypt.hashSync('Admin@123!', 10);
      db.prepare(
        'INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
      ).run('admin', hash, 'admin', new Date().toISOString());
      admin = db.prepare<{ id: number }>('SELECT id FROM admins WHERE username = ?').get('admin');
    }
    adminId = admin!.id;

    sessionId = uuidv4();
    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, admin_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, adminId, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  });

  afterAll(() => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // 1. Health check
  it('health endpoint returns ok and does not expose secrets', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'student-support' });
  });

  // 2. Authentication check
  it('rejects unauthenticated diagnostic requests with 401', async () => {
    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ mobile: '9876543210' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // 3. Invalid mobile number validation
  it('validates mobile number format and rejects invalid inputs with 400', async () => {
    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .set('Cookie', [`ssid=${sessionId}`])
      .send({ mobile: '123' }); // too short

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  // 4. Successful upstream workflow execution (all 3 steps)
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
      .set('Cookie', [`ssid=${sessionId}`])
      .send({ mobile: '9876543210' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.diagnostics).toBeDefined();
    expect(res.body.diagnostics.requestCount).toBe(3);
    expect(res.body.diagnostics.responseCount).toBe(3);

    // Verify secret redaction in response payload
    const loginEvt = res.body.diagnostics.events[0];
    expect(loginEvt.response.studentId).toBe('STU9981');
    expect(loginEvt.response.token).toBe('[REDACTED]');

    // Verify database persistence
    const runInDb = db.prepare<{ id: string; mobile_masked: string; result: string }>(
      'SELECT id, mobile_masked, result FROM diagnostic_runs WHERE id = ?'
    ).get(res.body.diagnostics.requestId);
    expect(runInDb).toBeDefined();
    expect(runInDb?.mobile_masked).toBe('******3210');
    expect(runInDb?.result).toBe('SUCCESS');

    // Verify audit log creation
    const auditRecord = db.prepare<{ operation: string; result: string; mobile_masked: string }>(
      'SELECT operation, result, mobile_masked FROM audit_logs WHERE request_id = ?'
    ).get(res.body.diagnostics.requestId);
    expect(auditRecord).toBeDefined();
    expect(auditRecord?.operation).toBe('LOGIN_DIAGNOSTICS');
    expect(auditRecord?.result).toBe('SUCCESS');
    expect(auditRecord?.mobile_masked).toBe('******3210');
  });

  // 5. Empty upstream response and bounded retry exhaustion
  it('retries on empty upstream response and returns EMPTY_UPSTREAM_RESPONSE on exhaustion', async () => {
    // 1 initial attempt + 3 retries = 4 total calls
    nock(TEST_UPSTREAM)
      .post('/authorized/login-support').times(4).reply(200, '');

    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .set('Cookie', [`ssid=${sessionId}`])
      .send({ mobile: '9876543210' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMPTY_UPSTREAM_RESPONSE');
    expect(res.body.error.attempts).toBe(4);
  });

  // 6. Upstream HTTP 5xx error handling
  it('captures HTTP 500 response without crashing the server', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/500').reply(500, { error: 'Upstream Database Unavailable' });

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/500' }, 0, 0);
    expect(evt.status).toBe(500);
    expect(evt.responseType).toBe('json');
    expect((evt.response as { error: string }).error).toBe('Upstream Database Unavailable');
  });

  // 7. Malformed JSON handling
  it('handles malformed upstream JSON gracefully without crashing', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/malformed').reply(200, '<html><head><title>Error</title></head><body>Bad Gateway</body></html>', {
        'Content-Type': 'text/html',
      });

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/malformed' }, 0, 0);
    expect(evt.status).toBe(200);
    expect(evt.responseType).toBe('text');
    expect(typeof evt.response).toBe('string');
  });

  // 8. Plain text handling
  it('handles plain text upstream responses safely', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/text').reply(200, 'Plain text diagnostic message', {
        'Content-Type': 'text/plain',
      });

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/text' }, 0, 0);
    expect(evt.status).toBe(200);
    expect(evt.responseType).toBe('text');
    expect(evt.response).toBe('Plain text diagnostic message');
  });

  // 9. Upstream timeout handling
  it('handles upstream request timeout gracefully', async () => {
    nock(TEST_UPSTREAM)
      .get('/test/timeout').delayConnection(500).reply(200, 'ok');

    const origTimeout = config.upstreamTimeoutMs;
    config.upstreamTimeoutMs = 50;

    const evt = await executeUpstreamRequest({ method: 'GET', path: '/test/timeout' }, 0, 0);
    config.upstreamTimeoutMs = origTimeout;

    expect(evt.status).toBe(0);
    expect(evt.responseType).toBe('error');
    expect((evt.response as { error: string }).error).toBe('UPSTREAM_TIMEOUT');
  });

  // 10. SSRF Prevention
  it('enforces SSRF protection by rejecting non-allowlisted upstream paths', async () => {
    await expect(
      executeUpstreamRequest({ method: 'GET', path: '/admin/secrets' }, 0, 0)
    ).rejects.toThrow('SSRF Prevention: Upstream path \'/admin/secrets\' is not allowlisted.');
  });

  it('enforces SSRF protection by rejecting non-allowlisted HTTP methods', async () => {
    await expect(
      executeUpstreamRequest({ method: 'DELETE' as any, path: '/authorized/test' }, 0, 0)
    ).rejects.toThrow('SSRF Prevention: HTTP method \'DELETE\' is not authorized.');
  });
});

describe('Security Redaction & Masking', () => {
  it('redacts sensitive credential fields deeply in objects and arrays', () => {
    const input = {
      user: 'test_student',
      password: 'PlainPassword123',
      nested: {
        otp: '654321',
        userPin: '1234',
        safeProperty: 'KeepMe',
      },
      tokens: [
        { accessToken: 'secret_token_val', id: 1 },
      ],
    };

    const redacted = redactSecrets(input) as any;
    expect(redacted.user).toBe('test_student');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.nested.otp).toBe('[REDACTED]');
    expect(redacted.nested.userPin).toBe('[REDACTED]');
    expect(redacted.nested.safeProperty).toBe('KeepMe');
    expect(redacted.tokens[0].accessToken).toBe('[REDACTED]');
    expect(redacted.tokens[0].id).toBe(1);
  });

  it('preserves unrelated fields with similar substrings (e.g. opinion, pinball)', () => {
    const input = {
      opinion: 'good',
      spinning: true,
    };
    const redacted = redactSecrets(input) as any;
    expect(redacted.opinion).toBe('good');
    expect(redacted.spinning).toBe(true);
  });

  it('masks mobile numbers to expose only the last 4 digits', () => {
    expect(maskMobile('9876543210')).toBe('******3210');
    expect(maskMobile('+1 (555) 234-5678')).toBe('*******5678');
    expect(maskMobile('1234')).toBe('1234');
  });
});
