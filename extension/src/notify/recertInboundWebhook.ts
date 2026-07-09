// BL-217: the serverless inbound receiver's deployment-agnostic core. Any
// platform's thin handler (Worker/Vercel/Netlify/Lambda - chosen at
// architecture review, not here) calls handleInboundEmailWebhook with the
// raw request; this module owns verify -> parse -> propose and nothing else.
//
// Reuses BL-150's already-built-and-tested parseRecertEmail/toRecertProposal
// rather than re-deriving them - this ticket's whole job is wiring a live
// receiver in front of that existing pure core, not re-implementing it.

import { parseRecertEmail, toRecertProposal, RecertProposal, ReviewOutcome } from '../docs/recertification';
import { verifySvixSignature, SvixHeaders } from './svixSignature';

export interface InboundWebhookRequest {
  headers: SvixHeaders;
  rawBody: string;
}

export interface InboundWebhookResponse {
  status: number;
  body: string;
}

export interface HandleInboundEmailWebhookDeps {
  secret: string;
  nowIso: string;
  commitProposal: (proposal: RecertProposal) => Promise<void>;
  log: (message: string) => void;
}

export interface EmailFields {
  subject: string;
  body: string;
}

// BEST-EFFORT extraction from Resend's documented {type, data} webhook
// envelope shape. Resend's INBOUND payload's exact field names were not
// independently confirmed against live docs while building this (no network
// access) - if architecture review finds Resend Inbound uses different field
// names, this is the only function that needs to change; verify/parse/commit
// below are independent of this shape.
export function extractEmailFields(payload: unknown): EmailFields | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const subject = (data as { subject?: unknown }).subject;
  const body = (data as { text?: unknown }).text;
  if (typeof subject !== 'string' || typeof body !== 'string') {
    return null;
  }
  return { subject, body };
}

function isReviewOutcome(outcome: string): outcome is ReviewOutcome {
  return outcome === 'update' || outcome === 'delete';
}

export async function handleInboundEmailWebhook(
  request: InboundWebhookRequest,
  deps: HandleInboundEmailWebhookDeps
): Promise<InboundWebhookResponse> {
  if (!verifySvixSignature(request.headers, request.rawBody, deps.secret)) {
    return { status: 401, body: 'signature verification failed' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.rawBody);
  } catch {
    deps.log('recert webhook: request body was not valid JSON');
    return { status: 200, body: 'ignored' };
  }

  const fields = extractEmailFields(payload);
  if (!fields) {
    deps.log('recert webhook: payload carried no recognizable email subject/body');
    return { status: 200, body: 'ignored' };
  }

  const parsed = parseRecertEmail(fields.subject, fields.body);
  if (!parsed) {
    deps.log(`recert webhook: could not parse a recertification email from subject "${fields.subject}"`);
    return { status: 200, body: 'ignored' };
  }

  // confirm is local-only per BL-150 recert-02 and does not use this path
  // (BL-217 scope note) - RecertProposal only models update/delete anyway.
  if (!isReviewOutcome(parsed.outcome)) {
    deps.log(`recert webhook: outcome "${parsed.outcome}" is out of this webhook's scope, ignoring`);
    return { status: 200, body: 'ignored' };
  }

  const proposal = toRecertProposal({ scenarioId: parsed.scenarioId, outcome: parsed.outcome, newText: parsed.newText }, deps.nowIso);

  try {
    await deps.commitProposal(proposal);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.log(`recert webhook: failed to commit proposal for "${parsed.scenarioId}": ${detail}`);
    return { status: 500, body: 'failed to commit proposal' };
  }

  return { status: 200, body: 'proposal committed' };
}
