import { Pool, PoolClient } from 'pg';
import {
  ApiKeyRecord,
  ApiKeyPublic,
  ApiKeyUsageRecord,
  DashboardStats,
  ListKeysOptions,
} from '../types/apiKey';
import { config } from '../config';
import { hashPassword } from '../security/passwordHasher';
import logger from '../utils/logger';

export interface AdminUserData {
  username: string;
  passwordHash: string;
}

export interface IApiKeyRepository {
  init(): Promise<void>;
  createKey(record: ApiKeyRecord): Promise<void>;
  getKeyById(id: string): Promise<ApiKeyRecord | null>;
  getKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  listKeys(options?: ListKeysOptions): Promise<{ keys: ApiKeyRecord[]; total: number }>;
  updateKey(id: string, updates: Partial<ApiKeyRecord>): Promise<ApiKeyRecord | null>;
  deleteKey(id: string): Promise<boolean>;
  rotateKey?(oldId: string, newRecord: ApiKeyRecord): Promise<void>;
  recordUsage(usage: ApiKeyUsageRecord, statsDelta: { total: number; success: number; failure: number }): Promise<void>;
  getUsageHistory(keyId: string, limit?: number): Promise<ApiKeyUsageRecord[]>;
  getDashboardStats(): Promise<DashboardStats>;
  getAdminUser(username: string): Promise<AdminUserData | null>;
  saveAdminUser(username: string, passwordHash: string): Promise<void>;
  updateAdminCredentials(oldUsername: string, newUsername: string, newPasswordHash?: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Sanitizes an API key record by removing keyHash before transmitting to clients.
 */
export function sanitizeKeyRecord(record: ApiKeyRecord): ApiKeyPublic {
  const { keyHash: _hash, ...sanitized } = record;
  return sanitized;
}

/**
 * Masks sensitive passwords inside database connection strings to prevent credential leaks in logs.
 */
export function maskConnectionString(url?: string): string {
  if (!url) return '[NOT CONFIGURED]';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[CONFIGURED (masked)]';
  }
}

// In-Memory Repository for local dev without Postgres / isolated testing
export class MemoryApiKeyRepository implements IApiKeyRepository {
  private keys = new Map<string, ApiKeyRecord>();
  private usage = new Map<string, ApiKeyUsageRecord[]>();
  private adminUsers = new Map<string, AdminUserData>();

  constructor() {
    // Seed initial admin user if not present
    const defaultUser = config.adminUsername || 'inexpert_trifler';
    const defaultPass = config.adminPassword || 'om sai 0987654321';
    this.adminUsers.set(defaultUser.toLowerCase(), {
      username: defaultUser,
      passwordHash: hashPassword(defaultPass),
    });
  }

  async init(): Promise<void> {
    // In-memory does not require asynchronous initialization
  }

  async createKey(record: ApiKeyRecord): Promise<void> {
    this.keys.set(record.id, { ...record });
  }

  async getKeyById(id: string): Promise<ApiKeyRecord | null> {
    const record = this.keys.get(id);
    return record ? { ...record } : null;
  }

  async getKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    for (const record of this.keys.values()) {
      if (record.keyHash === hash) {
        return { ...record };
      }
    }
    return null;
  }

  async listKeys(options?: ListKeysOptions): Promise<{ keys: ApiKeyRecord[]; total: number }> {
    let all = Array.from(this.keys.values());

    if (options?.search) {
      const q = options.search.toLowerCase();
      all = all.filter(
        k =>
          k.projectName.toLowerCase().includes(q) ||
          (k.name && k.name.toLowerCase().includes(q)) ||
          k.description.toLowerCase().includes(q) ||
          k.keyPrefix.toLowerCase().includes(q) ||
          k.id.toLowerCase().includes(q)
      );
    }

    if (options?.status && options.status !== 'all') {
      all = all.filter(k => k.status === options.status);
    }

    // Sort descending by created_at
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = all.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    const paginated = all.slice(offset, offset + limit);

    return { keys: paginated, total };
  }

