import * as fs from 'fs';
import * as path from 'path';
import { parseBacklogYaml } from './backlogReader';
import { atomicWrite } from '../util/atomicWrite';

const ASSIGNED_TO_LINE = /^assigned_to:\s*.+$/m;

function findMatchingBacklogFile(dir: string, itemId: string): string | null {
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const filePath = path.join(dir, file);
    try {
      const item = parseBacklogYaml(fs.readFileSync(filePath, 'utf8'));
      if (item && item.id === itemId) {
        return filePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findBacklogFilePathIn(targetPath: string, folder: 'active' | 'paused', itemId: string): string | null {
  const dir = path.join(targetPath, 'backlog', folder);
  try {
    return findMatchingBacklogFile(dir, itemId);
  } catch {
    return null;
  }
}

// Only the assigned_to field is writable from the panel (BL-034); every
// other line is left byte-identical, so this edits the field in place with
// a targeted regex rather than regenerating the file from parsed structure.
export function setAssignedTo(targetPath: string, itemId: string, assignedTo: string): boolean {
  const filePath = findBacklogFilePathIn(targetPath, 'active', itemId);
  if (!filePath) {
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!ASSIGNED_TO_LINE.test(content)) {
    return false;
  }
  atomicWrite(filePath, content.replace(ASSIGNED_TO_LINE, `assigned_to: ${assignedTo}`));
  return true;
}

export interface BacklogMoveResult {
  moved: boolean;
  destination?: string;
}

// Shared by markDone and promoteToActive: both are a find-then-rename into
// a destination folder, differing only in how that folder is computed.
function moveBacklogFileTo(filePath: string, destDir: string): BacklogMoveResult {
  fs.mkdirSync(destDir, { recursive: true });
  const destination = path.join(destDir, path.basename(filePath));
  fs.renameSync(filePath, destination);
  return { moved: true, destination };
}

// Moves the file only - it never rewrites the status field. The done/
// folder is the authoritative signal (BL-033), matching readBacklog's own
// override of done-folder items regardless of their YAML status.
export function markDone(targetPath: string, itemId: string): BacklogMoveResult {
  const filePath = findBacklogFilePathIn(targetPath, 'active', itemId);
  if (!filePath) {
    return { moved: false };
  }
  const item = parseBacklogYaml(fs.readFileSync(filePath, 'utf8'));
  const destDir = item?.milestone
    ? path.join(targetPath, 'backlog', 'done', item.milestone)
    : path.join(targetPath, 'backlog', 'done');
  return moveBacklogFileTo(filePath, destDir);
}

// BL-490: the Expedite verb's force-promote step - no paused->active mover
// existed before this (the only prior mover was markDone's active->done
// above; promotion was otherwise the coordinator's exclusive manual duty).
// backlog/active/ is flat (unlike backlog/done/, never split by milestone),
// so the destination is always a plain rename into that directory. An item
// not found in backlog/paused/ - because it does not exist, or is already
// active - is reported as moved: false rather than an error, so the
// Expedite effect can call this unconditionally and skip promotion for an
// already-active ticket (acceptance scenario 05) with no separate check.
export function promoteToActive(targetPath: string, itemId: string): BacklogMoveResult {
  const filePath = findBacklogFilePathIn(targetPath, 'paused', itemId);
  if (!filePath) {
    return { moved: false };
  }
  const destDir = path.join(targetPath, 'backlog', 'active');
  return moveBacklogFileTo(filePath, destDir);
}
