/**
 * BL-729: resolves a pilot run's own non-merge commits and their patch text
 * from real git, then delegates the per-commit judging entirely to the pure
 * evaluateCommitClaims (commitClaimCheck.ts). Split out of
 * pilot-acceptance-gate.ts so that file's CLI/deps wiring for the BL-727
 * landing path stays free of this feature's git-resolution details.
 *
 * BL-737: also resolves the run's touched-file set (same ancestry scope) and
 * feeds file contents into the pure findCrossFileDuplication checker.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { evaluateCommitClaims } from './commitClaimCheck';
import {
  CrossFileDuplicationCheckOutcome,
  findCrossFileDuplication,
} from './crossFileDuplicationCheck';
import { CommitClaimsCheckOutcome } from './pilotAcceptanceGate';

// The run's own commits are judged against `main`, never HEAD alone (BL-729
// invariant 1 - a commit's verdict must not depend on what a sibling branch
// contains) and never a hardcoded default-branch guess.
const CLAIM_CHECK_BASE_BRANCH = 'main';

export interface RunCommit {
  sha: string;
  message: string;
  patchText: string;
}

// stdin/stderr are ignored (stdout still 'pipe', so encoding:'utf8' keeps
// returning a string): every call site below is inside resolveRunCommits'
// own try/catch, an EXPECTED fails-open path (BL-729), not a crash - git's
// own "fatal: ..." text on stderr would otherwise leak straight to the
// terminal a human is watching, for a condition the gate already handles.
const GIT_CLAIM_CHECK_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

// One commit's full judgeable patch text: the unified diff (added, removed
// and context lines) plus the changed-path list, concatenated - BL-729's
// "own patch text" is these two views combined, not either alone (a rename
// can leave a path visible only in the name-only list, not the hunk body).
function readCommitPatch(repoRoot: string, sha: string): string {
  const diff = execFileSync('git', ['show', '--format=', sha], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: GIT_CLAIM_CHECK_STDIO,
  });
  const changedPaths = execFileSync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '-r', sha],
    { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
  );
  return `${diff}\n${changedPaths}`;
}

// The run's own non-merge commits, oldest first (so a refusal names the
// first offending commit, not the tip - BL-729 scenario 02): everything
// reachable from HEAD but not from CLAIM_CHECK_BASE_BRANCH. Returns
// undefined - never throws - when the range or a commit's patch cannot be
// resolved, which is the gate's fails-OPEN signal, not a CLI crash.
export function resolveRunCommits(repoRoot: string): RunCommit[] | undefined {
  try {
    const mergeBase = execFileSync(
      'git',
      ['merge-base', CLAIM_CHECK_BASE_BRANCH, 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
    ).trim();
    const revListOutput = execFileSync(
      'git',
      ['rev-list', '--no-merges', '--reverse', `${mergeBase}..HEAD`],
      { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
    );
    const shas = revListOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return shas.map((sha) => ({
      sha,
      message: execFileSync('git', ['log', '-1', '--format=%B', sha], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: GIT_CLAIM_CHECK_STDIO,
      }),
      patchText: readCommitPatch(repoRoot, sha),
    }));
  } catch {
    return undefined;
  }
}

// The real git-backed implementation wired into PilotAcceptanceGateDeps.checkCommitClaims
// (required_wiring) - resolves the run's own commits, then delegates the
// per-commit judging entirely to the pure evaluateCommitClaims (commitClaimCheck.ts),
// never reimplementing that loop here.
export function checkCommitClaims(repoRoot: string): CommitClaimsCheckOutcome {
  const commits = resolveRunCommits(repoRoot);
  if (!commits) {
    return { checked: false };
  }
  return { checked: true, ...evaluateCommitClaims(commits) };
}

function listPathsForCommit(repoRoot: string, sha: string): string[] {
  const changedPaths = execFileSync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '-r', sha],
    { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
  );
  return changedPaths
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Files touched by the run's own non-merge commits (BL-737 ancestry scope). */
export function resolveTouchedFiles(repoRoot: string): string[] | undefined {
  const commits = resolveRunCommits(repoRoot);
  if (!commits) {
    return undefined;
  }
  const paths = new Set<string>();
  try {
    for (const commit of commits) {
      for (const filePath of listPathsForCommit(repoRoot, commit.sha)) {
        paths.add(filePath);
      }
    }
  } catch {
    return undefined;
  }
  return [...paths].sort();
}

function readTouchedFileTexts(
  repoRoot: string,
  relativePaths: string[]
): Array<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [];
  for (const relativePath of relativePaths) {
    try {
      const absolute = path.join(repoRoot, relativePath);
      files.push({ path: relativePath, text: fs.readFileSync(absolute, 'utf8') });
    } catch {
      // Skip unreadable paths; history was resolved, so we still check what we can.
    }
  }
  return files;
}

/** Git-backed BL-737 check wired into PilotAcceptanceGateDeps.checkCrossFileDuplication. */
export function checkCrossFileDuplication(repoRoot: string): CrossFileDuplicationCheckOutcome {
  const touched = resolveTouchedFiles(repoRoot);
  if (!touched) {
    return { checked: false };
  }
  return findCrossFileDuplication(readTouchedFileTexts(repoRoot, touched));
}
