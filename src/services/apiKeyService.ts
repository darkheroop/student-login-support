import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiKeyRecord,
  ApiKeyPublic,
  ApiKeyUsageRecord,
  CreateApiKeyInput,
  UpdateApiKeyInput,
  ListKeysOptions,
  DashboardStats,
  KeyValidationResult,
} from '../types/apiKey';
import { getApiKeyRepository, sanitizeKeyRecord } from '../database/apiKeyRepository';
import logger from '../utils/logger';

// In-memory rate limiter per key (sliding window 60s)
const keyRateLimitWindows = new Map<string, number[]>();

export class ApiKeyService {
  private static instance: ApiKeyService;

  public static getInstance(): ApiKeyService {
    if (!ApiKeyService.instance) {
      ApiKeyService.instance = new ApiKeyService();
    }
    return ApiKeyService.instance;
  }

  /**
   * Hashes a raw API key using SHA-256 for secure storage & matching.
   */
  public hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
  }

  /**
   * Generates a new API key with a cryptographically secure random secret.
   * Returns the plaintext key ONCE alongside the sanitized metadata record.
   */
  public async createKey(input: CreateApiKeyInput): Promise<{ key: string; record: ApiKeyPublic }> {
    const projectName = input.projectName?.trim();
    if (!projectName || projectName.length < 2 || projectName.length > 100) {
      throw new Error('Project name must be between 2 and 100 characters.');
    }

    // 32 cryptographically secure random bytes = 64 hex characters (256 bits of entropy)
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const fullKey = `sk_support_${rawSecret}`;
    const keyPrefix = `sk_support_${rawSecret.slice(0, 8)}...`;
    const keyHash = this.hashKey(fullKey);

    const now = new Date().toISOString();
    let expiresAt: string | null = null;
    if (input.expiresAt) {
      const parsedDate = new Date(input.expiresAt);
      if (isNaN(parsedDate.getTime())) {
        throw new Error('Invalid expiration date format.');
      }
      if (parsedDate <= new Date()) {
        throw new Error('Expiration date must be in the future.');
      }
      expiresAt = parsedDate.toISOString();
    }

    let rateLimitPerMinute: number | null = null;
    if (input.rateLimitPerMinute !== undefined && input.rateLimitPerMinute !== null) {
      const limit = Number(input.rateLimitPerMinute);
      if (isNaN(limit) || limit < 1 || limit > 10000) {
        throw new Error('Rate limit per minute must be a positive number up to 10,000.');
      }
      rateLimitPerMinute = limit;
    }

    const record: ApiKeyRecord = {
      id: uuidv4(),
      projectName,
      description: input.description?.trim() || '',
      keyPrefix,
      keyHash,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      lastUsedAt: null,
      rateLimitPerMinute,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
    };

    const repo = getApiKeyRepository();
    await repo.createKey(record);

    logger.info({ keyId: record.id, prefix: keyPrefix, project: projectName }, 'Generated new API key');

    return {
      key: fullKey,
      record: sanitizeKeyRecord(record),
    };
  }

  /**
   * Retrieves list of keys with optional filtering and pagination.
   */
  public async listKeys(options?: ListKeysOptions): Promise<{ keys: ApiKeyPublic[]; total: number }> {
    const repo = getApiKeyRepository();
    const { keys, total } = await repo.listKeys(options);
    return {
      keys: keys.map(sanitizeKeyRecord),
      total,
    };
  }

  /**
   * Retrieves a single key by ID.
   */
  public async getKeyById(id: string): Promise<ApiKeyPublic | null> {
    const repo = getApiKeyRepository();
    const record = await repo.getKeyById(id);
    return record ? sanitizeKeyRecord(record) : null;
  }

  /**
   * Updates key metadata or status (active/disabled). Revoked keys cannot be edited.
   */
  public async updateKey(id: string, input: UpdateApiKeyInput): Promise<ApiKeyPublic | null> {
    const repo = getApiKeyRepository();
    const existing = await repo.getKeyById(id);
    if (!existing) {
      return null;
    }

    if (existing.status === 'revoked') {
      throw new Error('Permanently revoked API keys cannot be updated.');
    }

    const updates: Partial<ApiKeyRecord> = {};
    if (input.projectName !== undefined) {
      const name = input.projectName.trim();
      if (name.length < 2 || name.length > 100) {
        throw new Error('Project name must be between 2 and 100 characters.');
      }
      updates.projectName = name;
    }
    if (input.description !== undefined) {
      updates.description = input.description.trim();
    }
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'disabled') {
        throw new Error('Status can only be toggled between active and disabled.');
      }
      updates.status = input.status;
    }

    const updated = await repo.updateKey(id, updates);
    return updated ? sanitizeKeyRecord(updated) : null;
  }

  /**
   * Permanently revokes an API key. This action is irreversible.
   */
  public async revokeKey(id: string): Promise<ApiKeyPublic | null> {
    const repo = getApiKeyRepository();
    const existing = await repo.getKeyById(id);
    if (!existing) {
      return null;
    }

    if (existing.status === 'revoked') {
      return sanitizeKeyRecord(existing);
    }

    const updated = await repo.updateKey(id, { status: 'revoked' });
    logger.warn({ keyId: id, prefix: existing.keyPrefix }, 'API key permanently revoked');
    return updated ? sanitizeKeyRecord(updated) : null;
  }

  /**
   * Permanently deletes an API key.
   */
  public async deleteKey(id: string): Promise<boolean> {
    const repo = getApiKeyRepository();
    return repo.deleteKey(id);
  }

  /**
   * Rotates an API key: permanently revokes the existing key and generates a replacement.
   * Returns the new plaintext key ONCE.
   */
  public async rotateKey(id: string): Promise<{ key: string; record: ApiKeyPublic }> {
    const repo = getApiKeyRepository();
    const existing = await repo.getKeyById(id);
    if (!existing) {
      throw new Error('API key not found.');
    }

    // Revoke old key
    await repo.updateKey(id, { status: 'revoked' });

    // Generate new replacement key inheriting properties
    return this.createKey({
      projectName: existing.projectName,
      description: existing.description ? `${existing.description} (Rotated replacement)` : 'Rotated replacement',
      expiresAt: existing.expiresAt,
      rateLimitPerMinute: existing.rateLimitPerMinute,
    });
  }

  /**
   * Validates an incoming API key, enforcing active status, expiration, and rate limits.
   */
  public async validateKey(rawKey: string): Promise<KeyValidationResult> {
    if (!rawKey || typeof rawKey !== 'string') {
      return { valid: false, error: 'INVALID_KEY', message: 'API key is required.' };
    }

    const trimmedKey = rawKey.trim();
    if (!trimmedKey.startsWith('sk_support_') || trimmedKey.length < 24) {
      return { valid: false, error: 'INVALID_KEY', message: 'Invalid API key format.' };
    }

    const hash = this.hashKey(trimmedKey);
    const repo = getApiKeyRepository();
    const key = await repo.getKeyByHash(hash);

    if (!key) {
      return { valid: false, error: 'INVALID_KEY', message: 'API key is not recognized or invalid.' };
    }

    if (key.status === 'revoked') {
      return { valid: false, error: 'KEY_REVOKED', message: 'This API key has been permanently revoked.' };
    }

    if (key.status === 'disabled') {
      return { valid: false, error: 'KEY_DISABLED', message: 'This API key is currently disabled.' };
    }

    // Check expiration
    if (key.expiresAt) {
      const expirationDate = new Date(key.expiresAt);
      if (expirationDate <= new Date()) {
        // Mark as expired in background
        repo.updateKey(key.id, { status: 'expired' }).catch(() => {});
        return { valid: false, error: 'KEY_EXPIRED', message: 'This API key has expired.' };
      }
    }

    // Check per-key rate limit if configured
    if (key.rateLimitPerMinute && key.rateLimitPerMinute > 0) {
      const now = Date.now();
      const windowStart = now - 60000;
      let timestamps = keyRateLimitWindows.get(key.id) || [];
      timestamps = timestamps.filter(t => t > windowStart);

      if (timestamps.length >= key.rateLimitPerMinute) {
        return { valid: false, error: 'RATE_LIMITED', message: `API key rate limit of ${key.rateLimitPerMinute} requests/min exceeded.` };
      }

      timestamps.push(now);
      keyRateLimitWindows.set(key.id, timestamps);
    }

    return { valid: true, keyRecord: key };
  }

  /**
   * Asynchronously records an authenticated request event.
   */
  public async recordUsage(
    keyId: string,
    details: {
      endpoint: string;
      statusCode: number;
      responseTimeMs: number;
      ipAddress?: string;
    }
  ): Promise<void> {
    const isSuccess = details.statusCode >= 200 && details.statusCode < 400;
    const usageRecord: ApiKeyUsageRecord = {
      id: uuidv4(),
      keyId,
      endpoint: details.endpoint,
      statusCode: details.statusCode,
      responseTimeMs: details.responseTimeMs,
      ipAddress: details.ipAddress || null,
      timestamp: new Date().toISOString(),
    };

    const repo = getApiKeyRepository();
    await repo.recordUsage(usageRecord, {
      total: 1,
      success: isSuccess ? 1 : 0,
      failure: isSuccess ? 0 : 1,
    });
  }

  /**
   * Retrieves usage logs for a specific key.
   */
  public async getKeyUsageHistory(keyId: string, limit = 50): Promise<ApiKeyUsageRecord[]> {
    const repo = getApiKeyRepository();
    return repo.getUsageHistory(keyId, limit);
  }

  /**
   * Retrieves aggregate dashboard metrics.
   */
  public async getDashboardMetrics(): Promise<DashboardStats> {
    const repo = getApiKeyRepository();
    return repo.getDashboardStats();
  }
}

export const apiKeyService = ApiKeyService.getInstance();
