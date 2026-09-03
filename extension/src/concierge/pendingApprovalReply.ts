// BL-649: existing reply path for approve/reject — unchanged; no second writer.
// replies in a ticket's own topic to approve it, this module RECORDS that
// approval against the ticket by flipping its structured `human_approval`
// field from pending to approved. Mirrors backfill-human-approval.ts's own
// read/find/replace/write-back pattern (the established precedent for
// writing this exact field) and backlogReader.ts's own `id:` field match
// (never a filename-prefix guess) - a "flip pending->approved on a real
// reply" writer, never a blind seed (that stays backfill's job).
import * as fs from 'fs';
import type { ApprovalDecisionVerdict } from './approvalAskClosing';
import { parseBacklogYaml } from '../panel/backlogReader';
import { findTicketFilePath } from './pendingApprovalFor';

// A simple, deliberate keyword match - not NLP. Mirrors
// backfill-human-approval.ts's own deriveApprovalFromCommentBlock, which
// already classifies free text the same naive, auditable way: the human
// replies with a message containing "approve" to approve a ticket.
const APPROVAL_KEYWORD_PATTERN = /approve/i;

export function isApprovalReplyText(text: string): boolean {
  return APPROVAL_KEYWORD_PATTERN.test(text);
}

// BL-409: the remaining two verbs from the original "approve/amend/reject an
// action" ask. Anchored verb PREFIXES (never a bare substring like
// isApprovalReplyText's own "approve" match), so a reason/note that happens
// to mention "approve" internally ("reject needs a second approve from ops")
// still classifies by its own leading verb, not the word buried inside it.
const REJECT_PATTERN = /^reject\s+([\s\S]+)$/i;
const AMEND_PATTERN = /^amend\s+([\s\S]+)$/i;

export type ApprovalReplyAction =
  | { kind: 'approve' }
  | { kind: 'reject'; reason: string }
  | { kind: 'amend'; note: string }
  | { kind: 'none' };

// Pure: the whole three-verb dispatch table. Checked in this order -
// reject/amend (anchored, specific) before approve (unanchored, the older
// and more permissive match) - so a reject/amend reply is never misread as
// an approval just because its own payload text contains the word
// "approve". A caller that only cared about the old boolean keeps using
// isApprovalReplyText directly; this is the new three-way sibling the
// ticket asks for, not a replacement of the old return shape.
export function classifyApprovalReplyAction(text: string): ApprovalReplyAction {
  const trimmed = text.trim();
  const rejectMatch = trimmed.match(REJECT_PATTERN);
  if (rejectMatch) {
    // No .trim() here: `trimmed` already has no leading/trailing whitespace
    // (the outer text.trim() above), and the greedy `\s+` in REJECT_PATTERN
    // consumes any whitespace between the verb and the capture group, so
    // rejectMatch[1] can never itself have leading/trailing whitespace to
    // strip - confirmed by mutation testing (the .trim() mutant survived).
    return { kind: 'reject', reason: rejectMatch[1] };
  }
  const amendMatch = trimmed.match(AMEND_PATTERN);
  if (amendMatch) {
    // Same reasoning as the reject branch above.
    return { kind: 'amend', note: amendMatch[1] };
  }
  if (isApprovalReplyText(trimmed)) {
    return { kind: 'approve' };
  }
  return { kind: 'none' };
}

// BL-434: the standing Approvals topic's own reply grammar - because ONE
// topic now carries MANY tickets, a reply must NAME the ticket it acts on
// ("approve BL-433" / "reject BL-433 <reason>"), unlike
// classifyApprovalReplyAction above, which assumes single-ticket-per-topic
// and never looks for an id. A SEPARATE, narrower parser - never a merge
// into classifyApprovalReplyAction's own three-way dispatch, since the two
// topics have genuinely different reply grammars (bare "approve" vs
// "approve <id>") and conflating them would make an ordinary per-ticket-
// topic "approve" reply require an id it was never meant to carry.
const APPROVALS_TOPIC_REJECT_PATTERN = /^reject\s+(\S+)(?:\s+([\s\S]+))?$/i;
const APPROVALS_TOPIC_APPROVE_PATTERN = /^approve\s+(\S+)\s*$/i;
// BL-721: a typed alternative to tapping the Approvals ask's Q jump button -
// same queue-jump effect (approve + force-promote + dispatch now), same
// verb+id grammar as approve/reject above. A slash prefix (unlike bare
// "approve"/"reject") so it reads as a command, and so it can never collide
// with a ticket's own reason/note text starting with the word "qjump".
const APPROVALS_TOPIC_QJUMP_PATTERN = /^\/qjump\s+(\S+)\s*$/i;
// BL-893: typed twin of the Approvals Ambulance button — same engage as Control.
const APPROVALS_TOPIC_AMBULANCE_PATTERN = /^\/ambulance\s+(\S+)\s*$/i;

