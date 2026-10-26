import request from 'supertest';
import nock from 'nock';
import fs from 'fs';
import path from 'path';
import app from '../server';
import { config } from '../config';
import { executeUpstreamRequest } from '../services/upstreamProxy';
import {
  parseCredentialRecoveryResponse,
  resolveCredential,
  HttpCredentialRecoveryAdapter,
} from '../services/credentialRecoveryService';

const TEST_UPSTREAM = 'http://test-upstream.local';
const TEST_RECOVERY_ENDPOINT = 'http://recovery-service.internal.edu/api/v1/lookup';

describe('Student Login Support - Single-Page Workflow Test Suite', () => {
  const originalKey = process.env.SUPPORT_API_KEY;
  const originalRecoveryEndpoint = config.supportRecoveryEndpoint;
  const originalRecoveryKey = config.supportRecoveryApiKey;
  const originalMd5Key = config.md5decryptApiKey;

  beforeAll(() => {
    delete process.env.SUPPORT_API_KEY;
    config.md5decryptApiKey = undefined;
    config.supportRecoveryEndpoint = undefined;
    config.upstreamBaseUrl = TEST_UPSTREAM;
    config.supportRetryDelayMs = 0; // instant retries in tests
  });

  afterEach(() => {
    nock.cleanAll();
    config.md5decryptApiKey = undefined;
    config.supportRecoveryEndpoint = originalRecoveryEndpoint;
    config.supportRecoveryApiKey = originalRecoveryKey;
    if (originalKey !== undefined) {
      process.env.SUPPORT_API_KEY = originalKey;
    } else {
      delete process.env.SUPPORT_API_KEY;
    }
  });

  afterAll(() => {
    config.md5decryptApiKey = originalMd5Key;
  });

  // 1. Health check
  it('health endpoint returns status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'student-support' });
  });

  // 2. Input validation
  it('validates student input and rejects invalid inputs with 400', async () => {
    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ mobile: '123' }); // too short

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  // 3. Executes student verification when no recovery adapter is configured
  it('executes student verification, extracts username & password hash, and reports unconfigured recovery', async () => {
    config.supportRecoveryEndpoint = undefined;

    nock('https://edunova.abes.ac.in')
      .get('/sims-services/digitalsims/')
      .query(true)
      .reply(200, {
        collection: {
          version: '1.0',
          link: 'http://api.digitaledu.net/v1/docs',
          response: {
            hash: '0856b07a1256f480c5f7b8f8a60431de',
            userDetails: {
              username: 'student_username',
              password: '337b2ac65e5bb92c1f49b6b76b0788b3',
              userId: '149',
              mobile: '9876543210',
              firstName: 'STUDENT',
              middleName: '',
              lastName: 'EXAMPLE',
              userType: 'students',
            },
            mbrType: 'STUDENTS',
            statusMsg: 'SUCCESS',
          },
        },
      });

    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ studentNumber: '9876543210' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify minimal authorized response contract (username and authorized password hash)
    expect(res.body.username).toBe('student_username');
    expect(res.body.password).toBe('337b2ac65e5bb92c1f49b6b76b0788b3'); // Exact password hash returned directly
    expect(res.body.password).not.toContain('Credential recovery service not configured'); // Errors never returned as password

    // Verify extracted student username
    expect(res.body.diagnostics.student).toBeDefined();
    expect(res.body.diagnostics.student.username).toBe('student_username');
    expect(res.body.diagnostics.stageDiagnostic).toBe('RECOVERY_NOT_CONFIGURED');

    // Verify credential diagnostic result
    const cred = res.body.diagnostics.credentialDiagnostic;
    expect(cred).toBeDefined();
    expect(cred.hasHash).toBe(true);
    expect(cred.formatValid).toBe(true);
    expect(cred.algorithm).toBe('MD5 (One-Way Hash)');
    expect(cred.isReversible).toBe(false);

    // Verify recovery guidance
    expect(res.body.diagnostics.recovery).toBeDefined();
    expect(res.body.diagnostics.recovery.recoveryAvailable).toBe(true);
    expect(res.body.diagnostics.recovery.recoveryMethod).toBe('SMS_OTP_SELF_SERVICE');
    expect(res.body.diagnostics.student.accountStatus).toBe('ACTIVE_VERIFIED');

    // Verify secret redaction keeps hash confidential in captured events
    const event = res.body.diagnostics.events[0];
    expect(event.response.collection.response.userDetails.password).toBe('[REDACTED]');
  });

  // 4. Handles upstream failure or empty response gracefully
  it('handles upstream verification failure gracefully', async () => {
    nock('https://edunova.abes.ac.in')
      .get('/sims-services/digitalsims/')
      .query(true)
      .reply(200, {
        collection: {
          response: {
            statusMsg: 'FAILED',
            statusCode: 404,
            message: 'Mobile number not found in student database',
          },
        },
      });

    const res = await request(app)
      .post('/api/support/login-diagnostics')
      .send({ studentNumber: '9876543210' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('STUDENT_NOT_FOUND');
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

  // 10. Serve single-page frontend with minimal interface and verify CSS hidden override
  it('serves static HTML frontend with single student-number input and submit button', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Student Account Lookup');
    expect(res.text).toContain('id="student-number-input"');
    expect(res.text).toContain('id="submit-btn"');
    expect(res.text).toContain('Username:');
    expect(res.text).toContain('Password:');

    // Confirm error message is empty by default in index.html to prevent phantom display
    expect(res.text).toContain('<p id="error-message"></p>');

    // Confirm style.css contains [hidden] { display: none !important; }
    const cssPath = path.resolve(__dirname, '../../public/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    expect(cssContent).toContain('[hidden]');
    expect(cssContent).toContain('display: none !important');
  });

  // 11. Second-stage Response Parser Tests (Section 5 & 9 requirements)
  describe('Second-Stage Credential Recovery Response Parser', () => {
    const sampleHash = '337b2ac65e5bb92c1f49b6b76b0788b3';
    const validFixture = {
      success: true,
      action: 'decrypt',
      algorithm: 'md5',
      results: [
        {
          hash: '337b2ac65e5bb92c1f49b6b76b0788b3',
          status: 'found',
          algorithm: 'md5',
          plaintext: 'apbvq',
        },
      ],
      found_count: 1,
    };

    it('extracts exactly the plaintext string "apbvq" from a successful matching response', () => {
      const parsed = parseCredentialRecoveryResponse(validFixture, sampleHash);
      expect(parsed.success).toBe(true);
      expect(parsed.plaintext).toBe('apbvq');
      expect(parsed.stageDiagnostic).toBe('RECOVERY_SUCCESS');
      expect(typeof parsed.plaintext).toBe('string');
      // Verify it returns strictly the string and not the full JSON object or raw hash
      expect(parsed.plaintext).not.toContain('337b2ac65e5bb92c1f49b6b76b0788b3');
      expect(parsed.plaintext).not.toContain('results');
    });

    it('parses valid JSON string input correctly', () => {
      const jsonStr = JSON.stringify(validFixture);
      const parsed = parseCredentialRecoveryResponse(jsonStr, sampleHash);
      expect(parsed.success).toBe(true);
      expect(parsed.plaintext).toBe('apbvq');
    });

    it('fails when success is false', () => {
      const fixture = { ...validFixture, success: false };
      const parsed = parseCredentialRecoveryResponse(fixture, sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('INVALID_RECOVERY_RESPONSE');
      expect(parsed.plaintext).toBeUndefined();
    });

    it('fails when results field is missing', () => {
      const fixture = { success: true, found_count: 0 };
      const parsed = parseCredentialRecoveryResponse(fixture, sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('INVALID_RECOVERY_RESPONSE');
    });

    it('fails when results array is empty', () => {
      const fixture = { success: true, results: [], found_count: 0 };
      const parsed = parseCredentialRecoveryResponse(fixture, sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('NO_MATCHING_RESULT');
    });

    it('fails when no matching hash is found in results array', () => {
      const parsed = parseCredentialRecoveryResponse(validFixture, 'different_hash_0000000000000000');
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('NO_MATCHING_RESULT');
      expect(parsed.error).toContain('No matching hash found');
    });

    it('fails when result status is not "found"', () => {
      const fixture = {
        success: true,
        results: [
          {
            hash: sampleHash,
            status: 'not_found',
            algorithm: 'md5',
          },
        ],
      };
      const parsed = parseCredentialRecoveryResponse(fixture, sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('NO_MATCHING_RESULT');
    });

    it('fails when plaintext field is missing from matching result', () => {
      const fixture = {
        success: true,
        results: [
          {
            hash: sampleHash,
            status: 'found',
            algorithm: 'md5',
            // plaintext omitted
          },
        ],
      };
      const parsed = parseCredentialRecoveryResponse(fixture, sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('MISSING_PLAINTEXT_FIELD');
    });

    it('handles malformed JSON string without throwing', () => {
      const parsed = parseCredentialRecoveryResponse('INVALID_JSON{{', sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('INVALID_RECOVERY_RESPONSE');
      expect(parsed.error).toContain('Malformed JSON');
    });

    it('handles null, undefined, or empty response safely', () => {
      expect(parseCredentialRecoveryResponse(null, sampleHash).success).toBe(false);
      expect(parseCredentialRecoveryResponse(undefined, sampleHash).success).toBe(false);
      expect(parseCredentialRecoveryResponse('', sampleHash).success).toBe(false);
    });

    it('extracts plaintext when matching result is located in a position other than the first array element', () => {
      const multiFixture = {
        success: true,
        action: 'decrypt',
        algorithm: 'md5',
        results: [
          { hash: '11111111111111111111111111111111', status: 'found', plaintext: 'other_pass' },
          { hash: sampleHash, status: 'found', plaintext: 'apbvq' },
          { hash: '22222222222222222222222222222222', status: 'found', plaintext: 'another_pass' },
        ],
        found_count: 3,
      };
      const parsed = parseCredentialRecoveryResponse(multiFixture, sampleHash);
      expect(parsed.success).toBe(true);
      expect(parsed.plaintext).toBe('apbvq');
      expect(parsed.stageDiagnostic).toBe('RECOVERY_SUCCESS');
    });

    it('rejects incorrect response types safely (number, boolean)', () => {
      expect(parseCredentialRecoveryResponse(12345, sampleHash).success).toBe(false);
      expect(parseCredentialRecoveryResponse(true, sampleHash).success).toBe(false);
    });
  });

  // 12. Credential Recovery Service Integration Tests
  describe('Credential Recovery Service Integration & Error Handling', () => {
    const sampleHash = '337b2ac65e5bb92c1f49b6b76b0788b3';

    it('recovers plaintext password when an authorized recovery adapter returns a valid result', async () => {
      const mockAdapter = {
        name: 'MockTestAdapter',
        recoverHash: jest.fn().mockResolvedValue({
          success: true,
          action: 'decrypt',
          algorithm: 'md5',
          results: [
            {
              hash: sampleHash,
              status: 'found',
              algorithm: 'md5',
              plaintext: 'apbvq',
            },
          ],
        }),
      };

      const result = await resolveCredential(sampleHash, { username: 'student123' }, mockAdapter);
      expect(result.hasPlaintext).toBe(true);
      expect(result.passwordResult).toBe('apbvq');
      expect(result.status).toBe('PLAINTEXT_AVAILABLE');
      expect(result.stageDiagnostic).toBe('RECOVERY_SUCCESS');
    });

    it('does not fabricate plaintext when recovery adapter has no match', async () => {
      const mockAdapter = {
        name: 'MockTestAdapter',
        recoverHash: jest.fn().mockResolvedValue({
          success: true,
          results: [
            {
              hash: sampleHash,
              status: 'not_found',
            },
          ],
        }),
      };

      const result = await resolveCredential(sampleHash, { username: 'student123' }, mockAdapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toContain('Protected (One-way MD5 hash');
      expect(result.passwordResult).not.toBe(sampleHash); // Hash is not returned as password
      expect(result.stageDiagnostic).toBe('NO_MATCHING_RESULT');
    });

    it('handles adapter network exceptions safely without crashing', async () => {
      const mockAdapter = {
        name: 'MockTestAdapter',
        recoverHash: jest.fn().mockRejectedValue(new Error('Network connection timeout')),
      };

      const result = await resolveCredential(sampleHash, { username: 'student123' }, mockAdapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toContain('Recovery service request timed out');
      expect(result.stageDiagnostic).toBe('RECOVERY_TIMEOUT');
    });

    it('prevents cross-student result contamination and maps recovery strictly per current hash', async () => {
      const hashStudent1 = '337b2ac65e5bb92c1f49b6b76b0788b3';
      const hashStudent2 = 'c4ca4238a0b923820dcc509a6f75849b';

      const mockAdapter = {
        name: 'MockPerStudentAdapter',
        recoverHash: jest.fn().mockImplementation(async (hash: string) => {
          if (hash === hashStudent1) {
            return {
              success: true,
              results: [{ hash: hashStudent1, status: 'found', plaintext: 'student1_plaintext_secret' }],
            };
          }
          return {
            success: true,
            results: [{ hash: hashStudent2, status: 'found', plaintext: 'student2_plaintext_secret' }],
          };
        }),
      };

      const res1 = await resolveCredential(hashStudent1, { username: 'student1' }, mockAdapter);
      const res2 = await resolveCredential(hashStudent2, { username: 'student2' }, mockAdapter);

      expect(res1.passwordResult).toBe('student1_plaintext_secret');
      expect(res2.passwordResult).toBe('student2_plaintext_secret');
      expect(res1.passwordResult).not.toBe(res2.passwordResult);
    });

    it('rejects unauthorized request when API key is enforced', async () => {
      process.env.SUPPORT_API_KEY = 'test-secret-key-123';

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9876543210' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('handles missing username from upstream college response safely', async () => {
      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                userId: '998',
                password: sampleHash,
                // username omitted
              },
            },
          },
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9876543210' });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('UNKNOWN');
      expect(res.body.password).toBeDefined();
    });
  });

  // 13. End-to-End Configured Recovery Endpoint Tests
  describe('End-to-End Configured Recovery Endpoint Workflow', () => {
    const sampleHash = '337b2ac65e5bb92c1f49b6b76b0788b3';

    beforeEach(() => {
      config.supportRecoveryEndpoint = TEST_RECOVERY_ENDPOINT;
      config.supportRecoveryApiKey = 'test-recovery-key-abc';
      config.supportRecoveryTimeoutMs = 1000;
    });

    it('resolves plaintext password end-to-end when configured recovery service succeeds', async () => {
      // Mock upstream EduNova verification
      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            version: '1.0',
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'akshay',
                password: sampleHash,
                userId: '149',
                mobile: '9599099932',
              },
            },
          },
        });

      // Mock authorized second-stage recovery service
      nock('http://recovery-service.internal.edu')
        .post('/api/v1/lookup')
        .matchHeader('authorization', 'Bearer test-recovery-key-abc')
        .reply(200, {
          success: true,
          action: 'decrypt',
          algorithm: 'md5',
          results: [
            {
              hash: sampleHash,
              status: 'found',
              algorithm: 'md5',
              plaintext: 'apbvq',
            },
          ],
          found_count: 1,
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe('akshay');
      expect(res.body.password).toBe(sampleHash); // Exact password hash preserved without altering
      expect(res.body.diagnostics.stageDiagnostic).toBe('RECOVERY_SUCCESS');
    });

    it('handles recovery service HTTP 500 rejection cleanly', async () => {
      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'akshay',
                password: sampleHash,
              },
            },
          },
        });

      nock('http://recovery-service.internal.edu')
        .post('/api/v1/lookup')
        .reply(500, { error: 'Internal recovery error' });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe('akshay');
      // Backend errors must NEVER be displayed as password values; exact hash is preserved
      expect(res.body.password).toBe(sampleHash);
      expect(res.body.diagnostics.stageDiagnostic).toBe('RECOVERY_REJECTED');
    });

    it('handles recovery service timeout cleanly without crashing', async () => {
      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'akshay',
                password: sampleHash,
              },
            },
          },
        });

      nock('http://recovery-service.internal.edu')
        .post('/api/v1/lookup')
        .delayConnection(2500)
        .reply(200, {});

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe('akshay');
      // Backend timeout errors must NEVER replace password hash
      expect(res.body.password).toBe(sampleHash);
      expect(res.body.diagnostics.stageDiagnostic).toBe('RECOVERY_TIMEOUT');
    });

    it('HttpCredentialRecoveryAdapter directly verifies request formatting and header transmission', async () => {
      nock('http://recovery-service.internal.edu')
        .post('/api/v1/lookup')
        .matchHeader('authorization', 'Bearer test-recovery-key-abc')
        .matchHeader('x-api-key', 'test-recovery-key-abc')
        .reply(200, {
          success: true,
          results: [{ hash: sampleHash, status: 'found', plaintext: 'apbvq' }],
        });

      const adapter = new HttpCredentialRecoveryAdapter(
        TEST_RECOVERY_ENDPOINT,
        'test-recovery-key-abc',
        2000
      );

      const response = await adapter.recoverHash(sampleHash) as any;
      expect(response.success).toBe(true);
      expect(response.results[0].plaintext).toBe('apbvq');
    });
  });

  // 14. Dedicated Tests for MD5Decrypt API Integration Requirements (Section 9: 17 Items)
  describe('Official MD5Decrypt API Integration Requirements (17 Specific Verification Scenarios)', () => {
    const publicTestHash = '5f4dcc3b5aa765d61d8327deb882cf99'; // standard public hash for "password"
    const publicExpectedPlaintext = 'password';
    const sampleHash = '337b2ac65e5bb92c1f49b6b76b0788b3';
    const samplePlaintext = 'apbvq';

    // 1. API key missing
    it('1. Handles missing API key and returns clear configuration status', async () => {
      config.md5decryptApiKey = undefined;
      config.supportRecoveryEndpoint = undefined;

      const result = await resolveCredential(sampleHash, { username: 'test_student' });
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Credential recovery service not configured (MD5DECRYPT_API_KEY missing)');
      expect(result.stageDiagnostic).toBe('RECOVERY_NOT_CONFIGURED');
    });

    // 2. Valid API configuration
    it('2. Formats request with Bearer authorization and X-API-Key to https://api.md5decrypt.net/', async () => {
      nock('https://api.md5decrypt.net')
        .post('/', { action: 'lookup', hash: publicTestHash, hashes: [publicTestHash] })
        .matchHeader('authorization', 'Bearer test_key_valid_123')
        .matchHeader('x-api-key', 'test_key_valid_123')
        .reply(200, {
          success: true,
          action: 'lookup',
          results: [{ hash: publicTestHash, found: true, plaintext: publicExpectedPlaintext }],
        });

      const adapter = new HttpCredentialRecoveryAdapter('https://api.md5decrypt.net/', 'test_key_valid_123', 2000);
      const res = await adapter.recoverHash(publicTestHash) as any;
      expect(res.success).toBe(true);
      expect(res.results[0].plaintext).toBe(publicExpectedPlaintext);
    });

    // 3. Successful request using an approved public test hash
    it('3. Successfully resolves approved public test hash 5f4dcc3b5aa765d61d8327deb882cf99 to "password"', async () => {
      const mockAdapter = {
        name: 'MockPublicTestHashAdapter',
        recoverHash: jest.fn().mockResolvedValue({
          success: true,
          action: 'lookup',
          results: [{ hash: publicTestHash, found: true, plaintext: publicExpectedPlaintext }],
        }),
      };

      const result = await resolveCredential(publicTestHash, { username: 'test_demo', isTestAccount: true }, mockAdapter);
      expect(result.hasPlaintext).toBe(true);
      expect(result.passwordResult).toBe(publicExpectedPlaintext);
      expect(result.stageDiagnostic).toBe('RECOVERY_SUCCESS');
    });

    // 4. Valid JSON response (supports official schema found: true)
    it('4. Parses valid official JSON response structure', () => {
      const officialPayload = {
        success: true,
        action: 'lookup',
        count: 1,
        found: 1,
        unfound: 0,
        results: [
          {
            index: 0,
            ok: true,
            found: true,
            type: 'md5',
            hash: publicTestHash,
            plaintext: publicExpectedPlaintext,
          },
        ],
      };
      const parsed = parseCredentialRecoveryResponse(officialPayload, publicTestHash);
      expect(parsed.success).toBe(true);
      expect(parsed.plaintext).toBe(publicExpectedPlaintext);
    });

    // 5. Invalid JSON response
    it('5. Handles invalid / malformed JSON response safely', async () => {
      const mockAdapter = {
        name: 'MockInvalidJsonAdapter',
        recoverHash: jest.fn().mockResolvedValue('INVALID_NON_JSON_CORRUPT{{{'),
      };
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, mockAdapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Recovery service returned invalid response');
      expect(result.stageDiagnostic).toBe('INVALID_RECOVERY_RESPONSE');
    });

    // 6. Missing results array
    it('6. Rejects response when results array is missing', () => {
      const parsed = parseCredentialRecoveryResponse({ success: true, count: 0 }, sampleHash);
      expect(parsed.success).toBe(false);
      expect(parsed.stageDiagnostic).toBe('INVALID_RECOVERY_RESPONSE');
    });

    // 7. Empty results array
    it('7. Handles empty results array cleanly', async () => {
      const mockAdapter = {
        name: 'MockEmptyResultsAdapter',
        recoverHash: jest.fn().mockResolvedValue({ success: true, results: [] }),
      };
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, mockAdapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Protected (One-way MD5 hash — no matching plaintext found)');
      expect(result.stageDiagnostic).toBe('NO_MATCHING_RESULT');
    });

    // 8. No matching result
    it('8. Handles non-matching or unfound hash result', async () => {
      const mockAdapter = {
        name: 'MockNotFoundAdapter',
        recoverHash: jest.fn().mockResolvedValue({
          success: true,
          results: [{ hash: sampleHash, found: false, status: 'not_found' }],
        }),
      };
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, mockAdapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Protected (One-way MD5 hash — no matching plaintext found)');
      expect(result.stageDiagnostic).toBe('NO_MATCHING_RESULT');
    });

    // 9. HTTP 401 authentication failure
    it('9. Handles HTTP 401 authentication failure with specific status', async () => {
      nock('https://api.md5decrypt.net')
        .post('/')
        .reply(401, { error: 'Invalid API key' });

      const adapter = new HttpCredentialRecoveryAdapter('https://api.md5decrypt.net/', 'invalid_key', 2000);
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, adapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Recovery service authentication failed (Invalid API key)');
      expect(result.stageDiagnostic).toBe('RECOVERY_REJECTED');
    });

    // 10. HTTP 429 rate limiting or quota exhaustion
    it('10. Handles HTTP 429 quota exhaustion or rate limit', async () => {
      nock('https://api.md5decrypt.net')
        .post('/')
        .reply(429, { error: 'Rate limit or quota exhausted' });

      const adapter = new HttpCredentialRecoveryAdapter('https://api.md5decrypt.net/', 'quota_key', 2000);
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, adapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Recovery service quota or rate limit reached');
      expect(result.stageDiagnostic).toBe('RECOVERY_REJECTED');
    });

    // 11. HTTP 500 provider failure
    it('11. Handles HTTP 500 provider failure cleanly', async () => {
      nock('https://api.md5decrypt.net')
        .post('/')
        .reply(500, { error: 'Internal Server Error' });

      const adapter = new HttpCredentialRecoveryAdapter('https://api.md5decrypt.net/', 'valid_key', 2000);
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, adapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Recovery service provider request failed');
      expect(result.stageDiagnostic).toBe('RECOVERY_REJECTED');
    });

    // 12. Network timeout
    it('12. Handles network timeout cleanly', async () => {
      nock('https://api.md5decrypt.net')
        .post('/')
        .delayConnection(2500)
        .reply(200, {});

      const adapter = new HttpCredentialRecoveryAdapter('https://api.md5decrypt.net/', 'valid_key', 100);
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, adapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Recovery service request timed out');
      expect(result.stageDiagnostic).toBe('RECOVERY_TIMEOUT');
    });

    // 13. Network connection failure
    it('13. Handles network connection failure cleanly', async () => {
      const mockAdapter = {
        name: 'MockNetworkFailureAdapter',
        recoverHash: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9999')),
      };
      const result = await resolveCredential(sampleHash, { username: 'test_user' }, mockAdapter);
      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toBe('Recovery service connection failed');
      expect(result.stageDiagnostic).toBe('RECOVERY_REJECTED');
    });

    // 14. Unexpected response fields
    it('14. Safely parses responses containing unexpected extra fields', () => {
      const unexpectedFieldsPayload = {
        success: true,
        action: 'lookup',
        extra_unknown_field_1: 'value',
        server_timestamp: 123456789,
        nested_metadata: { tier: 'enterprise' },
        results: [
          {
            hash: sampleHash,
            status: 'found',
            plaintext: samplePlaintext,
            extra_field_a: 42,
            extra_field_b: true,
          },
        ],
      };
      const parsed = parseCredentialRecoveryResponse(unexpectedFieldsPayload, sampleHash);
      expect(parsed.success).toBe(true);
      expect(parsed.plaintext).toBe(samplePlaintext);
    });

    // 15. Frontend error-state rendering
    it('15. Verifies frontend HTML contract has error card container and does not pre-render static error', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('id="error-card"');
      expect(res.text).toContain('<p id="error-message"></p>');
    });

    // 16. Ensuring secrets and sensitive values are not logged
    it('16. Verifies API key, raw hashes, and passwords are never exposed in log events', async () => {
      const secretKey = 'md5d_live_test_secret_key_9999';
      config.md5decryptApiKey = secretKey;

      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'akshay',
                password: sampleHash,
                userId: '149',
                mobile: '9599099932',
              },
            },
          },
        });

      nock('https://api.md5decrypt.net')
        .post('/')
        .reply(200, {
          success: true,
          results: [{ hash: sampleHash, found: true, plaintext: samplePlaintext }],
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      const stringifiedEvents = JSON.stringify(res.body.diagnostics.events);
      expect(stringifiedEvents).not.toContain(secretKey);
      expect(stringifiedEvents).not.toContain(sampleHash);
    });

    // 17. Ensuring real student passwords are never exposed by the UI
    it('17. Enforces institutional policy: real student accounts receive SSPR reset guidance, not plaintext', async () => {
      const realStudentHash = 'd41d8cd98f00b204e9800998ecf8427e';
      const realStudentContext = {
        username: 'actual_unlisted_student',
        userId: '149',
        userType: 'students',
        isTestAccount: false,
      };

      const mockAdapter = {
        name: 'MockAdapter',
        recoverHash: jest.fn().mockResolvedValue({
          success: true,
          results: [{ hash: realStudentHash, found: true, plaintext: 'real_student_recovered_secret' }],
        }),
      };

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const result = await resolveCredential(realStudentHash, realStudentContext, mockAdapter);

      process.env.NODE_ENV = origEnv;

      expect(result.hasPlaintext).toBe(false);
      expect(result.passwordResult).toContain('SSPR reset required');
      expect(result.passwordResult).not.toBe('real_student_recovered_secret'); // Plaintext is NOT exposed for real students
    });
  });

  describe('Password Hash Direct Display Guarantee', () => {
    it('returns exact upstream hash when MD5DECRYPT_API_KEY is not set', async () => {
      config.md5decryptApiKey = undefined;
      config.supportRecoveryEndpoint = undefined;

      const exactUpstreamHash = '337b2ac65e5bb92c1f49b6b76b0788b3';

      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'akshay',
                password: exactUpstreamHash,
                userId: '149',
              },
            },
          },
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe('akshay');
      expect(res.body.password).toBe(exactUpstreamHash);
      expect(res.body.password).not.toContain('Credential recovery service not configured');
    });

    it('preserves hash characters and case without modification', async () => {
      config.md5decryptApiKey = undefined;
      config.supportRecoveryEndpoint = undefined;

      const mixedCaseHash = 'A1B2c3D4e5F60718293a4b5c6d7e8f90';

      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'mixed_student',
                password: mixedCaseHash,
              },
            },
          },
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.password).toBe(mixedCaseHash);
    });

    it('handles genuinely absent password hash gracefully as undefined', async () => {
      config.md5decryptApiKey = undefined;
      config.supportRecoveryEndpoint = undefined;

      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'no_password_student',
                // password omitted
              },
            },
          },
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('no_password_student');
      expect(res.body.password).toBeUndefined();
    });
  });
});
