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

export interface DiagnosticsResult {
  requestId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requestCount: number;
  responseCount: number;
  events: DiagnosticEvent[];
  analysis?: DiagnosticAnalysis;
}

export interface DiagnosticsResponse {
  success: boolean;
  diagnostics?: DiagnosticsResult;
  error?: {
    code: string;
    message: string;
    attempts?: number;
  };
}