export type ApprovalsTopicReplyAction =
  | { kind: 'approve'; backlogId: string }
  | { kind: 'reject'; backlogId: string; reason: string }
  | { kind: 'qjump'; backlogId: string }
  | { kind: 'ambulance'; backlogId: string }
  | { kind: 'none' };

// Pure: reject checked before approve (mirrors classifyApprovalReplyAction's
// own specific-before-permissive ordering). Unlike isApprovalReplyText's
// bare substring match, a reply here must lead with the verb and name an id,
// or it falls through to 'none' - the caller surfaces that as "not acted
// on", never silently ignored (front-desk-operator-fabricates-backlog-state
// memory: a fabricated/guessed id must never be applied).
export function classifyApprovalsTopicReply(text: string): ApprovalsTopicReplyAction {
  const trimmed = text.trim();
  const rejectMatch = trimmed.match(APPROVALS_TOPIC_REJECT_PATTERN);
  if (rejectMatch) {
    return { kind: 'reject', backlogId: rejectMatch[1], reason: (rejectMatch[2] ?? '').trim() };
  }
  const approveMatch = trimmed.match(APPROVALS_TOPIC_APPROVE_PATTERN);
  if (approveMatch) {
    return { kind: 'approve', backlogId: approveMatch[1] };
  }
  const qjumpMatch = trimmed.match(APPROVALS_TOPIC_QJUMP_PATTERN);
  if (qjumpMatch) {
    return { kind: 'qjump', backlogId: qjumpMatch[1] };
  }
  const ambulanceMatch = trimmed.match(APPROVALS_TOPIC_AMBULANCE_PATTERN);
  if (ambulanceMatch) {
    return { kind: 'ambulance', backlogId: ambulanceMatch[1] };
  }
  return { kind: 'none' };
}

const HUMAN_APPROVAL_PENDING_PATTERN = /^human_approval:\s*(pending|pending-review)\s*$/m;

// Pure text transform - only ever flips a LITERAL `human_approval: pending` or
// `human_approval: pending-review` line, never a ticket already approved or one
// with no field at all (never invents the field - that stays
// backfill-human-approval.ts's job). Always normalizes to `approved`.
// BL-408: accept both pending and pending-review.
export function approveHumanApprovalText(rawText: string): { text: string; changed: boolean } {
  if (!HUMAN_APPROVAL_PENDING_PATTERN.test(rawText)) {
    return { text: rawText, changed: false };
  }
  return { text: rawText.replace(HUMAN_APPROVAL_PENDING_PATTERN, 'human_approval: approved'), changed: true };
}

const HUMAN_RULING_BLOCK_PATTERN = /^human_ruling:\s*(?:[|>][+-]?\s*\n(?:[ \t]+.*\n?)*)?/m;

function formatHumanRulingBlock(label: string): string {
  const sanitized = sanitizeForYamlComment(label);
  if (!sanitized) {
    return '';
  }
  return `human_ruling: |\n  ${sanitized}\n`;
}

// BL-589: approve AND record which discrete option was chosen.
export function rulingHumanApprovalText(rawText: string, rulingLabel: string): { text: string; changed: boolean } {
  if (!HUMAN_APPROVAL_PENDING_PATTERN.test(rawText)) {
    return { text: rawText, changed: false };
  }
  let text = rawText.replace(HUMAN_APPROVAL_PENDING_PATTERN, 'human_approval: approved');
  const rulingBlock = formatHumanRulingBlock(rulingLabel);
  if (!rulingBlock) {
    return { text, changed: true };
  }
  if (HUMAN_RULING_BLOCK_PATTERN.test(text)) {
    text = text.replace(HUMAN_RULING_BLOCK_PATTERN, rulingBlock.trimEnd());
  } else {
    text = text.replace(/^human_approval:\s*approved\s*$/m, `human_approval: approved\n${rulingBlock.trimEnd()}`);
  }
  return { text, changed: true };
}

