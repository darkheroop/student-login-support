import { useState, useCallback } from 'react';
import { DiagnosticsResult } from '../types';
import { diagnosticsApi } from '../api/diagnostics';

export interface HistoryItem {
  mobile: string;
  timestamp: string;
  success: boolean;
  result?: DiagnosticsResult | null;
  errorMessage?: string;
}

export const useDiagnostics = () => {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const runDiagnostics = useCallback(async (mobile: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await diagnosticsApi.runDiagnostics(mobile);

      if (response.success && response.diagnostics) {
        setResult(response.diagnostics);
        setHistory(prev => {
          const newItem: HistoryItem = {
            mobile,
            timestamp: new Date().toISOString(),
            success: true,
            result: response.diagnostics,
          };
          return [newItem, ...prev.filter(h => h.mobile !== mobile || Math.abs(new Date(h.timestamp).getTime() - Date.now()) > 1000)].slice(0, 10);
        });
      } else {
        const errMessage = response.error?.message || 'Diagnostics failed';
        setError(errMessage);
        setHistory(prev => {
          const newItem: HistoryItem = {
            mobile,
            timestamp: new Date().toISOString(),
            success: false,
            errorMessage: errMessage,
          };
          return [newItem, ...prev].slice(0, 10);
        });
      }
    } catch (err: any) {
      // Accurately extract backend structured error message
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        err.message ||
        'An unexpected network error occurred';

      setError(msg);
      setHistory(prev => {
        const newItem: HistoryItem = {
          mobile,
          timestamp: new Date().toISOString(),
          success: false,
          errorMessage: msg,
        };
        return [newItem, ...prev].slice(0, 10);
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const selectHistoryItem = useCallback((item: HistoryItem) => {
    if (item.result) {
      setResult(item.result);
      setError(null);
    } else if (item.errorMessage) {
      setError(item.errorMessage);
      setResult(null);
    }
  }, []);

  return { result, loading, error, history, runDiagnostics, selectHistoryItem };
};
