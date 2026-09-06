/**
 * BL-743: mkTmpDir convention check for /pilot land. Scans touched
 * extension/test/*.js for raw mkdtempSync outside helpers/tmpDir.js using the
 * same detector as tmpDirMigrationGuard.test.js.
 *
 * BL-1209: that detector is resolved from the TOOL, never from the subject
 * root this check is handed. It used to `require(<repoRoot>/extension/test/
 * helpers/rawMkdtempGuard)`, which is a SwarmForge-VC artifact existing in
 * exactly one repository - so the check ran only against the root that
 * happens to contain it and threw MODULE_NOT_FOUND against any other. It also
 * threw EAGERLY, on the first line, so a call whose touched paths contained
 * nothing it would ever scan failed just as hard as one with real work.
 * `repoRoot` now keeps only its real job: reading the subject's files.
 */
import * as fs from 'fs';
import * as path from 'path';

export const PILOT_RAW_MKDTEMP_REFUSAL = 'raw mkdtemp outside the shared helper';

export type MkdtempViolation = {
  file: string;
  line: number;
};

export type PilotMkdtempConventionCheckOutcome =
  | { checked: true; testFilesScanned: number; violations: MkdtempViolation[]; scannedPaths: string[] }
  | { checked: false };

const EXT_TEST_JS_RE = /^extension\/test\/.*\.js$/;

// BL-1226: specs/pipeline/steps/ - the largest fixture-creating population in
// the repository (436 of 821 step handlers create a temp root) - had no gate
// at all. Matches nested lib/ files too (socketFixtureRoot.js itself needs to
// resolve to THIS shape before the exemption below can override it to
// 'exempt' rather than it falling through as merely out-of-scope).
const STEPS_JS_RE = /^specs\/pipeline\/steps\/.*\.js$/;

// Mirrors rawMkdtempGuard.js's SELF_EXEMPT_RELATIVE_PATHS (extension/test/-
// relative there; repo-relative here). A ticket that touches one of this
// check's OWN fixture-string test files - including this check's own -
// must not have this gate refuse the land over a raw-mkdtemp "violation"
// that is test DATA, not executable code. BL-1226 adds the steps lane's own
// required helper (the one route a step handler takes to avoid a violation)
// and this ticket's own acceptance step handler, which builds scratch
// fixture text containing the literal pattern as test DATA the same way
// pilotMkdtempConventionCheck.test.js already does above.
const EXEMPT_REPO_PATHS = new Set([
  'extension/test/helpers/tmpDir.js',
  'extension/test/tmpDirMigrationGuard.test.js',
  'extension/test/tmpDirMigrationGuard.property.test.js',
  'extension/test/pilotMkdtempConventionCheck.test.js',
  'extension/test/pilotMkdtempConventionCheck.property.test.js',
  'specs/pipeline/steps/lib/socketFixtureRoot.js',
  'specs/pipeline/steps/bl1226StepHandlerMkdtempGateSteps.js',
]);

export type RawMkdtempDetector = {
  findRawMkdtempLines: (text: string) => number[];
};

export type MkdtempConventionScopeClassification = 'in-scope' | 'exempt' | 'out-of-scope';

export function isExtensionTestJsPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!EXT_TEST_JS_RE.test(normalized)) {
    return false;
  }
  if (normalized.includes('/fixtures/')) {
    return false;
  }
  return true;
}

/** BL-1226: touched-path shape test for the steps lane, mirroring isExtensionTestJsPath above. */
export function isStepsHandlerJsPath(relativePath: string): boolean {
  return STEPS_JS_RE.test(relativePath.replace(/\\/g, '/'));
}

function isExemptTestPath(relativePath: string): boolean {
  return EXEMPT_REPO_PATHS.has(relativePath.replace(/\\/g, '/'));
}

/**
 * BL-1226: the one place scope is decided, for either lane. Exemption is
 * checked before either lane's shape test so a required helper or this
 * check's own fixture-string test files always classify 'exempt' rather than
 * 'in-scope', regardless of which lane's directory they happen to sit under.
 */
export function classifyMkdtempConventionPath(relativePath: string): MkdtempConventionScopeClassification {
  const normalized = relativePath.replace(/\\/g, '/');
  if (isExemptTestPath(normalized)) {
    return 'exempt';
  }
  if (isExtensionTestJsPath(normalized) || isStepsHandlerJsPath(normalized)) {
    return 'in-scope';
  }
  return 'out-of-scope';
}

/**
 * The tool's own detectors, resolved relative to THIS module. Loaded lazily so
 * a call with nothing in scope does no work at all (invariant 2) - and
 * injectable, so a test can prove one was never reached on that path rather
 * than merely observing that nothing failed. Two separate detectors because
 * the two lanes use different strategies (spelling-based vs. route-based,
 * see rawMkdtempDetector.ts) - loading both eagerly here would defeat the
 * "never loaded when nothing is in scope for it" half of invariant 2.
 */
function loadRawMkdtempDetector(): RawMkdtempDetector {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./rawMkdtempDetector');
  return { findRawMkdtempLines: mod.findRawMkdtempLines };
}

function loadRawMkdtempAnyBaseDetector(): RawMkdtempDetector {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./rawMkdtempDetector');
  return { findRawMkdtempLines: mod.findRawMkdtempLinesAnyBase };
}

type ScopedPath = { repoRelative: string; lane: 'test' | 'steps' };

/**
 * The repo-relative, forward-slashed path and which lane's detector it needs,
 * if this touched path is in scope (not exempt, and it actually exists at
 * repoRoot) - undefined otherwise. Combines every "should we even look at
 * this path, and how" decision into one so the caller loop stays a single
 * decision.
 */
function inScopePath(repoRoot: string, relativePath: string): ScopedPath | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  if (classifyMkdtempConventionPath(normalized) !== 'in-scope') {
    return undefined;
  }
  if (!fs.existsSync(path.join(repoRoot, normalized))) {
    return undefined;
  }
  return { repoRelative: normalized, lane: isStepsHandlerJsPath(normalized) ? 'steps' : 'test' };
}

/**
 * Scan touched extension/test AND specs/pipeline/steps paths for raw
 * mkdtempSync call sites outside their lane's required shared helper.
 */
export function assessPilotMkdtempConvention(
  repoRoot: string,
  touchedRelativePaths: string[],
  {
    loadDetector = loadRawMkdtempDetector,
    loadStepsDetector = loadRawMkdtempAnyBaseDetector,
  }: { loadDetector?: () => RawMkdtempDetector; loadStepsDetector?: () => RawMkdtempDetector } = {}
): PilotMkdtempConventionCheckOutcome {
  const scannedPaths: string[] = [];
  const violations: MkdtempViolation[] = [];
  let testDetector: RawMkdtempDetector | undefined;
  let stepsDetector: RawMkdtempDetector | undefined;
  for (const rel of touchedRelativePaths) {
    const scoped = inScopePath(repoRoot, rel);
    if (!scoped) {
      continue;
    }
    const { repoRelative, lane } = scoped;
    // Loaded on the first path actually in scope FOR THAT LANE, never before it.
    const detector =
      lane === 'steps' ? (stepsDetector = stepsDetector ?? loadStepsDetector()) : (testDetector = testDetector ?? loadDetector());
    scannedPaths.push(repoRelative);
    const text = fs.readFileSync(path.join(repoRoot, repoRelative), 'utf8');
    for (const line of detector.findRawMkdtempLines(text)) {
      violations.push({ file: repoRelative, line });
    }
  }
  return { checked: true, testFilesScanned: scannedPaths.length, violations, scannedPaths };
}
