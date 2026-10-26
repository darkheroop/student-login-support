export type ApiKeyStatus = 'active' | 'disabled' | 'revoked' | 'expired';

export interface ApiKeyRecord {
  id: string;
  name?: string;
  projectName: string;
  description: string;
  keyPrefix: string;
  keyHash: string; // Internal only - never exposed to clients
  status: ApiKeyStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
  lastUsedAt: string | null;
  rateLimitPerMinute: number | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
}

export type ApiKeyPublic = Omit<ApiKeyRecord, 'keyHash'>;

export interface ApiKeyUsageRecord {
  id: string;
  keyId: string;
  endpoint: string;
  statusCode: number;
  responseTimeMs: number;
  ipAddress: string | null;
  timestamp: string;
}

export interface DashboardStats {
  totalKeys: number;
  activeKeys: number;
  revokedKeys: number;
  disabledKeys: number;
  expiredKeys: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  recentKeys: ApiKeyPublic[];
}

export interface CreateApiKeyInput {
  projectName: string;
  description?: string;
  expiresAt?: string | null;
  rateLimitPerMinute?: number | null;
}

export interface UpdateApiKeyInput {
  projectName?: string;
  description?: string;
  status?: 'active' | 'disabled';
}

export interface ListKeysOptions {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface KeyValidationResult {
  valid: boolean;
  keyRecord?: ApiKeyRecord;
  error?: 'INVALID_KEY' | 'KEY_REVOKED' | 'KEY_DISABLED' | 'KEY_EXPIRED' | 'RATE_LIMITED';
  message?: string;
}
