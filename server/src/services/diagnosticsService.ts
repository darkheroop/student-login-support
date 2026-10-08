import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { executeUpstreamRequest } from './upstreamProxy';
import { DiagnosticsResult, DiagnosticsResponse, DiagnosticEvent } from '../types/diagnostics';
import db from '../database/db';
import logger from '../utils/logger';
import { maskMobile, redactSecrets } from '../security/redactSecrets';

export async function runLoginDiagnostics(
  mobile: string,
  operatorId: number
): Promise<DiagnosticsResponse> {
  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const events: DiagnosticEvent[] = [];

  // Insert initial diagnostic run record
  db.prepare(`
    INSERT INTO diagnostic_runs (id, operator_id, mobile_masked, started_at, result)
    VALUES (?, ?, ?, ?, 'IN_PROGRESS')
  `).run(runId, operatorId, maskMobile(mobile), startedAt);

  try {
    // Step 1: Initiates authorized login-support request
    const loginEvent = await executeUpstreamRequest(
      {
        method: 'POST',
        path: '/authorized/login-support',
        body: { mobile },
      },
      config.supportRetryCount,
      config.supportRetryDelayMs
    );
    events.push(loginEvent);

    // Empty response check after retries
    if (loginEvent.responseType === 'empty') {
      const completedAt = new Date().toISOString();
      saveEvents(runId, events);
      updateRun(runId, completedAt, events, 'FAILURE', 'EMPTY_UPSTREAM_RESPONSE');
      return {
        success: false,
        error: {
          code: 'EMPTY_UPSTREAM_RESPONSE',
          message: 'The authorized upstream service returned an empty response after the configured retry limit.',
          attempts: config.supportRetryCount + 1,
        },
      };
    }

    // Step 2: Verification state request (only if Step 1 didn't produce a fatal network/protocol error)
    if (loginEvent.responseType !== 'error') {
      const verificationEvent = await executeUpstreamRequest(
        {
          method: 'POST',
          path: '/authorized/verification-state',
          body: { mobile },
        },
        config.supportRetryCount,
        config.supportRetryDelayMs
      );
      events.push(verificationEvent);

      if (verificationEvent.responseType === 'empty') {
        const completedAt = new Date().toISOString();
        saveEvents(runId, events);
        updateRun(runId, completedAt, events, 'FAILURE', 'EMPTY_UPSTREAM_RESPONSE');
        return {
          success: false,
          error: {
            code: 'EMPTY_UPSTREAM_RESPONSE',
            message: 'The authorized upstream service returned an empty verification state response after the configured retry limit.',
            attempts: config.supportRetryCount + 1,
          },
        };
      }

      // Step 3: Upstream student status check
      const statusEvent = await executeUpstreamRequest(
        {
          method: 'GET',
          path: `/authorized/status/${encodeURIComponent(mobile)}`,
        },
        config.supportRetryCount,
        config.supportRetryDelayMs
      );
      events.push(statusEvent);

      if (statusEvent.responseType === 'empty') {
        const completedAt = new Date().toISOString();
        saveEvents(runId, events);
        updateRun(runId, completedAt, events, 'FAILURE', 'EMPTY_UPSTREAM_RESPONSE');
        return {
          success: false,
          error: {
            code: 'EMPTY_UPSTREAM_RESPONSE',
            message: 'The authorized upstream service returned an empty status response after the configured retry limit.',
            attempts: config.supportRetryCount + 1,
          },
        };
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    // Persist all events
    saveEvents(runId, events);

    // Determine final run status
    const hasErrors = events.some(e => e.status >= 500 || e.responseType === 'error');
    const finalResult = hasErrors ? 'COMPLETED_WITH_ERRORS' : 'SUCCESS';
    updateRun(runId, completedAt, events, finalResult, null);

    // Redact any secrets before sending diagnostics to the client
    const redactedEvents: DiagnosticEvent[] = events.map(evt => ({
      ...evt,
      response: redactSecrets(evt.response),
    }));

    const result: DiagnosticsResult = {
      requestId: runId,
      startedAt,
      completedAt,
      durationMs,
      requestCount: events.length,
      responseCount: events.filter(e => e.status > 0).length,
      events: redactedEvents,
    };

    return { success: true, diagnostics: result };

  } catch (err) {
    const completedAt = new Date().toISOString();
    saveEvents(runId, events);
    updateRun(runId, completedAt, events, 'ERROR', 'SERVER_EXCEPTION');
    logger.error({ err, runId }, 'Diagnostics service error');
    throw err;
  }
}

function saveEvents(runId: string, events: DiagnosticEvent[]): void {
  const stmt = db.prepare(`
    INSERT INTO diagnostic_events (id, run_id, request_id, timestamp, method, path, status, duration_ms, response_body, response_type, retry_attempt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const evt of events) {
    stmt.run(
      uuidv4(),
      runId,
      evt.requestId,
      evt.timestamp,
      evt.method,
      evt.path,
      evt.status,
      evt.durationMs,
      evt.response !== undefined ? JSON.stringify(evt.response) : null,
      evt.responseType,
      evt.retryAttempt ?? 0
    );
  }
}

function updateRun(
  runId: string,
  completedAt: string,
  events: DiagnosticEvent[],
  result: string,
  errorCode: string | null
): void {
  const startedAt = events[0]?.timestamp || completedAt;
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  db.prepare(`
    UPDATE diagnostic_runs
    SET completed_at = ?, duration_ms = ?, request_count = ?, response_count = ?, result = ?, error_code = ?
    WHERE id = ?
  `).run(
    completedAt,
    durationMs,
    events.length,
    events.filter(e => e.status > 0).length,
    result,
    errorCode,
    runId
  );
}
