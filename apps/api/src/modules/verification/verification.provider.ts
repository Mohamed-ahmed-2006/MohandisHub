// ---------------------------------------------------------------------------
// Verification provider — abstract interface + concrete adapters
// ---------------------------------------------------------------------------
//
// This follows the Strategy/Adapter pattern so you can swap between
// Didit, Idenfy, or manual verification without changing the service layer.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

import type { VerificationRequestType } from '@mohandishub/shared';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

import type {
  DiditCreateSessionResponse,
  DiditWebhookPayload,
  VerificationSession,
  VerificationWebhookResult,
  WebhookHeaders,
} from './verification.types.js';

/**
 * Abstract interface that every verification provider must implement.
 */
export interface IVerificationProvider {
  readonly name: string;

  /**
   * Create a new verification session with the provider.
   * Returns a sessionId (and optionally a redirect URL for the visual flow).
   */
  createSession(params: {
    userId: string;
    email: string;
    displayName: string;
    type: VerificationRequestType;
  }): Promise<VerificationSession>;

  /**
   * Parse and validate an incoming webhook payload from the provider.
   */
  handleWebhook(payload: unknown, headers?: WebhookHeaders): Promise<VerificationWebhookResult>;
}

// ── Manual verification (admin reviews documents) ────────────────────────

export class ManualVerificationProvider implements IVerificationProvider {
  readonly name = 'manual';

  createSession(params: {
    userId: string;
    email: string;
    displayName: string;
    type: VerificationRequestType;
  }): Promise<VerificationSession> {
    // For manual verification, we just create a session ID.
    // Documents will be uploaded separately; an admin reviews them.
    const sessionId = `manual_${params.userId}_${Date.now()}`;

    return Promise.resolve({ sessionId });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleWebhook(_payload: unknown, _headers?: WebhookHeaders): Promise<VerificationWebhookResult> {
    // Manual verification doesn't use webhooks — approval is done
    // through internal admin endpoints.
    return Promise.reject(new Error('Manual verification does not support webhooks.'));
  }
}

// ── Didit KYC provider ──────────────────────────────────────────────────

export class DiditVerificationProvider implements IVerificationProvider {
  readonly name = 'didit';

  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly workflowId: string;
  private readonly baseUrl: string;

  constructor() {
    if (!env.DIDIT_API_KEY) {
      throw new Error('DIDIT_API_KEY is required when using the Didit provider.');
    }
    if (!env.DIDIT_WEBHOOK_SECRET) {
      throw new Error('DIDIT_WEBHOOK_SECRET is required when using the Didit provider.');
    }
    if (!env.DIDIT_WORKFLOW_ID) {
      throw new Error('DIDIT_WORKFLOW_ID is required when using the Didit provider.');
    }

    this.apiKey = env.DIDIT_API_KEY;
    this.webhookSecret = env.DIDIT_WEBHOOK_SECRET;
    this.workflowId = env.DIDIT_WORKFLOW_ID;
    this.baseUrl = env.DIDIT_BASE_URL;
  }

