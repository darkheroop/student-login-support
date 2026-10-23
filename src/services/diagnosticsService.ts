import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { executeUpstreamRequest } from './upstreamProxy';
import { DiagnosticsResult, DiagnosticsResponse, DiagnosticEvent, DiagnosticAnalysis } from '../types';
import logger from '../utils/logger';

/**
 * Normalizes input phone number to standard 10-digit Indian mobile number format.
 */
function cleanMobileNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Analyzes the upstream response and produces an actionable operational diagnosis.
 */
function analyzeResponse(event: DiagnosticEvent): DiagnosticAnalysis {
  const status = event.status;
  const body = event.response as any;
  const simResponse = body?.collection?.response;

  if (simResponse) {
    const userDetails = simResponse.userDetails || simResponse.loginDetails?.userDetails;
    if (userDetails && simResponse.statusMsg === 'SUCCESS') {
      const fullName = `${userDetails.firstName || ''} ${userDetails.middleName || ''} ${userDetails.lastName || ''}`.trim();
      return {
        verdict: 'SUCCESS',
        title: `Student Verified: ${fullName || userDetails.username}`,
        summary: `Successfully verified student record (Username: ${userDetails.username}, User ID: ${userDetails.userId}, Type: ${userDetails.userType}).`,
        recommendedAction: 'Student account is active and verified in EduNova. Authentication hash generated successfully.',
      };
    }

    if (simResponse.statusMsg === 'FAILED' || simResponse.statusCode >= 400) {
      const msg = simResponse.message || 'Verification failed';
      return {
        verdict: 'STUDENT_NOT_FOUND',
        title: 'Verification Failed',
        summary: `EduNova response: ${msg}`,
        recommendedAction: 'Check if mobile number is mapped to an active student account in the ERP.',
      };
    }
  }

  if (status === 0 || event.responseType === 'error') {
    return {
      verdict: 'SERVER_ERROR',
      title: 'Connection / Server Timeout',
      summary: 'Unable to reach the EduNova server or request timed out.',
      recommendedAction: 'Check if the college ERP server is under heavy traffic load.',
    };
  }

  return {
    verdict: 'UNKNOWN',
    title: `Response Code HTTP ${status}`,
    summary: 'Received response from EduNova.',
    recommendedAction: 'Inspect the raw JSON payload in the timeline below.',
  };
}

export async function runLoginDiagnostics(
  mobileInput: string
): Promise<DiagnosticsResponse> {
  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const events: DiagnosticEvent[] = [];

  const cleanMobile = cleanMobileNumber(mobileInput);

  try {
    // Exact Tamper Dev EduNova verifyMobile payload
    const dataPayload = {
      appParams: {
        actionType: 'verifyMobile',
        actionData: {
          userName: '',
          mobile: cleanMobile,
          mobile_app_hash: '697940068012395',
          imei: '',
          client_id: 'b5b41fac0361d157d9673ecb926af5ae',
          school_id: 'c4ca4238a0b923820dcc509a6f75849b',
          otp: '',
        },
      },
    };

    const requestParams = {
      r: 'api/v1/App/AppLogin',
      data: JSON.stringify(dataPayload),
    };

    // Execute the exact intercepted Tamper Dev request
    const event = await executeUpstreamRequest(
      {
        method: 'GET',
        baseUrl: 'https://edunova.abes.ac.in',
        path: '/sims-services/digitalsims/',
        params: requestParams,
      },
      config.supportRetryCount,
      config.supportRetryDelayMs
    );
    events.push(event);

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    const analysis = analyzeResponse(event);

    const result: DiagnosticsResult = {
      requestId: runId,
      startedAt,
      completedAt,
      durationMs,
      requestCount: events.length,
      responseCount: events.filter(e => e.status > 0).length,
      events, // Returns 100% exact raw response body
      analysis,
    };

    return { success: true, diagnostics: result };

  } catch (err) {
    logger.error({ err, runId }, 'Diagnostics service error');
    throw err;
  }
}
