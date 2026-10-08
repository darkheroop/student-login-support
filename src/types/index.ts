export interface DiagnosticEvent {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  response: unknown; // opaque
  responseType: 'json' | 'text' | 'empty' | 'error';
  retryAttempt?: number;
}

export interface DiagnosticsResult {
  requestId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requestCount: number;
  responseCount: number;
  events: DiagnosticEvent[];
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
