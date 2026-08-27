/**
 * BL-608: ticket file operations for record-qa-bounce CLI.
 * Best-effort, never blocking: any failure to find, read, merge, or write
 * the ticket's own record is reported as a reason, never thrown.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BounceHistoryEntry, mergeBounceHistoryEntry } from '../quality/bounceHistory';

// Locates the ticket's own backlog/active/<TICKET>-*.yaml in the CURRENT
// worktree - never a glob into another worktree's checkout.
function findActiveTicketYamlPath(projectRoot: string, ticket: string): string | null {
  const activeDir = path.join(projectRoot, 'backlog', 'active');
  let files: string[];
  try {
    files = fs.readdirSync(activeDir);
  } catch {
    return null;
  }
  const match = files.find((f) => f.startsWith(`${ticket}-`) && f.endsWith('.yaml'));
  return match ? path.join(activeDir, match) : null;
}

export function updateTicketBounceHistory(
  projectRoot: string,
  ticket: string,
  entry: BounceHistoryEntry
): { updated: boolean; reason: string } {
  try {
    const ticketPath = findActiveTicketYamlPath(projectRoot, ticket);
    if (!ticketPath) {
      return { updated: false, reason: 'not-found' };
    }
    const text = fs.readFileSync(ticketPath, 'utf8');
    const result = mergeBounceHistoryEntry(text, entry);
    if (!result.updated) {
      return { updated: false, reason: result.reason };
    }
    fs.writeFileSync(ticketPath, result.text, 'utf8');
    return { updated: true, reason: result.reason };
  } catch (error) {
    return { updated: false, reason: error instanceof Error ? error.message : 'unknown-error' };
  }
}
