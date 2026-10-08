import { apiClient } from './client';
import { DiagnosticsResponse } from '../types';

export const diagnosticsApi = {
  runDiagnostics: async (mobile: string): Promise<DiagnosticsResponse> => {
    const { data } = await apiClient.post<DiagnosticsResponse>('/api/support/login-diagnostics', { mobile });
    return data;
  },
};
