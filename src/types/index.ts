export interface DiagnosticEvent {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  url?: string;
  requestPayload?: unknown;
  status: number;
  durationMs: number;
  response: unknown; // opaque
  responseHeaders?: Record<string, string>;
  responseType: 'json' | 'text' | 'empty' | 'error';
  retryAttempt?: number;
}

export interface DiagnosticAnalysis {
  verdict: 'SUCCESS' | 'GATEWAY_DELAY' | 'STUDENT_NOT_FOUND' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'UNKNOWN';
  title: string;
  summary: string;
  recommendedAction: string;
}

export interface CredentialDiagnostic {
  hasHash: boolean;
  algorithm: string;
  formatValid: boolean;
  status: string;
  isReversible: false;
  securityNotice: string;
  recoveryGuidance: string;
}

export interface StudentAccountInfo {
  username: string;
  userId?: string;
  name?: string;
  accountStatus: string;
}

export interface AccountRecoveryInfo {
  recoveryAvailable: boolean;
  recoveryMethod: string;
  portalUrl: string;
  actionGuidance: string;
}

export type DiagnosticStage =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED_LOOKUP'
  | 'COLLEGE_API_FAILURE'
  | 'INVALID_COLLEGE_API_RESPONSE'
  | 'MISSING_USERNAME'
  | 'MISSING_HASH'
  | 'RECOVERY_NOT_CONFIGURED'
  | 'RECOVERY_TIMEOUT'
  | 'RECOVERY_REJECTED'
  | 'INVALID_RECOVERY_RESPONSE'
  | 'NO_MATCHING_RESULT'
  | 'MISSING_PLAINTEXT_FIELD'
  | 'RECOVERY_SUCCESS'
  | 'INTERNAL_EXCEPTION';

export interface DiagnosticsResult {
  requestId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requestCount: number;
  responseCount: number;
  stageDiagnostic?: DiagnosticStage;
  student?: StudentAccountInfo;
  credentialDiagnostic?: CredentialDiagnostic;
  recovery?: AccountRecoveryInfo;
  events: DiagnosticEvent[];
  analysis?: DiagnosticAnalysis;
}

export interface DiagnosticsResponse {
  success: boolean;
  username?: string;
  password?: string;
  diagnostics?: DiagnosticsResult;
  error?: {
    code: string;
    message: string;
    attempts?: number;
  };
}