  async updateKey(id: string, updates: Partial<ApiKeyRecord>): Promise<ApiKeyRecord | null> {
    const existing = this.keys.get(id);
    if (!existing) return null;

    // Revoked keys cannot be unrevoked
    if (existing.status === 'revoked' && updates.status && updates.status !== 'revoked') {
      throw new Error('Revoked API keys cannot be reactivated.');
    }

    const updated: ApiKeyRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === 'revoked' && !existing.revokedAt) {
      updated.revokedAt = new Date().toISOString();
    }

    this.keys.set(id, updated);
    return { ...updated };
  }

  async deleteKey(id: string): Promise<boolean> {
    const deleted = this.keys.delete(id);
    this.usage.delete(id);
    return deleted;
  }

  async rotateKey(oldId: string, newRecord: ApiKeyRecord): Promise<void> {
    const existing = this.keys.get(oldId);
    if (!existing) {
      throw new Error(`API key ${oldId} not found.`);
    }
    const now = new Date().toISOString();
    existing.status = 'revoked';
    existing.revokedAt = now;
    existing.updatedAt = now;
    this.keys.set(oldId, existing);
    this.keys.set(newRecord.id, { ...newRecord });
  }

  async getAdminUser(username: string): Promise<AdminUserData | null> {
    const user = this.adminUsers.get(username.trim().toLowerCase());
    return user ? { ...user } : null;
  }

  async saveAdminUser(username: string, passwordHash: string): Promise<void> {
    this.adminUsers.set(username.trim().toLowerCase(), {
      username: username.trim(),
      passwordHash,
    });
  }

  async updateAdminCredentials(oldUsername: string, newUsername: string, newPasswordHash?: string): Promise<void> {
    const existing = await this.getAdminUser(oldUsername);
    if (!existing) {
      throw new Error('Admin user not found.');
    }
    this.adminUsers.delete(oldUsername.trim().toLowerCase());
    this.adminUsers.set(newUsername.trim().toLowerCase(), {
      username: newUsername.trim(),
      passwordHash: newPasswordHash || existing.passwordHash,
    });
  }

  async recordUsage(
    usage: ApiKeyUsageRecord,
    statsDelta: { total: number; success: number; failure: number }
  ): Promise<void> {
    const key = this.keys.get(usage.keyId);
    if (key) {
      key.totalRequests += statsDelta.total;
      key.successfulRequests += statsDelta.success;
      key.failedRequests += statsDelta.failure;
      key.lastUsedAt = usage.timestamp;
      key.updatedAt = new Date().toISOString();
      this.keys.set(usage.keyId, key);
    }

    const logs = this.usage.get(usage.keyId) || [];
    logs.unshift(usage);
    if (logs.length > 200) {
      logs.length = 200; // retain last 200
    }
    this.usage.set(usage.keyId, logs);
  }

  async getUsageHistory(keyId: string, limit = 50): Promise<ApiKeyUsageRecord[]> {
    const logs = this.usage.get(keyId) || [];
    return logs.slice(0, limit);
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const all = Array.from(this.keys.values());
    const now = new Date();

    let totalKeys = all.length;
    let activeKeys = 0;
    let revokedKeys = 0;
    let disabledKeys = 0;
    let expiredKeys = 0;
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;

    for (const k of all) {
      if (k.status === 'revoked') {
        revokedKeys++;
      } else if (k.expiresAt && new Date(k.expiresAt) < now) {
        expiredKeys++;
      } else if (k.status === 'disabled') {
        disabledKeys++;
      } else if (k.status === 'active') {
        activeKeys++;
      }

      totalRequests += Number(k.totalRequests || 0);
      successfulRequests += Number(k.successfulRequests || 0);
      failedRequests += Number(k.failedRequests || 0);
    }

    // Top recent keys (sorted by lastUsedAt or createdAt)
    const sorted = [...all].sort((a, b) => {
      const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : new Date(a.createdAt).getTime();
      return bTime - aTime;
    });

    return {
      totalKeys,
      activeKeys,
      revokedKeys,
      disabledKeys,
      expiredKeys,
      totalRequests,
      successfulRequests,
      failedRequests,
      recentKeys: sorted.slice(0, 5).map(sanitizeKeyRecord),
    };
  }

  async close(): Promise<void> {
    this.keys.clear();
    this.usage.clear();
  }
}