  async createSession(params: {
    userId: string;
    email: string;
    displayName: string;
    type: VerificationRequestType;
  }): Promise<VerificationSession> {
    const nameParts = params.displayName.split(' ');
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const body: Record<string, unknown> = {
      workflow_id: this.workflowId,
      vendor_data: params.userId,
      callback_method: 'both',
      language: 'ar',
      contact_details: {
        email: params.email,
      },
      metadata: {
        request_type: params.type,
        platform: 'mohandishub',
      },
    };

    // Only send expected_details if we have meaningful name data
    if (firstName) {
      body.expected_details = {
        first_name: firstName,
        ...(lastName ? { last_name: lastName } : {}),
      };
    }

    const response = await fetch(`${this.baseUrl}/session/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Didit API error creating session', {
        status: response.status,
        body: errorText,
      });
      throw new Error(`Didit API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as DiditCreateSessionResponse;

    return {
      sessionId: data.session_id,
      redirectUrl: data.url,
      sessionToken: data.session_token,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook(
    payload: unknown,
    headers?: WebhookHeaders,
  ): Promise<VerificationWebhookResult> {
    // ── Verify webhook signature ─────────────────────────────────────
    if (!headers?.timestamp) {
      throw new Error('Missing X-Timestamp header in Didit webhook.');
    }

    const isValid = this.verifySignature(payload, headers);
    if (!isValid) {
      throw new Error('Invalid Didit webhook signature.');
    }

    // ── Parse payload ────────────────────────────────────────────────
    const body = payload as DiditWebhookPayload;

    if (!body.session_id || !body.status) {
      throw new Error('Invalid Didit webhook payload: missing session_id or status.');
    }

    // Map Didit status → approved boolean
    // Didit statuses: 'Not Started', 'In Progress', 'Approved', 'Declined', 'In Review', 'Abandoned'
    const approved = body.status === 'Approved';
    const isTerminal = body.status === 'Approved' || body.status === 'Declined';

    if (!isTerminal) {
      // Non-terminal statuses (In Progress, In Review, etc.) — we acknowledge
      // but don't change our verification status. Log for debugging.
      logger.info('Didit webhook: non-terminal status update', {
        sessionId: body.session_id,
        status: body.status,
      });
    }

    return {
      sessionId: body.session_id,
      approved,
      rawPayload: body,
    };
  }

  // ── Signature verification (V2 recommended by Didit) ───────────────

  private verifySignature(payload: unknown, headers: WebhookHeaders): boolean {
    const { timestamp } = headers;

    if (!timestamp) return false;

    // Check timestamp freshness (within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const incomingTime = parseInt(timestamp, 10);
    if (Math.abs(currentTime - incomingTime) > 300) {
      logger.warn('Didit webhook: stale timestamp');
      return false;
    }

    // Try X-Signature-V2 first (recommended — works with middleware re-encoding)
    if (headers.signatureV2) {
      return this.verifySignatureV2(payload, headers.signatureV2);
    }

    // Fallback to X-Signature-Simple
    if (headers.signatureSimple) {
      return this.verifySignatureSimple(payload as DiditWebhookPayload, headers.signatureSimple);
    }

    logger.warn('Didit webhook: no signature header found');
    return false;
  }

  /**
   * X-Signature-V2 — HMAC-SHA256 of sorted, unescaped-Unicode JSON.
   * Works even if middleware re-encodes special characters.
   */
  private verifySignatureV2(jsonBody: unknown, signatureHeader: string): boolean {
    const processedData = this.shortenFloats(jsonBody);
    const sorted = this.sortKeys(processedData);
    const canonicalJson = JSON.stringify(sorted);

    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const expectedSignature = hmac.update(canonicalJson, 'utf8').digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(signatureHeader, 'utf8'),
      );
    } catch {
      return false; // length mismatch
    }
  }

  /**
   * X-Signature-Simple — HMAC-SHA256 of "timestamp:session_id:status:webhook_type".
   * Completely independent of JSON encoding.
   */
  private verifySignatureSimple(body: DiditWebhookPayload, signatureHeader: string): boolean {
    const canonicalString = [
      body.timestamp ?? '',
      body.session_id ?? '',
      body.status ?? '',
      body.webhook_type ?? '',
    ].join(':');

    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const expectedSignature = hmac.update(canonicalString).digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(signatureHeader, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /** Recursively sort object keys for canonical JSON encoding. */
  private sortKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortKeys(item));
    }
    if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = this.sortKeys((obj as Record<string, unknown>)[key]);
          return result;
        }, {});
    }
    return obj;
  }

  /**
   * Convert floats that are whole numbers to integers to match
   * Didit's server-side encoding behavior.
   */
  private shortenFloats(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.shortenFloats(item));
    }
    if (data !== null && typeof data === 'object') {
      return Object.fromEntries(
        Object.entries(data as Record<string, unknown>).map(([key, value]) => [
          key,
          this.shortenFloats(value),
        ]),
      );
    }
    if (typeof data === 'number' && !Number.isInteger(data) && data % 1 === 0) {
      return Math.trunc(data);
    }
    return data;
  }
}

// ── Idenfy provider (placeholder — implement when you get API keys) ─────

export class IdenfyVerificationProvider implements IVerificationProvider {
  readonly name = 'idenfy';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createSession(_params: {
    userId: string;
    email: string;
    displayName: string;
    type: VerificationRequestType;
  }): Promise<VerificationSession> {
    throw new Error(
      'Idenfy provider is not yet configured. Set IDENFY_API_KEY and IDENFY_API_SECRET in .env',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleWebhook(
    _unusedPayload: unknown,
    _headers?: WebhookHeaders,
  ): Promise<VerificationWebhookResult> {
    return Promise.reject(new Error('Idenfy webhook handling not yet implemented.'));
  }
}

// ── Factory ─────────────────────────────────────────────────────────────

export const createVerificationProvider = (providerName: string): IVerificationProvider => {
  switch (providerName) {
    case 'manual':
      return new ManualVerificationProvider();
    case 'didit':
      return new DiditVerificationProvider();
    case 'idenfy':
      return new IdenfyVerificationProvider();
    default:
      throw new Error(`Unknown verification provider: ${providerName}`);
  }
};
