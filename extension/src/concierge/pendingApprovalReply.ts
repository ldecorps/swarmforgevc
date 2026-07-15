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