// Production Failure Repository when DATABASE_URL is missing in production
export class MissingDatabaseRepository implements IApiKeyRepository {
  private readonly errorMessage =
    'Persistent database configuration is missing: DATABASE_URL must be configured in production.';

  async init(): Promise<void> {
    throw new Error(this.errorMessage);
  }
  async createKey(_record: ApiKeyRecord): Promise<void> {
    throw new Error(this.errorMessage);
  }
  async getKeyById(_id: string): Promise<ApiKeyRecord | null> {
    throw new Error(this.errorMessage);
  }
  async getKeyByHash(_hash: string): Promise<ApiKeyRecord | null> {
    throw new Error(this.errorMessage);
  }
  async listKeys(_options?: ListKeysOptions): Promise<{ keys: ApiKeyRecord[]; total: number }> {
    throw new Error(this.errorMessage);
  }
  async updateKey(_id: string, _updates: Partial<ApiKeyRecord>): Promise<ApiKeyRecord | null> {
    throw new Error(this.errorMessage);
  }
  async deleteKey(_id: string): Promise<boolean> {
    throw new Error(this.errorMessage);
  }
  async rotateKey(_oldId: string, _newRecord: ApiKeyRecord): Promise<void> {
    throw new Error(this.errorMessage);
  }
  async recordUsage(
    _usage: ApiKeyUsageRecord,
    _statsDelta: { total: number; success: number; failure: number }
  ): Promise<void> {
    throw new Error(this.errorMessage);
  }
  async getUsageHistory(_keyId: string, _limit?: number): Promise<ApiKeyUsageRecord[]> {
    throw new Error(this.errorMessage);
  }
  async getDashboardStats(): Promise<DashboardStats> {
    throw new Error(this.errorMessage);
  }
  async getAdminUser(_username: string): Promise<AdminUserData | null> {
    throw new Error(this.errorMessage);
  }
  async saveAdminUser(_username: string, _passwordHash: string): Promise<void> {
    throw new Error(this.errorMessage);
  }
  async updateAdminCredentials(
    _oldUsername: string,
    _newUsername: string,
    _newPasswordHash?: string
  ): Promise<void> {
    throw new Error(this.errorMessage);
  }
  async close(): Promise<void> {
    // no-op
  }
}

// PostgreSQL Repository for production Neon persistence
export class PostgresApiKeyRepository implements IApiKeyRepository {
  private pool: Pool;
  private initialized = false;
  private static initPromise: Promise<void> | null = null;

  constructor(connectionStringOrPool: string | Pool) {
    if (typeof connectionStringOrPool === 'string') {
      // Reuse pool across warm serverless invocations to prevent connection exhaustion
      const globalAny = global as any;
      if (!globalAny.__neonPgPool) {
        const isLocal =
          connectionStringOrPool.includes('localhost') || connectionStringOrPool.includes('127.0.0.1');

        globalAny.__neonPgPool = new Pool({
          connectionString: connectionStringOrPool,
          ssl: isLocal ? false : { rejectUnauthorized: false },
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000, // 10s gives Neon time to wake up if compute was suspended
          statement_timeout: 5000, // 5s statement timeout prevents hanging queries from exhausting pool
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
          allowExitOnIdle: true,
        });

        globalAny.__neonPgPool.on('error', (err: any) => {
          logger.error({ err }, 'Unexpected PostgreSQL pool client error');
        });
      }
      this.pool = globalAny.__neonPgPool;
    } else {
      this.pool = connectionStringOrPool;
    }
  }

