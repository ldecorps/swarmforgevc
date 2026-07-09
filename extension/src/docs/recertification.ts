// BL-150: pure recertification logic - selection, confirm, and the
// inbound-email-to-durable-proposal pipeline. The extension host (or a CLI)
// is the only impure caller: it reads/writes the .swarmforge/recert-state.json
// store and appends to the recert_proposals/<month>.jsonl durable queue
// (recertificationStore.ts), using the pure functions here to decide what
// changes.

import { GherkinScenario } from './gherkinScenarios';

export const RECERT_STATE_SCHEMA_VERSION = 1;

export interface RecertScenarioState {
  lastReviewedIso: string | null;
}

export interface RecertStoreData {
  schemaVersion: number;
  scenarios: Record<string, RecertScenarioState>;
}

export function emptyRecertStore(): RecertStoreData {
  return { schemaVersion: RECERT_STATE_SCHEMA_VERSION, scenarios: {} };
}

export interface RecertifiableScenario {
  id: string;
  ticketId: string;
  name: string;
  text: string;
}

// Flattens docs-tree ticket nodes into the recertifiable pool: only
// scenarios carrying a BL-111 stable id can be durably tracked - an
// untagged (pre-BL-111) scenario has no stable key to review against, so it
// is simply excluded from the recertification queue rather than tracked
// under a positional index that would shift under editing.
export function recertifiableScenariosFrom(
  tickets: Array<{ id: string; scenarios: GherkinScenario[] }>
): RecertifiableScenario[] {
  const result: RecertifiableScenario[] = [];
  for (const ticket of tickets) {
    for (const scenario of ticket.scenarios) {
      if (scenario.id) {
        result.push({ id: scenario.id, ticketId: ticket.id, name: scenario.name, text: scenario.text });
      }
    }
  }
  return result;
}

function lastReviewedMs(state: RecertStoreData, id: string): number {
  const iso = state.scenarios[id]?.lastReviewedIso;
  return iso ? Date.parse(iso) : -Infinity;
}

// recert-01: oldest-reviewed-first, drip-fed batchSize at a time.
// Never-reviewed scenarios (no entry in state, or an explicit null
// timestamp) sort before any timestamped one - infinitely old, reviewed
// first, so nothing is neglected while others are re-reviewed sooner.
export function selectForRecertification(
  scenarios: RecertifiableScenario[],
  state: RecertStoreData,
  batchSize: number = 1
): RecertifiableScenario[] {
  return [...scenarios].sort((a, b) => lastReviewedMs(state, a.id) - lastReviewedMs(state, b.id)).slice(0, batchSize);
}

// recert-02: confirming moves the scenario to the back of the queue purely
// by advancing its timestamp - selectForRecertification's oldest-first sort
// means there is no separate queue-order field to maintain.
export function confirmScenario(state: RecertStoreData, scenarioId: string, nowIso: string): RecertStoreData {
  return {
    ...state,
    scenarios: { ...state.scenarios, [scenarioId]: { lastReviewedIso: nowIso } },
  };
}

// The PWA is fully static (published to GitHub Pages, no live backend it
// can reach - BL-117's own explorer is read-only for exactly this reason),
// so ALL THREE outcomes leave the phone the same way: a composed email.
// confirm carries no content change, so the extension host applies it
// directly on receipt; update/delete are real changes to the acceptance
// contract, so they go into the review-proposal queue instead (see
// ReviewOutcome/RecertProposal below).
export type RecertOutcome = 'confirm' | 'update' | 'delete';
export type ReviewOutcome = 'update' | 'delete';

export interface RecertEmailParams {
  scenarioId: string;
  outcome: RecertOutcome;
  newText?: string;
}

const RECERT_SUBJECT_PATTERN = /^SwarmForge recert:\s+(confirm|update|delete)\s+(\S+)/;

// recert-02/recert-03/recert-04's write path: subject/body pair for the
// phone's mailto: compose action, mirroring emailContent.ts's plain-text
// line-based convention. parseRecertEmail below is this function's exact
// inverse, so a round trip through both never loses the outcome/newText.
export function buildRecertEmailSubject(params: RecertEmailParams): string {
  return `SwarmForge recert: ${params.outcome} ${params.scenarioId}`;
}

export function buildRecertEmailBody(params: RecertEmailParams): string {
  const lines = [`scenario: ${params.scenarioId}`, `outcome: ${params.outcome}`];
  if (params.outcome === 'update') {
    lines.push('---', params.newText ?? '');
  }
  return lines.join('\n');
}

export interface ParsedRecertEmail {
  scenarioId: string;
  outcome: RecertOutcome;
  newText?: string;
}