// BL-409 bounce (QA, 2026-07-15): `reason` is raw human Telegram text - an
// ordinary reply typed across more than one line (a human pressing Enter
// mid-thought) embeds real `\r`/`\n` bytes. Splicing that verbatim into a
// trailing `# <reason>` YAML comment only comments to the end of the FIRST
// line: every line after the first becomes LIVE YAML content, which can
// inject a bogus second `human_approval:` line (silently overriding the
// rejection back to whatever it says) or an arbitrary new key. Collapse to a
// single line BEFORE it reaches the file - the same "external text into a
// structured file must have its newlines stripped/escaped first" rule as the
// GitHub Actions `${{ }}` interpolation guardrail, applied to this sink.
function sanitizeForYamlComment(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

// BL-509: same targeted-line-replace shape as approveHumanApprovalText, for
// the amend verb - 'amending' is a distinct, non-terminal verdict (unlike
// approved/rejected): the specifier flips it back to pending on re-present
// (slice 3), so a ticket can legitimately re-enter the pending->amending
// transition more than once over its lifetime. The steer text itself is not
// embedded on this line (unlike reject's reason) - it already rides the
// ticket's topic record via the unconditional postOperatorContext post.
export function amendHumanApprovalText(rawText: string): { text: string; changed: boolean } {
  if (!HUMAN_APPROVAL_PENDING_PATTERN.test(rawText)) {
    return { text: rawText, changed: false };
  }
  return { text: rawText.replace(HUMAN_APPROVAL_PENDING_PATTERN, 'human_approval: amending'), changed: true };
}

// BL-409: same targeted-line-replace shape as approveHumanApprovalText, but
// records WHY as a trailing comment on the same line - the reason rides the
// ticket file itself (no second store), matching this project's convention
// of humanApproval as a plain `key: value  # comment` YAML line.
export function rejectHumanApprovalText(rawText: string, reason: string): { text: string; changed: boolean } {
  if (!HUMAN_APPROVAL_PENDING_PATTERN.test(rawText)) {
    return { text: rawText, changed: false };
  }
  const sanitizedReason = sanitizeForYamlComment(reason);
  return {
    text: rawText.replace(HUMAN_APPROVAL_PENDING_PATTERN, `human_approval: rejected  # ${sanitizedReason}`),
    changed: true,
  };
}

// BL-416: read-only counterpart to the writers below - whether THIS
// backlog id's own ticket currently carries a pending human_approval,
// scoped by its own id: field exactly like every reader/writer in this
// file (never a global/all-tickets scan). Lets a caller distinguish "this
// ticket's own sign-off is still open" from "there is nothing pending
// here at all" - operator-decide.ts's old role-gate-only fallback
// collapsed both into one generic "nothing to approve" reply, false for a
// still-pending ticket (BL-416).
export function isTicketPendingApproval(targetPath: string, backlogId: string): boolean {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  return HUMAN_APPROVAL_PENDING_PATTERN.test(fs.readFileSync(filePath, 'utf8'));
}

const HUMAN_APPROVAL_VERDICT_PATTERN = /^human_approval:\s*(approved|rejected)\b/m;

// BL-484: the stale-tap guard's own read - which verdict, specifically, was
// already recorded (never just isTicketPendingApproval's plain pending/
// not-pending) - so a tap on an already-decided ask can name it in an
// "already decided: <verdict>" toast. undefined for a still-pending ticket,
// one with no human_approval field at all, or no matching ticket file -
// every "nothing decided (yet) to report" case collapses to the same
// absent result, never a crash.
export function readRecordedVerdict(targetPath: string, backlogId: string): 'approved' | 'rejected' | undefined {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return undefined;
  }
  const match = fs.readFileSync(filePath, 'utf8').match(HUMAN_APPROVAL_VERDICT_PATTERN);
  return match ? (match[1] as 'approved' | 'rejected') : undefined;
}

