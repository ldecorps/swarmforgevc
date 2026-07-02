import * as fs from 'fs';
import * as path from 'path';
import { parseBacklogYaml } from './backlogReader';
import { atomicWrite } from '../util/atomicWrite';

const ASSIGNED_TO_LINE = /^assigned_to:\s*.+$/m;

function findActiveBacklogFilePath(targetPath: string, itemId: string): string | null {
  const dir = path.join(targetPath, 'backlog', 'active');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
  } catch {
    return null;
  }

  for (const file of files) {
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

// Only the assigned_to field is writable from the panel (BL-034); every
// other line is left byte-identical, so this edits the field in place with
// a targeted regex rather than regenerating the file from parsed structure.
export function setAssignedTo(targetPath: string, itemId: string, assignedTo: string): boolean {
  const filePath = findActiveBacklogFilePath(targetPath, itemId);
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

export interface MarkDoneResult {
  moved: boolean;
  destination?: string;
}

// Moves the file only - it never rewrites the status field. The done/
// folder is the authoritative signal (BL-033), matching readBacklog's own
// override of done-folder items regardless of their YAML status.
export function markDone(targetPath: string, itemId: string): MarkDoneResult {
  const filePath = findActiveBacklogFilePath(targetPath, itemId);
  if (!filePath) {
    return { moved: false };
  }
  const item = parseBacklogYaml(fs.readFileSync(filePath, 'utf8'));
  const destDir = item?.milestone
    ? path.join(targetPath, 'backlog', 'done', item.milestone)
    : path.join(targetPath, 'backlog', 'done');
  fs.mkdirSync(destDir, { recursive: true });
  const destination = path.join(destDir, path.basename(filePath));
  fs.renameSync(filePath, destination);
  return { moved: true, destination };
}
