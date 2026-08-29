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

const EXEMPT_REPO_PATHS = new Set([
  'extension/test/helpers/tmpDir.js',
  'extension/test/tmpDirMigrationGuard.test.js',
  'extension/test/tmpDirMigrationGuard.property.test.js',
]);

export type RawMkdtempDetector = {
  findRawMkdtempLines: (text: string) => number[];
};

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

/**
 * The tool's own detector, resolved relative to THIS module. Loaded lazily so
 * a call with nothing in scope does no work at all (invariant 2) - and
 * injectable, so a test can prove it was never reached on that path rather
 * than merely observing that nothing failed.
 */
function loadRawMkdtempDetector(): RawMkdtempDetector {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./rawMkdtempDetector');
}

function isExemptTestPath(relativePath: string): boolean {
  return EXEMPT_REPO_PATHS.has(relativePath.replace(/\\/g, '/'));
}

/**
 * Scan touched extension/test paths for raw mkdtempSync call sites outside the
 * shared helper — same semantics as findRawMkdtempCallSites scoped to one file set.
 */
export function assessPilotMkdtempConvention(
  repoRoot: string,
  touchedRelativePaths: string[],
  { loadDetector = loadRawMkdtempDetector }: { loadDetector?: () => RawMkdtempDetector } = {}
): PilotMkdtempConventionCheckOutcome {
  const scannedPaths: string[] = [];
  const violations: MkdtempViolation[] = [];
  let detector: RawMkdtempDetector | undefined;
  for (const rel of touchedRelativePaths) {
    if (!isExtensionTestJsPath(rel) || isExemptTestPath(rel)) {
      continue;
    }
    const repoRelative = rel.replace(/\\/g, '/');
    const abs = path.join(repoRoot, repoRelative);
    if (!fs.existsSync(abs)) {
      continue;
    }
    // Loaded on the first path actually in scope, never before it.
    detector = detector ?? loadDetector();
    scannedPaths.push(repoRelative);
    const text = fs.readFileSync(abs, 'utf8');
    for (const line of detector.findRawMkdtempLines(text)) {
      violations.push({ file: repoRelative, line });
    }
  }
  return { checked: true, testFilesScanned: scannedPaths.length, violations, scannedPaths };
}
