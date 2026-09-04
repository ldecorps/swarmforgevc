#!/usr/bin/env node
/**
 * BL-1362: the writer Article 4.4 never had.
 *
 * `review_forward_evidence_gate_lib.bb` refuses a forward whose commit
 * contributed nothing, and has been hardened three times - BL-536, BL-806,
 * BL-1293 - each after a role got the ritual wrong. Enforcement without
 * assistance: 2182 of 12903 non-merge commits over 45 days carry nothing but
 * a backlog/evidence/ file, each composed from scratch.
 *
 * This records what the role supplies. It never decides whether a pass was
 * clean, never authors a defect item, and refuses rather than inventing a
 * verdict when given neither. It touches ONE path under backlog/evidence/ and
 * commits that path alone, so it cannot fold unrelated work into a parcel
 * (BL-506). It removes no gate: a role using it passes the forward gate by
 * construction instead of by remembering.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { evidenceFileName, parseVerdict, renderEvidence } from './reviewEvidenceRecord';
import { makeArgsGuardedMain, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, RecordReviewEvidenceArgs } from './recordReviewEvidenceArgs';

export interface RecordInput extends RecordReviewEvidenceArgs {
  root: string;
  /** Injected so the commit step is a seam, never an env bypass. */
  commitFn?: (root: string, relPath: string, message: string) => string;
}

export interface RecordResult {
  /** Repository-relative path of the file written. */
  file: string;
  /** The 10-hex commit carrying it - what the role forwards (BL-536). */
  commit: string;
}

const EVIDENCE_DIR = path.join('backlog', 'evidence');

export function todayStamp(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function commitPath(root: string, relPath: string, message: string): string {
  // The pathspec is the whole point: `git add -A` here would carry a dirty
  // tree into a review role's parcel (BL-506).
  execFileSync('git', ['add', '--', relPath], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['commit', '-q', '-m', message, '--', relPath], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

export function recordReviewEvidence(input: RecordInput): RecordResult {
  // The verdict is validated BEFORE anything is written: a refusal must leave
  // no file and no commit behind (invariant 3, and the ticket's e2e step 4).
  const verdict = parseVerdict({ none: input.none, items: input.items });
  const date = input.date || todayStamp();
  const dir = path.join(input.root, EVIDENCE_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const name = evidenceFileName(input.ticket, input.role, date, (candidate) =>
    fs.existsSync(path.join(dir, candidate))
  );
  const relPath = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(path.join(input.root, relPath), renderEvidence({ ticket: input.ticket, role: input.role, date, verdict }));

  const summary = verdict.kind === 'none' ? 'NONE' : `${verdict.items.length} defect(s)`;
  const commit = (input.commitFn || commitPath)(
    input.root,
    relPath,
    `${input.ticket}: ${input.role} review pass evidence (${summary})\n\nBy ${input.role}.`
  );
  return { file: relPath, commit };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const result = recordReviewEvidence({ ...args, root: process.cwd() });
  process.stdout.write(`${result.file}\n${result.commit}\n`);
});

if (require.main === module) {
  runCliMain(main);
}
