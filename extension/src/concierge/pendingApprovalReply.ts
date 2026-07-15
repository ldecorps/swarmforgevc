// BL-357: the "genuinely new half" the ticket calls out - when the human
// replies in a ticket's own topic to approve it, this module RECORDS that
// approval against the ticket by flipping its structured `human_approval`
// field from pending to approved. Mirrors backfill-human-approval.ts's own
// read/find/replace/write-back pattern (the established precedent for
// writing this exact field) and backlogReader.ts's own `id:` field match
// (never a filename-prefix guess) - a "flip pending->approved on a real
// reply" writer, never a blind seed (that stays backfill's job).
import * as fs from 'fs';
import { forEachLiveTicketFile } from '../util/liveTicketFiles';

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

// Located by the ticket's own `id:` field, never a filename guess - the
// same identity backlogReader.ts already treats as authoritative. Walks the
// live folders (active + paused, never done) via the shared scan
// forEachLiveTicketFile already uses for backfill-human-approval.ts's
// identical folder walk (cleaner review: the two has duplicated the same
// readdir-with-missing-folder-tolerance loop).
function findTicketFilePath(targetPath: string, backlogId: string): string | undefined {
  let found: string | undefined;
  forEachLiveTicketFile(targetPath, (filePath) => {
    const idMatch = fs.readFileSync(filePath, 'utf8').match(/^id:\s*(.+)$/m);
    if (idMatch && idMatch[1].trim() === backlogId) {
      found = filePath;
      return 'stop';
    }
  });
  return found;
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

// Impure driver: flips the ticket's human_approval to approved if it is
// currently pending. Returns whether it actually changed, so the live
// wiring can tell a real flip from a no-op (already approved, or the
// backlog id has no matching ticket file - e.g. a stale topic mapping).
export function recordApprovalReply(targetPath: string, backlogId: string): boolean {
  const filePath = findTicketFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  const rawText = fs.readFileSync(filePath, 'utf8');
  const { text, changed } = approveHumanApprovalText(rawText);
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