const HUMAN_APPROVAL_AMENDING_PATTERN = /^human_approval:\s*amending\s*$/m;
const HUMAN_APPROVAL_APPROVED_PATTERN = /^human_approval:\s*approved\s*$/m;
const HUMAN_APPROVAL_REJECTED_LINE_PATTERN = /^human_approval:\s*rejected(?:\s+#\s*(.*))?$/m;

// BL-561: read the ticket's current non-pending human_approval verdict for
// closing a still-open ApprovalRequested ask (decided-ask reconcile sweep).
export function readApprovalCloseVerdict(targetPath: string, backlogId: string): ApprovalDecisionVerdict | undefined {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return undefined;
  }
  const rawText = fs.readFileSync(filePath, 'utf8');
  if (HUMAN_APPROVAL_PENDING_PATTERN.test(rawText)) {
    return undefined;
  }
  if (HUMAN_APPROVAL_AMENDING_PATTERN.test(rawText)) {
    return { kind: 'amending' };
  }
  const rejected = rawText.match(HUMAN_APPROVAL_REJECTED_LINE_PATTERN);
  if (rejected) {
    return { kind: 'rejected', reason: (rejected[1] ?? '').trim() || 'rejected' };
  }
  if (HUMAN_APPROVAL_APPROVED_PATTERN.test(rawText)) {
    const ruling = readHumanRulingFromText(rawText);
    if (ruling) {
      return { kind: 'ruled', label: ruling };
    }
    return { kind: 'approved' };
  }
  return undefined;
}

const HUMAN_RULING_INLINE_PATTERN = /^human_ruling:\s*(.+)$/m;
const HUMAN_RULING_BLOCK_BODY_PATTERN = /^human_ruling:\s*[|>][+-]?\s*\n((?:[ \t]*\n|[ \t]+.*\n?)*)$/m;

function readHumanRulingFromText(rawText: string): string | undefined {
  const blockMatch = rawText.match(HUMAN_RULING_BLOCK_BODY_PATTERN);
  if (blockMatch) {
    const lines = blockMatch[1]
      .split('\n')
      .map((line) => line.replace(/^\s+/, '').trim())
      .filter((line) => line.length > 0);
    const joined = lines.join(' ').trim();
    return joined.length > 0 ? joined : undefined;
  }
  const inlineMatch = rawText.match(HUMAN_RULING_INLINE_PATTERN);
  if (!inlineMatch) {
    return undefined;
  }
  const inline = inlineMatch[1].trim();
  return inline.length > 0 ? inline : undefined;
}

export function readRecordedRuling(targetPath: string, backlogId: string): string | undefined {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return undefined;
  }
  return readHumanRulingFromText(fs.readFileSync(filePath, 'utf8'));
}

export function readRulingOptions(targetPath: string, backlogId: string): string[] | undefined {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return undefined;
  }
  return parseBacklogYaml(fs.readFileSync(filePath, 'utf8'))?.rulingOptions;
}

// BL-582: WHY a record changed nothing. recordApprovalReply below returns a
// bare boolean, so the tap that failed on 2026-07-23 could not have said
// anything more useful than "false" even if anyone had been listening. Pure
// over the ticket text, so the classification itself is testable without a
// filesystem; explainApprovalRecordNoOp below is the one-line file-reading
// driver, mirroring every other read/driver pair in this module.
export type ApprovalRecordNoOpReason =
  | 'no-ticket-file'
  | 'already-approved'
  | 'already-rejected'
  | 'already-amending'
  | 'no-human-approval-field'
  | 'human-approval-not-pending';

const HUMAN_APPROVAL_FIELD_PATTERN = /^human_approval:\s*(\S+)/m;

export function classifyApprovalRecordNoOp(rawText: string): ApprovalRecordNoOpReason {
  const match = rawText.match(HUMAN_APPROVAL_FIELD_PATTERN);
  if (!match) {
    return 'no-human-approval-field';
  }
  const value = match[1];
  if (value === 'approved') {
    return 'already-approved';
  }
  if (value === 'rejected') {
    return 'already-rejected';
  }
  if (value === 'amending') {
    return 'already-amending';
  }
  // A `pending` value reaching here means the write itself was refused for
  // some other reason - reported as its own case rather than mislabelled as
  // one of the resolved verdicts above.
  return 'human-approval-not-pending';
}

export function explainApprovalRecordNoOp(targetPath: string, backlogId: string): ApprovalRecordNoOpReason {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return 'no-ticket-file';
  }
  return classifyApprovalRecordNoOp(fs.readFileSync(filePath, 'utf8'));
}

