// BL-450: the standing Recert topic's own reply grammar - sibling of
// pendingApprovalReply.ts's classifyApprovalsTopicReply (BL-434), the SAME
// id-bound shape (a reply must NAME the scenario it acts on, since one
// topic carries scenarios one at a time but across many ticks) rather than
// classifyApprovalReplyAction's bare single-subject grammar. A separate
// module, never merged into pendingApprovalReply.ts - recert is a distinct
// domain (Gherkin scenarios, not backlog tickets) with its own verb set
// (validate/amend/delete) and its own two-step delete confirmation, which
// pendingApprovalReply.ts's ticket-approval grammar has no equivalent of.
export type RecertTopicReplyAction =
  | { kind: 'validate'; scenarioId: string }
  | { kind: 'amend'; scenarioId: string; newText: string }
  | { kind: 'delete'; scenarioId: string }
  | { kind: 'confirm-delete' }
  | { kind: 'none' };

const RECERT_AMEND_PATTERN = /^amend\s+(\S+)\s+([\s\S]+)$/i;
const RECERT_DELETE_PATTERN = /^delete\s+(\S+)\s*$/i;
const RECERT_VALIDATE_PATTERN = /^validate\s+(\S+)\s*$/i;
const RECERT_CONFIRM_PATTERN = /^confirm\s*$/i;

// Pure: amend/delete/validate are mutually exclusive anchored verb
// prefixes (order between them is not load-bearing), each requiring the
// scenario id the reply names; confirm-delete is the bare follow-up reply
// that resolves whichever scenario's delete is currently pending (tracked
// adapter-side - see the delivery-layer's getPendingRecertDelete in
// telegramFrontDeskBotCore.ts, since a Telegram conversation has no
// in-memory "awaiting confirmation" state of its own between messages).
// Anything else - including a reply that merely mentions "delete" or
// "validate" without leading with it - falls through to 'none', surfaced
// as not acted on rather than silently ignored (front-desk-operator-
// fabricates-backlog-state memory: never guess at a scenario id).
export function classifyRecertTopicReply(text: string): RecertTopicReplyAction {
  const trimmed = text.trim();
  const amendMatch = trimmed.match(RECERT_AMEND_PATTERN);
  if (amendMatch) {
    return { kind: 'amend', scenarioId: amendMatch[1], newText: amendMatch[2] };
  }
  const deleteMatch = trimmed.match(RECERT_DELETE_PATTERN);
  if (deleteMatch) {
    return { kind: 'delete', scenarioId: deleteMatch[1] };
  }
  const validateMatch = trimmed.match(RECERT_VALIDATE_PATTERN);
  if (validateMatch) {
    return { kind: 'validate', scenarioId: validateMatch[1] };
  }
  if (RECERT_CONFIRM_PATTERN.test(trimmed)) {
    return { kind: 'confirm-delete' };
  }
  return { kind: 'none' };
}
