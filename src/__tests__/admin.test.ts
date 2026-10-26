import request from 'supertest';
import nock from 'nock';
import { app } from '../server';
import { config } from '../config';
import { AdminAuth } from '../security/adminAuth';
import { apiKeyService } from '../services/apiKeyService';
import { setApiKeyRepository, MemoryApiKeyRepository } from '../database/apiKeyRepository';

describe('Admin Dashboard & API Key Management', () => {
  let adminToken: string;
  let adminCsrf: string;
  let adminCookie: string;
  let memoryRepo: MemoryApiKeyRepository;

  beforeEach(async () => {
    nock.cleanAll();
    // Fresh repository for isolated test state
    memoryRepo = new MemoryApiKeyRepository();
    setApiKeyRepository(memoryRepo);

    // Default admin in tests
    config.adminUsername = 'admin';
    config.adminPassword = 'testadminpassword123';

    // Authenticate admin
    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'testadminpassword123' });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
    adminCsrf = loginRes.body.csrfToken;

    const cookies = loginRes.headers['set-cookie'];
    adminCookie = Array.isArray(cookies) ? cookies.join('; ') : (cookies || '');
  });

  afterAll(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('1. Administrator Authentication & Session Security', () => {
    it('rejects login with empty credentials', async () => {
      const res = await request(app).post('/api/admin/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects login with incorrect password', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'admin', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login with non-existent username', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'hacker', password: 'testadminpassword123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('authenticates valid credentials, sets secure cookie, and returns CSRF token', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'admin', password: 'testadminpassword123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.csrfToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();

      const rawCookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(rawCookies) ? rawCookies.join('; ') : String(rawCookies || '');
      expect(cookieStr).toContain('admin_session=');
      expect(cookieStr).toContain('HttpOnly');
    });

    it('verifies active session via /api/admin/session', async () => {
      const res = await request(app)
        .get('/api/admin/session')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.username).toBe('admin');
    });

    it('reports unauthenticated when session token is absent', async () => {
      const res = await request(app).get('/api/admin/session');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });

    it('logs out and clears session cookies', async () => {
      const res = await request(app)
        .post('/api/admin/logout')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const rawCookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(rawCookies) ? rawCookies.join('; ') : String(rawCookies || '');
      expect(cookieStr).toContain('admin_session=;');
    });
  });

  describe('2. Endpoint Authorization & CSRF Protection', () => {
    it('blocks unauthenticated access to admin endpoints', async () => {
      const res = await request(app).get('/api/admin/dashboard');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('enforces CSRF validation on mutating cookie requests', async () => {
      // Cookie provided without x-csrf-token header
      const res = await request(app)
        .post('/api/admin/keys')
        .set('Cookie', adminCookie)
        .send({ projectName: 'Unauthorized CSRF App' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_MISMATCH');
    });

    it('accepts cookie requests with matching x-csrf-token header', async () => {
      const res = await request(app)
        .post('/api/admin/keys')
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrf)
        .send({ projectName: 'Cookie Authorized App' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toMatch(/^sk_support_[a-f0-9]{64}$/);
    });

    it('accepts requests authenticated via Authorization Bearer token without CSRF requirement', async () => {
      const res = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Bearer Authorized App' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toMatch(/^sk_support_[a-f0-9]{64}$/);
    });
  });

  describe('3. API Key Generation & Management', () => {
    it('generates a new key with high entropy and hides hash from response', async () => {
      const res = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectName: 'Telegram Support Bot',
          description: 'Official student query relay',
          rateLimitPerMinute: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toMatch(/^sk_support_[a-f0-9]{64}$/);

      const record = res.body.record;
      expect(record.projectName).toBe('Telegram Support Bot');
      expect(record.keyPrefix).toMatch(/^sk_support_[a-f0-9]{8}\.\.\.$/);
      expect(record.status).toBe('active');
      expect(record.rateLimitPerMinute).toBe(30);
      expect(record.keyHash).toBeUndefined(); // Hash must never be returned
      expect(record.totalRequests).toBe(0);
    });

    it('validates project name constraints', async () => {
      const res = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'A' }); // Too short

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('lists keys with search and status filters', async () => {
      await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Frontend App Alpha' });

      await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Backend Microservice Beta' });

      const listRes = await request(app)
        .get('/api/admin/keys?search=Alpha')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.keys.length).toBe(1);
      expect(listRes.body.keys[0].projectName).toBe('Frontend App Alpha');
      expect(listRes.body.keys[0].keyHash).toBeUndefined();
    });

    it('updates key status to disabled and back to active', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Toggle App' });

      const keyId = createRes.body.record.id;

      // Disable
      const disableRes = await request(app)
        .patch(`/api/admin/keys/${keyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'disabled' });

      expect(disableRes.status).toBe(200);
      expect(disableRes.body.key.status).toBe('disabled');

      // Re-enable
      const enableRes = await request(app)
        .patch(`/api/admin/keys/${keyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' });

      expect(enableRes.status).toBe(200);
      expect(enableRes.body.key.status).toBe('active');
    });

    it('permanently revokes a key and blocks reactivation', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Revoke Target' });

      const keyId = createRes.body.record.id;

      const revokeRes = await request(app)
        .post(`/api/admin/keys/${keyId}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.key.status).toBe('revoked');

      // Attempting to re-activate revoked key must be rejected
      const reactivateRes = await request(app)
        .patch(`/api/admin/keys/${keyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' });

      expect(reactivateRes.status).toBe(400);
      expect(reactivateRes.body.error.code).toBe('IMMUTABLE_STATE');
    });

    it('rotates a key by revoking the old key and generating a replacement', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Rotatable Service' });

      const oldId = createRes.body.record.id;
      const oldKey = createRes.body.key;

      const rotateRes = await request(app)
        .post(`/api/admin/keys/${oldId}/rotate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.key).toMatch(/^sk_support_[a-f0-9]{64}$/);
      expect(rotateRes.body.key).not.toBe(oldKey);

      // Verify old key is revoked
      const oldKeyDetails = await request(app)
        .get(`/api/admin/keys/${oldId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(oldKeyDetails.body.key.status).toBe('revoked');
    });
  });

  describe('4. Diagnostic API Integration & Usage Accounting', () => {
    it('authenticates diagnostic requests with a valid managed API key', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Integration Client' });

      const apiKey = createRes.body.key;

      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .reply(200, {
          collection: {
            response: {
              statusMsg: 'SUCCESS',
              userDetails: {
                username: 'akshay',
                password: '337b2ac65e5bb92c1f49b6b76b0788b3',
                userId: '149',
              },
            },
          },
        });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', apiKey)
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe('akshay');

      // Verify usage statistics were recorded
      // Wait a tick for background async recording
      await new Promise(r => setTimeout(r, 50));

      const statsRes = await request(app)
        .get(`/api/admin/keys/${createRes.body.record.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(statsRes.body.key.totalRequests).toBe(1);
      expect(statsRes.body.key.successfulRequests).toBe(1);
    });

    it('rejects diagnostic requests using an invalid API key', async () => {
      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', 'sk_support_invalid0000000000000000000000000000000000000000000000000000000000000')
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_KEY');
    });

    it('rejects diagnostic requests when API key is disabled', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Disabled App' });

      const apiKey = createRes.body.key;
      const keyId = createRes.body.record.id;

      await request(app)
        .patch(`/api/admin/keys/${keyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'disabled' });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', apiKey)
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('KEY_DISABLED');
    });

    it('rejects diagnostic requests when API key is revoked', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Revoked App' });

      const apiKey = createRes.body.key;
      const keyId = createRes.body.record.id;

      await request(app)
        .post(`/api/admin/keys/${keyId}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', apiKey)
        .send({ studentNumber: '9599099932' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('KEY_REVOKED');
    });

    it('enforces per-key rate limits', async () => {
      const createRes = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Rate Limited App', rateLimitPerMinute: 2 });

      const apiKey = createRes.body.key;

      nock('https://edunova.abes.ac.in')
        .get('/sims-services/digitalsims/')
        .query(true)
        .times(2)
        .reply(200, {
          collection: { response: { statusMsg: 'SUCCESS', userDetails: { username: 'user1', password: 'hash' } } },
        });

      // Request 1: OK
      const res1 = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', apiKey)
        .send({ studentNumber: '9599099932' });
      expect(res1.status).toBe(200);

      // Request 2: OK
      const res2 = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', apiKey)
        .send({ studentNumber: '9599099932' });
      expect(res2.status).toBe(200);

      // Request 3: Rate Limited (429)
      const res3 = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', apiKey)
        .send({ studentNumber: '9599099932' });
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('5. Dashboard Overview Metrics', () => {
    it('returns genuine persisted metrics across keys and requests', async () => {
      // Create 2 keys
      await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Dashboard App 1' });

      const key2Res = await request(app)
        .post('/api/admin/keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Dashboard App 2' });

      // Revoke key 2
      await request(app)
        .post(`/api/admin/keys/${key2Res.body.record.id}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);

      const dashRes = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(dashRes.status).toBe(200);
      expect(dashRes.body.success).toBe(true);

      const stats = dashRes.body.stats;
      expect(stats.totalKeys).toBe(2);
      expect(stats.activeKeys).toBe(1);
      expect(stats.revokedKeys).toBe(1);
      expect(stats.recentKeys.length).toBe(2);
    });
  });
});