// The inbound-webhook seam (BL-150's own non-behavioral note: asserted
// through test doubles, no live email send/receive in tests - standing up
// a real public Resend Inbound endpoint is deployment/ops work outside
// this function's or this ticket's scope). Parses the subject
// buildRecertEmailSubject itself composes, independent of whatever inbound
// transport eventually calls it. Returns null for anything that isn't a
// recognized recert email rather than throwing, since a real inbox
// receives other mail too.
export function parseRecertEmail(subject: string, body: string): ParsedRecertEmail | null {
  const match = subject.trim().match(RECERT_SUBJECT_PATTERN);
  if (!match) {
    return null;
  }
  const [, outcome, scenarioId] = match;
  if (outcome === 'update') {
    const marker = body.indexOf('---');
    const newText = marker === -1 ? '' : body.slice(marker + 3).replace(/^\n/, '');
    return { scenarioId, outcome: 'update', newText };
  }
  return { scenarioId, outcome: outcome as 'confirm' | 'delete' };
}

export interface RecertProposal {
  scenarioId: string;
  outcome: ReviewOutcome;
  newText?: string;
  receivedAtIso: string;
}

// recert-03/recert-05: turns a parsed inbound update/delete email into the
// durable, one-per-change proposal record - the same "durable audit trail
// awaiting specifier review" shape rule_proposal's append-rule-proposal!
// writes (swarmforge/scripts/handoffd.bb), mirrored here since the
// extension host (unlike a live swarm role) has no SWARMFORGE_ROLE identity
// to shell out through swarm_handoff.bb with. Never called for a confirm -
// handleInboundRecertEmail below is the only caller and gates on outcome.
function toRecertProposal(parsed: { scenarioId: string; outcome: ReviewOutcome; newText?: string }, receivedAtIso: string): RecertProposal {
  const proposal: RecertProposal = { scenarioId: parsed.scenarioId, outcome: parsed.outcome, receivedAtIso };
  if (parsed.outcome === 'update') {
    proposal.newText = parsed.newText;
  }
  return proposal;
}

export type InboundRecertResult =
  | { kind: 'applied'; state: RecertStoreData }
  | { kind: 'proposed'; proposal: RecertProposal };

// The webhook handler's pure core (recert-02/recert-03/recert-05): a
// confirm has no content change to review, so it is applied to the store
// immediately; update/delete are queued as proposals instead, leaving the
// store untouched until the specifier accepts (applyAcceptedProposal
// below) - the impure caller (recertificationStore.ts) is responsible for
// persisting whichever branch this returns.
export function handleInboundRecertEmail(state: RecertStoreData, parsed: ParsedRecertEmail, nowIso: string): InboundRecertResult {
  if (parsed.outcome === 'confirm') {
    return { kind: 'applied', state: confirmScenario(state, parsed.scenarioId, nowIso) };
  }
  return { kind: 'proposed', proposal: toRecertProposal({ scenarioId: parsed.scenarioId, outcome: parsed.outcome, newText: parsed.newText }, nowIso) };
}

// recert-05: once a proposal is accepted (the specifier's own review
// judgment - out of this ticket's testable scope beyond the queuing
// contract above, matching rule_proposal's precedent), applying it is a
// pure state transition: delete drops the scenario from tracking entirely
// (removed from the recertification queue, not just re-timestamped);
// update advances its timestamp like a confirm, since the new text has now
// been reviewed and accepted.
export function applyAcceptedProposal(state: RecertStoreData, proposal: RecertProposal, nowIso: string): RecertStoreData {
  if (proposal.outcome === 'delete') {
    const scenarios = Object.fromEntries(Object.entries(state.scenarios).filter(([id]) => id !== proposal.scenarioId));
    return { ...state, scenarios };
  }
  return confirmScenario(state, proposal.scenarioId, nowIso);
}

// recert-04: delete is a double-gate on top of the specifier's own
// proposal review - the in-app confirmation step, before the delete email
// is even sent. 'idle' -> requestDelete -> 'pendingConfirm' ->
// confirmDelete -> 'confirmed' is the only path to 'confirmed'; there is no
// way to reach it in one step, and any tap other than confirm (e.g.
// choosing a different scenario) should reset the caller back to 'idle'
// rather than reuse a stale pending confirmation.
export type DeleteGateState = 'idle' | 'pendingConfirm' | 'confirmed';

export function requestDelete(): DeleteGateState {
  return 'pendingConfirm';
}

export function confirmDelete(gate: DeleteGateState): DeleteGateState {
  return gate === 'pendingConfirm' ? 'confirmed' : gate;
}

export function canSendDeleteEmail(gate: DeleteGateState): boolean {
  return gate === 'confirmed';
}