  /**
   * Initializes schema safely under concurrent serverless invocations using PostgreSQL advisory locks.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (PostgresApiKeyRepository.initPromise) {
      return PostgresApiKeyRepository.initPromise;
    }

    PostgresApiKeyRepository.initPromise = (async () => {
      let client: PoolClient | null = null;
      try {
        client = await this.pool.connect();
        await client.query('BEGIN');

        // Acquire advisory transaction lock (releases automatically on COMMIT or ROLLBACK)
        await client.query('SELECT pg_advisory_xact_lock(84920491)');

        // Create core api_keys table
        await client.query(`
          CREATE TABLE IF NOT EXISTS api_keys (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255),
            project_name VARCHAR(255) NOT NULL,
            description TEXT,
            key_prefix VARCHAR(32) NOT NULL,
            key_hash VARCHAR(128) NOT NULL UNIQUE,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NULL,
            revoked_at TIMESTAMPTZ NULL,
            last_used_at TIMESTAMPTZ NULL,
            rate_limit_per_minute INTEGER NULL,
            total_requests BIGINT NOT NULL DEFAULT 0,
            successful_requests BIGINT NOT NULL DEFAULT 0,
            failed_requests BIGINT NOT NULL DEFAULT 0
          );
        `);

        // Non-destructive column additions in case table was created with older schema
        await client.query(`
          ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS name VARCHAR(255);
          ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;
        `);

        // Create api_key_usage log table
        await client.query(`
          CREATE TABLE IF NOT EXISTS api_key_usage (
            id VARCHAR(64) PRIMARY KEY,
            key_id VARCHAR(64) NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
            endpoint VARCHAR(255) NOT NULL,
            status_code INTEGER NOT NULL,
            response_time_ms INTEGER NOT NULL,
            ip_address VARCHAR(64),
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);

        // Create admin_users table
        await client.query(`
          CREATE TABLE IF NOT EXISTS admin_users (
            username VARCHAR(100) PRIMARY KEY,
            password_hash VARCHAR(255) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);

        // Create indexes for efficient lookup
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
          CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
          CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_id ON api_key_usage(key_id);
          CREATE INDEX IF NOT EXISTS idx_api_key_usage_timestamp ON api_key_usage(timestamp DESC);
        `);

        // Bootstrap default administrator credentials if none exist
        const adminCountRes = await client.query('SELECT COUNT(*) as count FROM admin_users');
        if (parseInt(adminCountRes.rows[0]?.count || '0', 10) === 0) {
          const defaultUser = config.adminUsername || 'inexpert_trifler';
          const defaultPass = config.adminPassword || 'om sai 0987654321';
          const hashed = hashPassword(defaultPass);
          await client.query(
            'INSERT INTO admin_users (username, password_hash, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (username) DO NOTHING',
            [defaultUser, hashed]
          );
          logger.info({ username: defaultUser }, 'Bootstrap administrator credentials initialized in PostgreSQL');
        }

        await client.query('COMMIT');
        this.initialized = true;
        logger.info('Neon PostgreSQL tables and indexes verified successfully');
      } catch (err) {
        if (client) {
          await client.query('ROLLBACK').catch(() => {});
        }
        logger.error({ err }, 'Failed to initialize PostgreSQL API key schema');
        throw err;
      } finally {
        if (client) {
          client.release();
        }
        PostgresApiKeyRepository.initPromise = null;
      }
    })();

    return PostgresApiKeyRepository.initPromise;
  }

  private mapRowToRecord(row: any): ApiKeyRecord {
    const toIso = (val: any): string => {
      if (!val) return '';
      return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
    };

    return {
      id: row.id,
      name: row.name || row.project_name || '',
      projectName: row.project_name || row.name || '',
      description: row.description || '',
      keyPrefix: row.key_prefix,
      keyHash: row.key_hash,
      status: row.status,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      expiresAt: row.expires_at ? toIso(row.expires_at) : null,
      revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
      lastUsedAt: row.last_used_at ? toIso(row.last_used_at) : null,
      rateLimitPerMinute: row.rate_limit_per_minute != null ? parseInt(row.rate_limit_per_minute, 10) : null,
      totalRequests: parseInt(row.total_requests || '0', 10),
      successfulRequests: parseInt(row.successful_requests || '0', 10),
      failedRequests: parseInt(row.failed_requests || '0', 10),
    };
  }

  async createKey(record: ApiKeyRecord): Promise<void> {
    await this.init();
    const query = `
      INSERT INTO api_keys (
        id, name, project_name, description, key_prefix, key_hash, status,
        created_at, updated_at, expires_at, revoked_at, last_used_at, rate_limit_per_minute,
        total_requests, successful_requests, failed_requests
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;

    await this.pool.query(query, [
      record.id,
      record.name || record.projectName,
      record.projectName,
      record.description,
      record.keyPrefix,
      record.keyHash,
      record.status,
      record.createdAt,
      record.updatedAt,
      record.expiresAt,
      record.revokedAt || null,
      record.lastUsedAt,
      record.rateLimitPerMinute,
      record.totalRequests,
      record.successfulRequests,
      record.failedRequests,
    ]);
  }

  async getKeyById(id: string): Promise<ApiKeyRecord | null> {
    await this.init();
    const res = await this.pool.query('SELECT * FROM api_keys WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRowToRecord(res.rows[0]);
  }

  async getKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    await this.init();
    const res = await this.pool.query('SELECT * FROM api_keys WHERE key_hash = $1', [hash]);
    if (res.rows.length === 0) return null;
    return this.mapRowToRecord(res.rows[0]);
  }

  async listKeys(options?: ListKeysOptions): Promise<{ keys: ApiKeyRecord[]; total: number }> {
    await this.init();
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (options?.search) {
      conditions.push(
        `(LOWER(project_name) LIKE $${paramIndex} OR LOWER(COALESCE(name, '')) LIKE $${paramIndex} OR LOWER(description) LIKE $${paramIndex} OR LOWER(key_prefix) LIKE $${paramIndex} OR LOWER(id) LIKE $${paramIndex})`
      );
      values.push(`%${options.search.toLowerCase()}%`);
      paramIndex++;
    }

    if (options?.status && options.status !== 'all') {
      conditions.push(`status = $${paramIndex}`);
      values.push(options.status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await this.pool.query(`SELECT COUNT(*) as count FROM api_keys ${whereClause}`, values);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const dataQuery = `
      SELECT * FROM api_keys
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limit, offset);

    const dataRes = await this.pool.query(dataQuery, values);
    const keys = dataRes.rows.map(r => this.mapRowToRecord(r));

    return { keys, total };
  }

  async updateKey(id: string, updates: Partial<ApiKeyRecord>): Promise<ApiKeyRecord | null> {
    await this.init();

    // Check existing
    const existing = await this.getKeyById(id);
    if (!existing) return null;

    if (existing.status === 'revoked' && updates.status && updates.status !== 'revoked') {
      throw new Error('Revoked API keys cannot be reactivated.');
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [id];
    let paramIndex = 2;

    if (updates.projectName !== undefined) {
      setClauses.push(`project_name = $${paramIndex}`);
      setClauses.push(`name = $${paramIndex}`);
      values.push(updates.projectName);
      paramIndex++;
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);

      if (updates.status === 'revoked') {
        setClauses.push('revoked_at = NOW()');
      }
    }
    if (updates.expiresAt !== undefined) {
      setClauses.push(`expires_at = $${paramIndex++}`);
      values.push(updates.expiresAt);
    }
    if (updates.rateLimitPerMinute !== undefined) {
      setClauses.push(`rate_limit_per_minute = $${paramIndex++}`);
      values.push(updates.rateLimitPerMinute);
    }

    const updateQuery = `
      UPDATE api_keys
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const res = await this.pool.query(updateQuery, values);
    if (res.rows.length === 0) return null;
    return this.mapRowToRecord(res.rows[0]);
  }

  async deleteKey(id: string): Promise<boolean> {
    await this.init();
    const res = await this.pool.query('DELETE FROM api_keys WHERE id = $1', [id]);
    return (res.rowCount || 0) > 0;
  }

  /**
   * Atomically revokes an existing key and creates a replacement key in a single transaction.
   */
  async rotateKey(oldId: string, newRecord: ApiKeyRecord): Promise<void> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const revokeRes = await client.query(
        `UPDATE api_keys SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [oldId]
      );

      if ((revokeRes.rowCount || 0) === 0) {
        throw new Error(`API key ${oldId} not found.`);
      }

      await client.query(
        `INSERT INTO api_keys (
          id, name, project_name, description, key_prefix, key_hash, status,
          created_at, updated_at, expires_at, revoked_at, last_used_at, rate_limit_per_minute,
          total_requests, successful_requests, failed_requests
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          newRecord.id,
          newRecord.name || newRecord.projectName,
          newRecord.projectName,
          newRecord.description,
          newRecord.keyPrefix,
          newRecord.keyHash,
          newRecord.status,
          newRecord.createdAt,
          newRecord.updatedAt,
          newRecord.expiresAt,
          newRecord.revokedAt || null,
          newRecord.lastUsedAt,
          newRecord.rateLimitPerMinute,
          newRecord.totalRequests,
          newRecord.successfulRequests,
          newRecord.failedRequests,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async recordUsage(
    usage: ApiKeyUsageRecord,
    statsDelta: { total: number; success: number; failure: number }
  ): Promise<void> {
    await this.init();

    const updateKeyQuery = `
      UPDATE api_keys
      SET total_requests = total_requests + $2,
          successful_requests = successful_requests + $3,
          failed_requests = failed_requests + $4,
          last_used_at = $5,
          updated_at = NOW()
      WHERE id = $1
    `;

    const insertUsageQuery = `
      INSERT INTO api_key_usage (id, key_id, endpoint, status_code, response_time_ms, ip_address, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    try {
      await Promise.all([
        this.pool.query(updateKeyQuery, [
          usage.keyId,
          statsDelta.total,
          statsDelta.success,
          statsDelta.failure,
          usage.timestamp,
        ]),
        this.pool.query(insertUsageQuery, [
          usage.id,
          usage.keyId,
          usage.endpoint,
          usage.statusCode,
          usage.responseTimeMs,
          usage.ipAddress,
          usage.timestamp,
        ]),
      ]);
    } catch (err) {
      logger.error({ err, keyId: usage.keyId }, 'Failed to record API key usage');
    }
  }

  async getUsageHistory(keyId: string, limit = 50): Promise<ApiKeyUsageRecord[]> {
    await this.init();
    const query = `
      SELECT * FROM api_key_usage
      WHERE key_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `;
    const res = await this.pool.query(query, [keyId, limit]);
    return res.rows.map(r => ({
      id: r.id,
      keyId: r.key_id,
      endpoint: r.endpoint,
      statusCode: parseInt(r.status_code, 10),
      responseTimeMs: parseInt(r.response_time_ms, 10),
      ipAddress: r.ip_address,
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString(),
    }));
  }

  async getDashboardStats(): Promise<DashboardStats> {
    await this.init();
    const statsQuery = `
      SELECT
        COUNT(*) as total_keys,
        COUNT(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())) as active_keys,
        COUNT(*) FILTER (WHERE status = 'revoked') as revoked_keys,
        COUNT(*) FILTER (WHERE status = 'disabled') as disabled_keys,
        COUNT(*) FILTER (WHERE status != 'revoked' AND expires_at IS NOT NULL AND expires_at <= NOW()) as expired_keys,
        COALESCE(SUM(total_requests), 0) as total_requests,
        COALESCE(SUM(successful_requests), 0) as successful_requests,
        COALESCE(SUM(failed_requests), 0) as failed_requests
      FROM api_keys
    `;

    const recentQuery = `
      SELECT * FROM api_keys
      ORDER BY COALESCE(last_used_at, created_at) DESC
      LIMIT 5
    `;

    const [statsRes, recentRes] = await Promise.all([
      this.pool.query(statsQuery),
      this.pool.query(recentQuery),
    ]);

    const row = statsRes.rows[0];
    const recentKeys = recentRes.rows.map(r => sanitizeKeyRecord(this.mapRowToRecord(r)));

    return {
      totalKeys: parseInt(row?.total_keys || '0', 10),
      activeKeys: parseInt(row?.active_keys || '0', 10),
      revokedKeys: parseInt(row?.revoked_keys || '0', 10),
      disabledKeys: parseInt(row?.disabled_keys || '0', 10),
      expiredKeys: parseInt(row?.expired_keys || '0', 10),
      totalRequests: parseInt(row?.total_requests || '0', 10),
      successfulRequests: parseInt(row?.successful_requests || '0', 10),
      failedRequests: parseInt(row?.failed_requests || '0', 10),
      recentKeys,
    };
  }

  async getAdminUser(username: string): Promise<AdminUserData | null> {
    await this.init();
    const res = await this.pool.query('SELECT * FROM admin_users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    if (res.rows.length === 0) return null;
    return {
      username: res.rows[0].username,
      passwordHash: res.rows[0].password_hash,
    };
  }

  async saveAdminUser(username: string, passwordHash: string): Promise<void> {
    await this.init();
    const query = `
      INSERT INTO admin_users (username, password_hash, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (username) DO UPDATE
      SET password_hash = $2, updated_at = NOW()
    `;
    await this.pool.query(query, [username.trim(), passwordHash]);
  }

  async updateAdminCredentials(oldUsername: string, newUsername: string, newPasswordHash?: string): Promise<void> {
    await this.init();
    const existing = await this.getAdminUser(oldUsername);
    if (!existing) {
      throw new Error('Admin user not found.');
    }

    if (oldUsername.trim().toLowerCase() === newUsername.trim().toLowerCase()) {
      if (newPasswordHash) {
        await this.pool.query(
          'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE LOWER(username) = LOWER($2)',
          [newPasswordHash, oldUsername.trim()]
        );
      }
    } else {
      const hashToUse = newPasswordHash || existing.passwordHash;
      await this.pool.query('DELETE FROM admin_users WHERE LOWER(username) = LOWER($1)', [oldUsername.trim()]);
      await this.saveAdminUser(newUsername, hashToUse);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton factory
let repositoryInstance: IApiKeyRepository | null = null;

export function getApiKeyRepository(): IApiKeyRepository {
  if (!repositoryInstance) {
    if (config.databaseUrl) {
      logger.info(
        { connection: maskConnectionString(config.databaseUrl) },
        'Configuring Neon PostgreSQL API key repository'
      );
      repositoryInstance = new PostgresApiKeyRepository(config.databaseUrl);
    } else if (config.isProduction) {
      logger.error('CRITICAL: Persistent database is required in production but DATABASE_URL is not configured.');
      repositoryInstance = new MissingDatabaseRepository();
    } else {
      logger.info('Configuring In-Memory API key repository (development/test mode)');
      repositoryInstance = new MemoryApiKeyRepository();
    }
  }
  return repositoryInstance;
}

// Helper for tests to reset repository state
export function setApiKeyRepository(repo: IApiKeyRepository | null) {
  repositoryInstance = repo;
}