// BL-1367: whether an approval may be recorded at all, and whether it carries
// a ruling. PURE over the two facts that decide it - what the ticket declares
// and what the surface offered - so every surface asks one question rather
// than each growing its own reading.
//
// A ticket posing a choice must never end up approved with the choice
// unanswered: the next role cannot tell consent from a complete answer, and
// builds on a guess. BL-1309 was approved that way from the pager on
// 2026-09-01 and its binary refusal-width question was never answered. So an
// approval that cannot carry its ruling is REFUSED rather than half-recorded -
// the human answers it from the bot's ruling keyboard instead.
export type ApprovalRulingRequirement =
  | { kind: 'ok' }
  | { kind: 'ruling-required'; options: string[] }
  | { kind: 'unknown-option'; options: string[] };

export function classifyApprovalRulingRequirement(
  rulingOptions: string[] | undefined,
  ruling: string | undefined
): ApprovalRulingRequirement {
  const options = rulingOptions ?? [];
  // Blank is not an answer. A surface that sent an empty field must not slip
  // past the check a missing one trips.
  const chosen = (ruling ?? '').trim();
  if (options.length === 0) {
    // Nothing declared it, so nothing can validate it - and a ruling on a
    // ticket that posed no choice is the same unanswerable state in the other
    // direction.
    return chosen ? { kind: 'unknown-option', options } : { kind: 'ok' };
  }
  if (!chosen) {
    return { kind: 'ruling-required', options };
  }
  return options.some((option) => option.trim() === chosen)
    ? { kind: 'ok' }
    : { kind: 'unknown-option', options };
}

// Impure driver: flips the ticket's human_approval to approved if it is
// currently pending. Returns whether it actually changed, so the live
// wiring can tell a real flip from a no-op (already approved, or the
// backlog id has no matching ticket file - e.g. a stale topic mapping).
//
// BL-1367: `ruling` is the widened seam. Both entry points - the bot's
// callback path and the paused-pager Mini App route - now reach ONE writer, so
// a third surface cannot reintroduce the dropped ruling by having its own.
// Omitting it is byte-for-byte the behaviour every existing caller had.
// Validating the label against what the ticket declares is the CALLER's job
// (classifyApprovalRulingRequirement above): this driver is told what to
// write, and a caller that has not asked must not be silently rescued here.
export function recordApprovalReply(targetPath: string, backlogId: string, ruling?: string): boolean {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  const rawText = fs.readFileSync(filePath, 'utf8');
  const chosen = (ruling ?? '').trim();
  const { text, changed } = chosen
    ? rulingHumanApprovalText(rawText, chosen)
    : approveHumanApprovalText(rawText);
  if (changed) {
    fs.writeFileSync(filePath, text);
  }
  return changed;
}

export function recordRulingReply(targetPath: string, backlogId: string, rulingLabel: string): boolean {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  const rawText = fs.readFileSync(filePath, 'utf8');
  const { text, changed } = rulingHumanApprovalText(rawText, rulingLabel);
  if (changed) {
    fs.writeFileSync(filePath, text);
  }
  return changed;
}

// BL-409: same shape as recordApprovalReply, for the reject verb. A ticket
// not currently pending (already approved, already rejected, or no matching
// file) is left untouched, reported as no-op - rejecting is a resolution
// exactly once, same idempotency posture as approve.
export function recordRejectionReply(targetPath: string, backlogId: string, reason: string): boolean {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  const rawText = fs.readFileSync(filePath, 'utf8');
  const { text, changed } = rejectHumanApprovalText(rawText, reason);
  if (changed) {
    fs.writeFileSync(filePath, text);
  }
  return changed;
}

// BL-509: same shape as recordApprovalReply, for the amend verb - marks the
// ticket as being steered (human_approval: amending) rather than resolved.
// A ticket not currently pending (already decided, already amending, or no
// matching file) is left untouched, reported as no-op.
export function recordAmendReply(targetPath: string, backlogId: string): boolean {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  const rawText = fs.readFileSync(filePath, 'utf8');
  const { text, changed } = amendHumanApprovalText(rawText);
  if (changed) {
    fs.writeFileSync(filePath, text);
  }
  return changed;
}
