import request from 'supertest';
import nock from 'nock';
import { app } from '../server';
import { config, resolveDatabaseUrl } from '../config';
import {
  PostgresApiKeyRepository,
  MissingDatabaseRepository,
  maskConnectionString,
  setApiKeyRepository,
} from '../database/apiKeyRepository';
import { apiKeyService } from '../services/apiKeyService';
import { ApiKeyRecord } from '../types/apiKey';

/**
 * High-fidelity Mock PostgreSQL Pool for testing PostgresApiKeyRepository methods and persistence
 * without requiring live network sockets during test execution.
 */
class MockPgPool {
  public apiKeys = new Map<string, any>();
  public apiUsage: any[] = [];
  public adminUsers = new Map<string, any>();
  public shouldFailQuery = false;
  public queryLog: { sql: string; values?: any[] }[] = [];

  async query(text: string, values?: any[]): Promise<any> {
    this.queryLog.push({ sql: text, values });

    if (this.shouldFailQuery) {
      throw new Error('Simulated PostgreSQL query failure');
    }

    const normalized = text.replace(/\s+/g, ' ').trim();

    // Transactions and locks
    if (
      normalized === 'BEGIN' ||
      normalized === 'COMMIT' ||
      normalized === 'ROLLBACK' ||
      normalized.includes('pg_advisory_xact_lock')
    ) {
      return { rows: [], rowCount: 0 };
    }

    // DDL commands
    if (
      normalized.startsWith('CREATE TABLE') ||
      normalized.startsWith('ALTER TABLE') ||
      normalized.startsWith('CREATE INDEX')
    ) {
      return { rows: [], rowCount: 0 };
    }

    // Admin Users table queries
    if (normalized.includes('COUNT(*) as count FROM admin_users')) {
      return { rows: [{ count: String(this.adminUsers.size) }] };
    }
    if (normalized.startsWith('INSERT INTO admin_users')) {
      const username = values![0];
      const passwordHash = values![1];
      this.adminUsers.set(username.toLowerCase(), {
        username,
        password_hash: passwordHash,
        updated_at: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes('FROM admin_users WHERE LOWER(username) = LOWER($1)')) {
      const user = this.adminUsers.get(values![0].toLowerCase());
      return { rows: user ? [user] : [] };
    }
    if (normalized.startsWith('UPDATE admin_users SET password_hash = $1')) {
      const hash = values![0];
      const user = this.adminUsers.get(values![1].toLowerCase());
      if (user) user.password_hash = hash;
      return { rows: [], rowCount: user ? 1 : 0 };
    }
    if (normalized.startsWith('DELETE FROM admin_users')) {
      this.adminUsers.delete(values![0].toLowerCase());
      return { rows: [], rowCount: 1 };
    }

    // API Keys table queries
    if (normalized.startsWith('INSERT INTO api_keys')) {
      const row = {
        id: values![0],
        name: values![1],
        project_name: values![2],
        description: values![3],
        key_prefix: values![4],
        key_hash: values![5],
        status: values![6],
        created_at: new Date(values![7]),
        updated_at: new Date(values![8]),
        expires_at: values![9] ? new Date(values![9]) : null,
        revoked_at: values![10] ? new Date(values![10]) : null,
        last_used_at: values![11] ? new Date(values![11]) : null,
        rate_limit_per_minute: values![12],
        total_requests: values![13] || 0,
        successful_requests: values![14] || 0,
        failed_requests: values![15] || 0,
      };
      this.apiKeys.set(row.id, row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('SELECT') && normalized.includes('FROM api_keys WHERE id = $1')) {
      const row = this.apiKeys.get(values![0]);
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('SELECT') && normalized.includes('FROM api_keys WHERE key_hash = $1')) {
      for (const row of this.apiKeys.values()) {
        if (row.key_hash === values![0]) {
          return { rows: [row] };
        }
      }
      return { rows: [] };
    }

    if (normalized.startsWith('SELECT COUNT(*) as count FROM api_keys')) {
      let rows = Array.from(this.apiKeys.values());
      if (values && values.length > 0 && normalized.includes('LOWER(project_name) LIKE')) {
        const q = values[0].replace(/%/g, '').toLowerCase();
        rows = rows.filter(
          r =>
            (r.project_name || '').toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q)
        );
      }
      return { rows: [{ count: String(rows.length) }] };
    }

    if (normalized.includes('LIMIT 5') && normalized.includes('ORDER BY')) {
      const sorted = Array.from(this.apiKeys.values()).slice(0, 5);
      return { rows: sorted };
    }

    if (normalized.includes('SELECT * FROM api_keys') && normalized.includes('LIMIT')) {
      let rows = Array.from(this.apiKeys.values()).sort(
        (a, b) => b.created_at.getTime() - a.created_at.getTime()
      );
      const limit = values![values!.length - 2];
      const offset = values![values!.length - 1];
      return { rows: rows.slice(offset, offset + limit) };
    }

    if (normalized.startsWith('UPDATE api_keys SET')) {
      const id = values![0];
      const existing = this.apiKeys.get(id);
      if (!existing) return { rows: [], rowCount: 0 };

      if (normalized.includes("status = 'revoked'")) {
        existing.status = 'revoked';
        existing.revoked_at = new Date();
      }

      if (normalized.includes('project_name = $')) {
        existing.project_name = values![1];
        existing.name = values![1];
      }

      if (normalized.includes('description = $')) {
        // Find description in parameters
        const descVal = values!.find((v, idx) => idx > 0 && typeof v === 'string' && v !== existing.project_name);
        if (descVal !== undefined) {
          existing.description = descVal;
        }
      }

      if (normalized.includes('status = $')) {
        const stVal = values!.find(v => v === 'active' || v === 'disabled' || v === 'revoked');
        if (stVal) {
          existing.status = stVal;
          if (stVal === 'revoked') existing.revoked_at = new Date();
        }
      }

      if (normalized.includes('total_requests = total_requests +')) {
        existing.total_requests = Number(existing.total_requests) + Number(values![1]);
        existing.successful_requests = Number(existing.successful_requests) + Number(values![2]);
        existing.failed_requests = Number(existing.failed_requests) + Number(values![3]);
        existing.last_used_at = new Date(values![4]);
      }

      existing.updated_at = new Date();
      this.apiKeys.set(id, existing);
      return { rows: [existing], rowCount: 1 };
    }

    if (normalized.startsWith('DELETE FROM api_keys')) {
      const id = values![0];
      const deleted = this.apiKeys.delete(id);
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }

    // Usage log queries
    if (normalized.startsWith('INSERT INTO api_key_usage')) {
      this.apiUsage.unshift({
        id: values![0],
        key_id: values![1],
        endpoint: values![2],
        status_code: values![3],
        response_time_ms: values![4],
        ip_address: values![5],
        timestamp: new Date(values![6]),
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.includes('FROM api_key_usage WHERE key_id = $1')) {
      const logs = this.apiUsage
        .filter(u => u.key_id === values![0])
        .slice(0, values![1] || 50);
      return { rows: logs };
    }

    // Dashboard stats
    if (normalized.includes('COUNT(*) as total_keys') && normalized.includes('FILTER')) {
      const all = Array.from(this.apiKeys.values());
      const now = new Date();
      return {
        rows: [
          {
            total_keys: all.length,
            active_keys: all.filter(k => k.status === 'active' && (!k.expires_at || k.expires_at > now))
              .length,
            revoked_keys: all.filter(k => k.status === 'revoked').length,
            disabled_keys: all.filter(k => k.status === 'disabled').length,
            expired_keys: all.filter(k => k.status !== 'revoked' && k.expires_at && k.expires_at <= now)
              .length,
            total_requests: all.reduce((acc, k) => acc + Number(k.total_requests || 0), 0),
            successful_requests: all.reduce((acc, k) => acc + Number(k.successful_requests || 0), 0),
            failed_requests: all.reduce((acc, k) => acc + Number(k.failed_requests || 0), 0),
          },
        ],
      };
    }

    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<any> {
    return {
      query: (text: string, values?: any[]) => this.query(text, values),
      release: () => {},
    };
  }

  async end(): Promise<void> {}
  on(): this {
    return this;
  }
}

describe('Neon PostgreSQL Persistence & Repository Resilience', () => {
  let mockPool: MockPgPool;
  let postgresRepo: PostgresApiKeyRepository;
  let adminToken: string;

  beforeEach(async () => {
    nock.cleanAll();
    mockPool = new MockPgPool();
    postgresRepo = new PostgresApiKeyRepository(mockPool as any);
    setApiKeyRepository(postgresRepo);

    // Bootstrap test administrator credentials
    config.adminUsername = 'admin';
    config.adminPassword = 'testpassword123';

    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'testpassword123' });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  afterAll(() => {
    setApiKeyRepository(null);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('1. Connection Configuration & URL Resolution', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('resolves DATABASE_URL preferentially', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep-cool.neon.tech/neondb?sslmode=require';
      process.env.POSTGRES_URL = 'postgres://fallback:pass@ep-fallback.neon.tech/neondb';
      expect(resolveDatabaseUrl()).toBe('postgres://user:pass@ep-cool.neon.tech/neondb?sslmode=require');
    });

    it('falls back to POSTGRES_URL when DATABASE_URL is absent', () => {
      delete process.env.DATABASE_URL;
      process.env.POSTGRES_URL = 'postgres://neon_user:neon_pass@ep-pooler.neon.tech/neondb';
      expect(resolveDatabaseUrl()).toBe('postgres://neon_user:neon_pass@ep-pooler.neon.tech/neondb');
    });

    it('resolves unpooled connection string if standard pooled is unset', () => {
      delete process.env.DATABASE_URL;
      delete process.env.POSTGRES_URL;
      delete process.env.DATABASE_POSTGRES_URL;
      delete process.env.POSTGRES_PRISMA_URL;
      process.env.DATABASE_URL_UNPOOLED = 'postgresql://direct_user:direct_pass@ep-direct.neon.tech/neondb';
      expect(resolveDatabaseUrl()).toBe('postgresql://direct_user:direct_pass@ep-direct.neon.tech/neondb');
    });

    it('returns undefined if non-postgres URL is passed', () => {
      process.env.DATABASE_URL = 'http://not-a-db-url.com';
      expect(resolveDatabaseUrl()).toBeUndefined();
    });

    it('masks database passwords in connection strings to protect secrets', () => {
      const masked = maskConnectionString('postgres://neon_admin:SuperSecretPass123@ep-test.neon.tech/neondb?sslmode=require');
      expect(masked).not.toContain('SuperSecretPass123');
      expect(masked).toContain('neon_admin:***@ep-test.neon.tech');
    });

    it('handles empty or undefined connection string in maskConnectionString', () => {
      expect(maskConnectionString(undefined)).toBe('[NOT CONFIGURED]');
      expect(maskConnectionString('')).toBe('[NOT CONFIGURED]');
    });
  });

  describe('2. Safe Concurrency & Schema Initialization', () => {
    it('initializes tables and acquires pg_advisory_xact_lock during init()', async () => {
      await postgresRepo.init();
      const lockQuery = mockPool.queryLog.find(q => q.sql.includes('pg_advisory_xact_lock'));
      expect(lockQuery).toBeDefined();

      const createApiKeysQuery = mockPool.queryLog.find(q => q.sql.includes('CREATE TABLE IF NOT EXISTS api_keys'));
      expect(createApiKeysQuery).toBeDefined();
    });

    it('deduplicates concurrent in-process calls to init()', async () => {
      const freshPool = new MockPgPool();
      const freshRepo = new PostgresApiKeyRepository(freshPool as any);
      const initPromise1 = freshRepo.init();
      const initPromise2 = freshRepo.init();
      await Promise.all([initPromise1, initPromise2]);

      const beginQueries = freshPool.queryLog.filter(q => q.sql.trim() === 'BEGIN');
      expect(beginQueries.length).toBe(1);
    });
  });

  describe('3. Key Creation, Listing, and PostgreSQL Persistence', () => {
    it('creates an API key and commits record into PostgreSQL', async () => {
      const res = await request(app)
        .post('/admin/api/client-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Postgres Persistence App',
          description: 'Testing Neon persistent storage',
          rate_limit_per_minute: 120,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toMatch(/^sk_support_[a-f0-9]{64}$/);
      expect(res.body.record.projectName).toBe('Postgres Persistence App');

      // Verify record exists in PostgreSQL storage
      const dbRecord = mockPool.apiKeys.get(res.body.record.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord.project_name).toBe('Postgres Persistence App');
      expect(dbRecord.key_hash).toBeDefined();
      expect(dbRecord.key_hash).not.toBe(res.body.key); // Hash is stored, not plaintext
    });

    it('lists keys directly from PostgreSQL', async () => {
      const createRes = await request(app)
        .post('/admin/api/client-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Listable App' });

      const keyId = createRes.body.record.id;

      const listRes = await request(app)
        .get('/admin/api/client-keys')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      const found = listRes.body.keys.find((k: any) => k.id === keyId);
      expect(found).toBeDefined();
      expect(found.name).toBe('Listable App');
    });

    it('persists data across application restarts or new repository instances', async () => {
      // 1. Create a key in repo instance 1
      const created = await apiKeyService.createKey({
        projectName: 'Survives Restart App',
        description: 'Should persist across new server instance',
      });

      // 2. Simulate server restart by creating a new repository instance pointing to the same DB
      const freshRepo = new PostgresApiKeyRepository(mockPool as any);
      setApiKeyRepository(freshRepo);

      // 3. Retrieve key from new repository instance
      const fetched = await freshRepo.getKeyById(created.record.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.projectName).toBe('Survives Restart App');
      expect(fetched?.status).toBe('active');
    });
  });

  describe('4. Authentication against Persistent PostgreSQL Keys', () => {
    it('authenticates a valid persistent API key', async () => {
      const { key } = await apiKeyService.createKey({ projectName: 'Auth Test App' });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', key)
        .send({ studentNumber: '9999999999' });

      // Passes auth (status will not be 401/403)
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('rejects an invalid or forged API key', async () => {
      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', 'sk_support_0000000000000000000000000000000000000000000000000000000000000000')
        .send({ studentNumber: '9999999999' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_KEY');
    });

    it('rejects a revoked API key with 403', async () => {
      const { key, record } = await apiKeyService.createKey({ projectName: 'Revoke App' });

      // Revoke the key
      await apiKeyService.revokeKey(record.id);

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', key)
        .send({ studentNumber: '9999999999' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('KEY_REVOKED');
    });

    it('rejects a disabled API key with 403', async () => {
      const { key, record } = await apiKeyService.createKey({ projectName: 'Disabled App' });

      // Disable the key
      await apiKeyService.updateKey(record.id, { status: 'disabled' });

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', key)
        .send({ studentNumber: '9999999999' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('KEY_DISABLED');
    });

    it('rejects an expired API key with 403', async () => {
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const record: ApiKeyRecord = {
        id: 'expired-test-id',
        projectName: 'Expired App',
        description: 'Expired test',
        keyPrefix: 'sk_support_exp123...',
        keyHash: apiKeyService.hashKey('sk_support_exp1234567890abcdef1234567890abcdef'),
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: pastDate,
        lastUsedAt: null,
        rateLimitPerMinute: null,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
      };

      await postgresRepo.createKey(record);

      const res = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', 'sk_support_exp1234567890abcdef1234567890abcdef')
        .send({ studentNumber: '9999999999' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('KEY_EXPIRED');
    });

    it('prevents future authentication when a key is deleted from PostgreSQL', async () => {
      const { key, record } = await apiKeyService.createKey({ projectName: 'Delete Target' });

      // Confirm works
      const authRes1 = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', key)
        .send({ studentNumber: '9999999999' });
      expect(authRes1.status).not.toBe(401);

      // Delete the key
      const deleted = await apiKeyService.deleteKey(record.id);
      expect(deleted).toBe(true);

      // Confirm fails now
      const authRes2 = await request(app)
        .post('/api/support/login-diagnostics')
        .set('x-api-key', key)
        .send({ studentNumber: '9999999999' });
      expect(authRes2.status).toBe(401);
    });
  });

  describe('5. Key Lifecycle: Update, Revoke, Rotate, and Usage Tracking', () => {
    it('updates key name and description in PostgreSQL', async () => {
      const { record } = await apiKeyService.createKey({ projectName: 'Original Name' });

      const res = await request(app)
        .patch(`/api/admin/keys/${record.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectName: 'Updated Name', description: 'Updated Description' });

      expect(res.status).toBe(200);
      expect(res.body.key.projectName).toBe('Updated Name');

      const inDb = mockPool.apiKeys.get(record.id);
      expect(inDb.project_name).toBe('Updated Name');
      expect(inDb.description).toBe('Updated Description');
    });

    it('prevents reactivating a revoked key in PostgreSQL', async () => {
      const { record } = await apiKeyService.createKey({ projectName: 'Irreversible Revoke' });
      await apiKeyService.revokeKey(record.id);

      const res = await request(app)
        .patch(`/api/admin/keys/${record.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMMUTABLE_STATE');
    });

    it('atomically rotates a key: revokes existing key and creates replacement', async () => {
      const { key: oldKey, record: oldRecord } = await apiKeyService.createKey({
        projectName: 'Rotate Parent',
        rateLimitPerMinute: 80,
      });

      const res = await request(app)
        .post(`/api/admin/keys/${oldRecord.id}/rotate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.key).toMatch(/^sk_support_[a-f0-9]{64}$/);
      expect(res.body.key).not.toBe(oldKey);

      // Verify old key is revoked in DB
      const oldInDb = mockPool.apiKeys.get(oldRecord.id);
      expect(oldInDb.status).toBe('revoked');
      expect(oldInDb.revoked_at).toBeDefined();

      // Verify new key is active in DB
      const newInDb = mockPool.apiKeys.get(res.body.record.id);
      expect(newInDb.status).toBe('active');
      expect(newInDb.project_name).toBe('Rotate Parent');
      expect(newInDb.rate_limit_per_minute).toBe(80);
    });

    it('records usage statistics into PostgreSQL and increments total requests', async () => {
      const { record } = await apiKeyService.createKey({ projectName: 'Usage Metrics App' });

      await apiKeyService.recordUsage(record.id, {
        endpoint: '/api/support/login-diagnostics',
        statusCode: 200,
        responseTimeMs: 42,
        ipAddress: '127.0.0.1',
      });

      const updated = await postgresRepo.getKeyById(record.id);
      expect(updated?.totalRequests).toBe(1);
      expect(updated?.successfulRequests).toBe(1);
      expect(updated?.failedRequests).toBe(0);

      const history = await postgresRepo.getUsageHistory(record.id);
      expect(history.length).toBe(1);
      expect(history[0].statusCode).toBe(200);
      expect(history[0].responseTimeMs).toBe(42);
    });

    it('retrieves aggregated dashboard metrics from PostgreSQL', async () => {
      await apiKeyService.createKey({ projectName: 'Metric App 1' });
      const { record: r2 } = await apiKeyService.createKey({ projectName: 'Metric App 2' });
      await apiKeyService.revokeKey(r2.id);

      const stats = await postgresRepo.getDashboardStats();
      expect(stats.totalKeys).toBeGreaterThanOrEqual(2);
      expect(stats.revokedKeys).toBeGreaterThanOrEqual(1);
    });
  });

  describe('6. Error Handling & Missing Database Configuration', () => {
    it('does not mask database write failure as success', async () => {
      mockPool.shouldFailQuery = true;

      const res = await request(app)
        .post('/admin/api/client-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Failing DB Write' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it('MissingDatabaseRepository throws sanitized error without silent in-memory fallback', async () => {
      const missingDbRepo = new MissingDatabaseRepository();

      await expect(missingDbRepo.createKey({} as any)).rejects.toThrow(
        'Persistent database configuration is missing: DATABASE_URL must be configured in production.'
      );
      await expect(missingDbRepo.listKeys()).rejects.toThrow(
        'Persistent database configuration is missing: DATABASE_URL must be configured in production.'
      );
      await expect(missingDbRepo.getKeyById('any-id')).rejects.toThrow(
        'Persistent database configuration is missing: DATABASE_URL must be configured in production.'
      );
    });

    it('rejects unauthorized requests to create or manage API keys', async () => {
      const res = await request(app)
        .post('/admin/api/client-keys')
        .send({ name: 'Unauthorized Key' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
