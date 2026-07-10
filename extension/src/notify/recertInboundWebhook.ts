// BL-217: the serverless inbound receiver's deployment-agnostic core. Any
// platform's thin handler (Worker/Vercel/Netlify/Lambda - chosen at
// architecture review, not here) calls handleInboundEmailWebhook with the
// raw request; this module owns verify -> parse -> propose and nothing else.
//
// Reuses BL-150's already-built-and-tested parseRecertEmail/toRecertProposal
// rather than re-deriving them - this ticket's whole job is wiring a live
// receiver in front of that existing pure core, not re-implementing it.

import { parseRecertEmail, toRecertProposal, RecertProposal, ReviewOutcome } from '../docs/recertification';
import { verifySvixSignature, isTimestampFresh, SvixHeaders } from './svixSignature';

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
  // BL-248: the authorization layer signature+freshness alone doesn't
  // provide - only a sender on this list may commit a proposal. Sourced
  // from the serverless env, same deployment-agnostic posture as `secret`
  // (the core cannot read this host's .swarmforge/, BL-217). FAIL CLOSED:
  // an empty/missing allowlist rejects every sender (see isSenderAllowed).
  senderAllowlist: string[];
  commitProposal: (proposal: RecertProposal) => Promise<void>;
  log: (message: string) => void;
}

export interface EmailFields {
  subject: string;
  body: string;
  from?: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// BEST-EFFORT extraction from Resend's documented {type, data} webhook
// envelope shape. Resend's INBOUND payload's exact field names were not
// independently confirmed against live docs while building this (no network
// access) - if architecture review finds Resend Inbound uses different field
// names, this is the only function that needs to change; verify/parse/commit
// below are independent of this shape.
export function extractEmailFields(payload: unknown): EmailFields | null {
  const envelope = asObject(payload);
  const data = envelope ? asObject(envelope.data) : null;
  if (!data) {
    return null;
  }
  const { subject, text: body, from } = data;
  if (typeof subject !== 'string' || typeof body !== 'string') {
    return null;
  }
  return { subject, body, ...(typeof from === 'string' ? { from } : {}) };
}

// BL-248: case-insensitive exact match on the email address. An empty or
// missing allowlist rejects every sender - a deliberate secure default
// (FLAGS FOR HUMAN REVIEW in the ticket) that changes the prior
// accept-any-signed-request behavior; an allowlist that fails OPEN when
// unconfigured is not a control.
export function isSenderAllowed(sender: string | undefined, allowlist: string[]): boolean {
  if (!sender || !allowlist || allowlist.length === 0) {
    return false;
  }
  const normalized = sender.trim().toLowerCase();
  return allowlist.some((entry) => entry.trim().toLowerCase() === normalized);
}

function isReviewOutcome(outcome: string): outcome is ReviewOutcome {
  return outcome === 'update' || outcome === 'delete';
}

type ResolvedProposal =
  | { proposal: RecertProposal; earlyResponse?: undefined }
  | { proposal?: undefined; earlyResponse: InboundWebhookResponse };

// Signature + freshness only, split from the parse/validate chain below so
// the two independent concerns don't compound into one function's CRAP.
function authenticateRequest(
  request: InboundWebhookRequest,
  deps: Pick<HandleInboundEmailWebhookDeps, 'secret' | 'nowIso'>
): InboundWebhookResponse | null {
  if (!verifySvixSignature(request.headers, request.rawBody, deps.secret)) {
    return { status: 401, body: 'signature verification failed' };
  }

  // QA bounce (BL-217): a valid HMAC over an old svix-timestamp is not the
  // same as a fresh delivery - without this, a captured, validly-signed
  // request could be replayed indefinitely to create unwanted proposals.
  if (!isTimestampFresh(request.headers.svixTimestamp, Date.parse(deps.nowIso))) {
    return { status: 401, body: 'stale or replayed request' };
  }

  return null;
}

// The parse -> validate guard chain, run only once the request has already
// authenticated. Every early exit here is a "not a proposal we can build"
// outcome (bad JSON, unmatched shape, disallowed sender, out-of-scope
// outcome) - none of them touch deps.commitProposal.
function parseProposal(
  rawBody: string,
  deps: Pick<HandleInboundEmailWebhookDeps, 'nowIso' | 'log' | 'senderAllowlist'>
): ResolvedProposal {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    deps.log('recert webhook: request body was not valid JSON');
    return { earlyResponse: { status: 200, body: 'ignored' } };
  }

  const fields = extractEmailFields(payload);
  if (!fields) {
    deps.log('recert webhook: payload carried no recognizable email subject/body');
    return { earlyResponse: { status: 200, body: 'ignored' } };
  }

  // BL-248: authorization, run BEFORE the email is parsed for a recert
  // outcome - a disallowed sender's content is never processed beyond
  // this point. 403 (not the 200 "ignored" the shape/content guards
  // below use) so a rejected sender is distinguishable in logs/monitoring
  // from ordinary non-recert mail landing on the same address.
  if (!isSenderAllowed(fields.from, deps.senderAllowlist)) {
    deps.log(`recert webhook: rejected sender "${fields.from ?? '(none)'}" - not on the allowlist`);
    return { earlyResponse: { status: 403, body: 'sender not allowed' } };
  }

  const parsed = parseRecertEmail(fields.subject, fields.body);
  if (!parsed) {
    deps.log(`recert webhook: could not parse a recertification email from subject "${fields.subject}"`);
    return { earlyResponse: { status: 200, body: 'ignored' } };
  }

  // confirm is local-only per BL-150 recert-02 and does not use this path
  // (BL-217 scope note) - RecertProposal only models update/delete anyway.
  if (!isReviewOutcome(parsed.outcome)) {
    deps.log(`recert webhook: outcome "${parsed.outcome}" is out of this webhook's scope, ignoring`);
    return { earlyResponse: { status: 200, body: 'ignored' } };
  }

  const proposal = toRecertProposal({ scenarioId: parsed.scenarioId, outcome: parsed.outcome, newText: parsed.newText }, deps.nowIso);
  return { proposal };
}

function resolveProposal(
  request: InboundWebhookRequest,
  deps: Pick<HandleInboundEmailWebhookDeps, 'secret' | 'nowIso' | 'log' | 'senderAllowlist'>
): ResolvedProposal {
  const authFailure = authenticateRequest(request, deps);
  if (authFailure) {
    return { earlyResponse: authFailure };
  }
  return parseProposal(request.rawBody, deps);
}

export async function handleInboundEmailWebhook(
  request: InboundWebhookRequest,
  deps: HandleInboundEmailWebhookDeps
): Promise<InboundWebhookResponse> {
  const resolved = resolveProposal(request, deps);
  if (resolved.earlyResponse) {
    return resolved.earlyResponse;
  }

  try {
    await deps.commitProposal(resolved.proposal);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.log(`recert webhook: failed to commit proposal for "${resolved.proposal.scenarioId}": ${detail}`);
    return { status: 500, body: 'failed to commit proposal' };
  }

  return { status: 200, body: 'proposal committed' };
}
