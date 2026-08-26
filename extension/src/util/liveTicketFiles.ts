import * as fs from 'fs';
import * as path from 'path';

// Live folders only - a ticket's structured state (human_approval and
// friends) is only ever read/written while it is active or paused, never
// once it reaches backlog/done. Shared by every scanner that walks live
// ticket files by folder (backfill-human-approval.ts, pendingApprovalReply.ts)
// so the folder set and the readdir-with-missing-folder-tolerance loop live
// in exactly one place (cleaner review: both callers had copy-pasted the
// identical scan skeleton, differing only in what they did with each path).
export const LIVE_BACKLOG_FOLDERS = ['active', 'paused'] as const;

// Walks every `.yaml` file in the live backlog folders, in folder order,
// calling `visit` with each file's absolute path. A missing folder is
// tolerated (skipped), never a crash - the live folders are read
// opportunistically, not guaranteed to both exist. `visit` returning
// `'stop'` ends the walk immediately (used by a caller searching for a
// single match, e.g. by id, rather than visiting every file).
export function forEachLiveTicketFile(targetPath: string, visit: (filePath: string) => void | 'stop'): void {
  for (const folder of LIVE_BACKLOG_FOLDERS) {
    const dir = path.join(targetPath, 'backlog', folder);
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      if (visit(path.join(dir, fileName)) === 'stop') {
        return;
      }
    }
  }
}
