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
 * draft to be gone. BL-1550: it deletes only the regular file the sender
 * wrote - never a directory, not with unlinkSync (EISDIR) and not with a
 * recursive removal (which would delete a tree the sender never created).
 * A directory at the draft path is left untouched; the call still does not
 * throw. The CLI can also delete the draft between the stat and the
 * unlink, so ENOENT is swallowed at both steps.
 */
export function removeDraftIfPresent(draftPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(draftPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
  if (!stat.isFile()) {
    return;
  }
  try {
    fs.unlinkSync(draftPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}
