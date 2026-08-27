// BL-1190: the canonical "does this backlog id have a live ticket file"
// check - a ghost approval ask (BL-1186) is exactly a buttoned ApprovalRequested
// ask whose backing yaml never landed or has since vanished. Extracted from
// pendingApprovalReply.ts's own private findTicketFilePath (BL-582's record
// path) so the pre-post gate and the stale-ask reconcile sweep share the
// SAME lookup pendingApprovalReply.ts already uses to record a verdict -
// never a second, drifting existence check.
import * as fs from 'fs';
import { forEachLiveTicketFile } from '../util/liveTicketFiles';

// Located by the ticket's own `id:` field, never a filename guess - same
// identity backlogReader.ts treats as authoritative.
export function findTicketFilePath(targetPath: string, backlogId: string): string | undefined {
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

export function ticketFileExists(targetPath: string, backlogId: string): boolean {
  return findTicketFilePath(targetPath, backlogId) !== undefined;
}
