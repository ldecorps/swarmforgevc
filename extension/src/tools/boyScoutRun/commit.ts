/**
 * BL-1015 — committing exactly the paths a run edited, and the message that
 * explains why. Split out of `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import { defaultGateSpawn } from './gates';
import type { Envelope, GateResult, GateSpawn } from './types';

/**
 * Commits EXACTLY the paths this run edited, and nothing else.
 *
 * `git add -A` would be shorter and is wrong twice over. It would sweep
 * whatever else happened to be dirty in the checkout into a commit whose
 * message claims it cleaned one debt item — the house rule that an approval
 * authorizes only its own ticket's work, breached by an autonomous committer
 * that nobody is watching. And the run's own proposal file lives under
 * `.swarmforge/`, so `-A` would commit the instruction alongside the result.
 *
 * `git commit -- <paths>` is a partial commit taken through a temporary index,
 * so unrelated content that was ALREADY staged stays staged and uncommitted
 * rather than riding along. The `git add` before it exists only so a path the
 * cleanup created is known to git at all; `commit -- <paths>` alone rejects an
 * untracked pathspec.
 *
 * A non-zero status from either is thrown, never swallowed: "the commit did
 * not happen" and "the cleanup was committed" are opposite facts, and
 * `boyScoutRun` restores the tree on a throw.
 */
export function commitEdits(
  root: string,
  message: string,
  paths: string[],
  spawn: GateSpawn = defaultGateSpawn
): void {
  if (paths.length === 0) {
    // Not "commit nothing": an empty pathspec is the state in which a caller
    // reaches for `-A` to recover, which is the thing this function exists to
    // make impossible.
    throw new Error('refusing to commit with no paths: a boy scout commit names the files it cleaned');
  }
  const add = spawn('git', ['add', '--', ...paths], root);
  if (add.status !== 0 || add.error) {
    throw new Error(`git add failed: ${add.error?.message ?? add.output ?? ''}`);
  }
  const commit = spawn('git', ['commit', '-m', message, '--', ...paths], root);
  if (commit.status !== 0 || commit.error) {
    throw new Error(`git commit failed: ${commit.error?.message ?? commit.output ?? ''}`);
  }
}

export function buildCommitMessage(result: {
  subject: string | null;
  summary: string | null;
  measured: Envelope;
  envelope: Envelope;
  gate: GateResult | null;
}): string {
  const gates = result.gate?.ran.join(', ') || 'none';
  return [
    `BL-1015 boy scout: ${result.summary ?? 'cleanup'}`,
    '',
    `Cleaned the top-ranked debt item from the Boy Scout scan: ${result.subject}.`,
    `Envelope: ${result.measured.files} file(s), ${result.measured.lines} line(s) ` +
      `of ${result.envelope.files}/${result.envelope.lines}.`,
    `Gates passed before commit: ${gates}.`,
  ].join('\n');
}
