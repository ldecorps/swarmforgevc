// BL-819: helpers shared by more than one leanLedgerCompose* module.
import * as fs from 'fs';
import * as path from 'path';
import { LeanLedgerDataValue } from '../quality/leanLedger';

export interface MinimalRoleEntry {
  role: string;
  worktreeName: string;
  worktreePath: string;
}

// Drops undefined values (an optional upstream field that wasn't present)
// rather than writing them as null - the KEY is simply absent, same as the
// upstream record never had it, and hasLeanLedgerEventShape only checks
// that PRESENT keys are in the closed allow-list.
export function definedData(fields: Record<string, LeanLedgerDataValue | undefined>): Record<string, LeanLedgerDataValue> {
  const data: Record<string, LeanLedgerDataValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data[key] = value;
    }
  }
  return data;
}

// Recursive: a ticket may sit flat under backlog/active/ or nested under
// backlog/done/<milestone>/ (this project's own close-into-done/<milestone>
// convention) by the time its lifecycle is recorded.
function findTicketYamlPathUnder(dir: string, ticket: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findTicketYamlPathUnder(full, ticket);
      if (found) {
        return found;
      }
    }
    if (entry.isFile() && entry.name.startsWith(`${ticket}-`) && entry.name.endsWith('.yaml')) {
      return full;
    }
  }
  return null;
}

export { findTicketYamlPathUnder };

// A ticket being recorded mid-pipeline is still under active/; one already
// closed is under done/ - check both, active first (the common case).
export function findTicketYamlPath(targetPath: string, ticket: string): string | null {
  return findTicketYamlPathUnder(path.join(targetPath, 'backlog', 'active'), ticket) ?? findTicketYamlPathUnder(path.join(targetPath, 'backlog', 'done'), ticket);
}
