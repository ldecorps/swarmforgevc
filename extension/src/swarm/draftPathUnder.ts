import * as fs from 'fs';
import * as path from 'path';

/**
 * BL-1537: a script-built handoff draft must live under the project root
 * the send will resolve, under its gitignored `tmp/` subdirectory — never
 * under the system temp dir. BL-1518-a's fail-closed root guard in
 * swarm_handoff.bb refuses any draft that is not under the resolved root,
 * so a draft built from `os.tmpdir()` is refused before the mailbox write.
 */
export function draftPathUnder(root: string, prefix: string): string {
  const nonce = Math.random().toString(36).slice(2);
  return path.join(root, 'tmp', `${prefix}-${process.pid}-${nonce}`);
}

/**
 * swarm_handoff.bb deletes the draft itself once it queues or delivers it,
 * so a sender's own cleanup must be idempotent - a plain unlinkSync throws
 * ENOENT on exactly the success path, the one outcome that most needs the
 * draft to be gone.
 */
export function removeDraftIfPresent(draftPath: string): void {
  if (fs.existsSync(draftPath)) {
    fs.unlinkSync(draftPath);
  }
}
