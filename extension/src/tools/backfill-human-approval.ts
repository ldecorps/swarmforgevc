#!/usr/bin/env node
/**
 * BL-251: one-time, idempotent migration seeding the structured
 * human_approval field on live tickets (backlog/active + backlog/paused,
 * never backlog/done) from their existing free-text "# HUMAN APPROVAL:"
 * comment block. Once seeded, backlogReader.ts's human_approval field is
 * the single source of truth for the needs-approval list - this migration
 * exists only to carry legacy tickets forward, never re-run as a live
 * derivation.
 *
 * Idempotent and non-clobbering: a ticket that already carries a
 * human_approval: line (regardless of its value - including a human's own
 * later edit) is left completely untouched.
 *
 * Usage: node backfill-human-approval.js <target-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { runCliMain } from './swarm-metrics';

export type BackfillOutcome = 'seeded' | 'already-set' | 'no-comment-found' | 'undetermined';

export interface BackfillTextResult {
  text: string;
  outcome: BackfillOutcome;
  value?: 'pending' | 'approved';
}

const HUMAN_APPROVAL_FIELD_PATTERN = /^human_approval:/m;
const COMMENT_HEADER_PATTERN = /^# HUMAN APPROVAL:/i;

function deriveApprovalFromCommentBlock(commentLines: string[]): 'pending' | 'approved' | null {
  const text = commentLines.join(' ').toLowerCase();
  if (text.includes('approved')) {
    return 'approved';
  }
  if (text.includes('pending')) {
    return 'pending';
  }
  return null;
}

// Pure: derives the seeded text from raw ticket-file content. Never
// touches the filesystem - runHumanApprovalBackfill below is the one
// impure caller that reads/writes real files.
export function backfillHumanApprovalText(rawText: string): BackfillTextResult {
  if (HUMAN_APPROVAL_FIELD_PATTERN.test(rawText)) {
    return { text: rawText, outcome: 'already-set' };
  }

  const lines = rawText.split('\n');
  const startIdx = lines.findIndex((line) => COMMENT_HEADER_PATTERN.test(line));
  if (startIdx === -1) {
    return { text: rawText, outcome: 'no-comment-found' };
  }

  let endIdx = startIdx;
  while (endIdx + 1 < lines.length && lines[endIdx + 1].startsWith('#')) {
    endIdx += 1;
  }

  const value = deriveApprovalFromCommentBlock(lines.slice(startIdx, endIdx + 1));
  if (!value) {
    return { text: rawText, outcome: 'undetermined' };
  }

  const seededLines = [...lines.slice(0, endIdx + 1), `human_approval: ${value}`, ...lines.slice(endIdx + 1)];
  return { text: seededLines.join('\n'), outcome: 'seeded', value };
}

export interface BackfillFileResult {
  filePath: string;
  outcome: BackfillOutcome;
  value?: 'pending' | 'approved';
}

// Live folders only - matches the ticket's own "touches only live items
// (active + paused), not done/" constraint.
const LIVE_FOLDERS = ['active', 'paused'];

export function runHumanApprovalBackfill(targetPath: string): BackfillFileResult[] {
  const results: BackfillFileResult[] = [];
  for (const folder of LIVE_FOLDERS) {
    const dir = path.join(targetPath, 'backlog', folder);
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      const filePath = path.join(dir, fileName);
      const rawText = fs.readFileSync(filePath, 'utf8');
      const { text, outcome, value } = backfillHumanApprovalText(rawText);
      if (outcome === 'seeded') {
        fs.writeFileSync(filePath, text);
      }
      results.push(value !== undefined ? { filePath, outcome, value } : { filePath, outcome });
    }
  }
  return results;
}

// Pure - split out of main() so the report text is exercised in-process
// (same "CLI main() run only via execFileSync is coverage-invisible"
// lesson recruiter-run.ts's/co-change-report.ts's own hardener passes
// already established for this codebase's other CLIs).
export function formatBackfillResultLine(result: BackfillFileResult): string {
  return `${result.outcome}${result.value ? ` (${result.value})` : ''}: ${result.filePath}`;
}

export function formatBackfillReport(results: BackfillFileResult[]): string {
  const seeded = results.filter((r) => r.outcome === 'seeded').length;
  return [...results.map(formatBackfillResultLine), '', `${seeded} ticket(s) seeded, ${results.length} checked.`].join('\n');
}

export function resolveTargetPath(argv: string[]): string {
  return argv[2] ?? process.cwd();
}

export function main(): void {
  const targetPath = resolveTargetPath(process.argv);
  const results = runHumanApprovalBackfill(targetPath);
  console.log(formatBackfillReport(results));
}

if (require.main === module) {
  runCliMain(main);
}
