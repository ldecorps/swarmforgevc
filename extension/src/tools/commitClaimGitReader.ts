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
import {
  ShellEntryPointDriveCheckOutcome,
  assessShellEntryPointDrive,
  isShellTestPath,
} from './shellEntryPointDriveCheck';
import {
  UnreachableStepHandlerCheckOutcome,
  assessUnreachableStepHandlers,
  isStepHandlerPath,
  FeatureStepIr,
} from './unreachableStepHandlerCheck';
import {
  MultiBranchParserCoverageOutcome,
  assessMultiBranchParserCoverage,
  extractMultiBranchParsers,
} from './multiBranchParserCoverageCheck';
import {
  PerHatRolePromptEvidenceOutcome,
  assessPerHatRolePromptEvidence,
  StageVerdictEvidence,
} from './perHatRolePromptEvidenceCheck';
import { CommitClaimsCheckOutcome } from './pilotAcceptanceGate';
import { findBacklogFilePath } from '../panel/backlogWriter';
import { parseBacklogYaml } from '../panel/backlogReader';
import { resolveFeatureFilePath } from './pilotAcceptanceGate';

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

/** Git + backlog YAML-backed BL-747 check for shell entry-point drive. */
export function checkShellEntryPointDrive(
  repoRoot: string,
  ticketId: string
): ShellEntryPointDriveCheckOutcome {
  const touched = resolveTouchedFiles(repoRoot);
  if (!touched) {
    return { checked: false };
  }
  const yamlPath = findBacklogFilePath(repoRoot, ticketId);
  if (!yamlPath) {
    return { checked: false };
  }
  let ticketYaml: string;
  try {
    ticketYaml = fs.readFileSync(yamlPath, 'utf8');
  } catch {
    return { checked: false };
  }
  const shellTests = readTouchedFileTexts(
    repoRoot,
    touched.filter((p) => isShellTestPath(p))
  );
  return assessShellEntryPointDrive({ ticketYaml, shellTests });
}

function parseFeatureIr(repoRoot: string, featureFilePath: string): FeatureStepIr | undefined {
  try {
    // Lazy require: keep extension/src free of a static edge into specs/pipeline.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseFeatureFile } = require(path.join(repoRoot, 'specs', 'pipeline', 'runnerAdapter.js'));
    return parseFeatureFile(featureFilePath) as FeatureStepIr;
  } catch {
    return undefined;
  }
}

/** Git + acceptance feature-backed BL-753 unreachable step-handler check. */
export function checkUnreachableStepHandlers(
  repoRoot: string,
  ticketId: string
): UnreachableStepHandlerCheckOutcome {
  const touched = resolveTouchedFiles(repoRoot);
  if (!touched) {
    return { checked: false };
  }
  const stepPaths = touched.filter((p) => isStepHandlerPath(p));
  if (stepPaths.length === 0) {
    return { checked: true, stepFilesScanned: 0, patternsChecked: 0 };
  }
  const yamlPath = findBacklogFilePath(repoRoot, ticketId);
  if (!yamlPath) {
    return { checked: false };
  }
  let declaration: string | undefined;
  try {
    const item = parseBacklogYaml(fs.readFileSync(yamlPath, 'utf8'));
    declaration = item?.acceptance;
  } catch {
    return { checked: false };
  }
  if (!declaration) {
    return { checked: false };
  }
  const featureFilePath = resolveFeatureFilePath(repoRoot, declaration);
  if (!featureFilePath) {
    return { checked: false };
  }
  const feature = parseFeatureIr(repoRoot, featureFilePath);
  if (!feature) {
    return { checked: false };
  }
  return assessUnreachableStepHandlers({
    feature,
    stepFiles: readTouchedFileTexts(repoRoot, stepPaths),
    ticketId,
  });
}

function isParserSourcePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return /\.(bb|clj|ts|js|mjs|cjs)$/.test(normalized) && !/\/test\//.test(normalized);
}

function isTestSourcePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return (
    /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(normalized) ||
    /\/test\//.test(normalized) ||
    /\/scripts\/test\//.test(normalized)
  );
}

/** Git-backed BL-755 multi-branch parser coverage check. */
export function checkMultiBranchParserCoverage(
  repoRoot: string,
  _ticketId: string
): MultiBranchParserCoverageOutcome {
  const touched = resolveTouchedFiles(repoRoot);
  if (!touched) {
    return { checked: false };
  }
  const sourcePaths = touched.filter((p) => isParserSourcePath(p));
  const testPaths = touched.filter((p) => isTestSourcePath(p));
  if (sourcePaths.length === 0) {
    return { checked: true, parsersScanned: 0 };
  }
  const sources = readTouchedFileTexts(repoRoot, sourcePaths);
  const tests = readTouchedFileTexts(repoRoot, testPaths);
  return assessMultiBranchParserCoverage({
    parsers: extractMultiBranchParsers(sources),
    testTexts: tests.map((t) => t.text),
  });
}

function readExpediteVerdicts(repoRoot: string, ticketId: string): StageVerdictEvidence[] | undefined {
  const root = path.join(repoRoot, '.swarmforge', 'expedite', ticketId);
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return undefined;
  }
  const verdicts: StageVerdictEvidence[] = [];
  for (const entry of entries) {
    if (!/^\d{2}-/.test(entry)) {
      continue;
    }
    const verdictPath = path.join(root, entry, 'verdict.json');
    let raw: string;
    try {
      raw = fs.readFileSync(verdictPath, 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as {
        role?: string;
        role_prompt_path?: string;
        role_prompt_sha256?: string;
      };
      verdicts.push({
        verdictPath: path.relative(repoRoot, verdictPath).replace(/\\/g, '/'),
        role: parsed.role || entry.replace(/^\d{2}-/, ''),
        role_prompt_path: parsed.role_prompt_path,
        role_prompt_sha256: parsed.role_prompt_sha256,
      });
    } catch {
      verdicts.push({
        verdictPath: path.relative(repoRoot, verdictPath).replace(/\\/g, '/'),
        role: entry.replace(/^\d{2}-/, ''),
      });
    }
  }
  return verdicts;
}

/** Filesystem-backed BL-758 per-hat role-prompt evidence check. */
export function checkPerHatRolePromptEvidence(
  repoRoot: string,
  ticketId: string
): PerHatRolePromptEvidenceOutcome {
  const verdicts = readExpediteVerdicts(repoRoot, ticketId);
  if (verdicts === undefined) {
    return { checked: false };
  }
  return assessPerHatRolePromptEvidence({ verdicts });
}
