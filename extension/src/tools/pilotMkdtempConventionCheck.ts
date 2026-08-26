/**
 * BL-743: mkTmpDir convention check for /pilot land. Scans touched
 * extension/test/*.js for raw mkdtempSync outside helpers/tmpDir.js using the
 * same detector as tmpDirMigrationGuard.test.js (rawMkdtempGuard.js).
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

type RawMkdtempGuard = {
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

function loadRawMkdtempGuard(repoRoot: string): RawMkdtempGuard {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(repoRoot, 'extension', 'test', 'helpers', 'rawMkdtempGuard'));
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
  touchedRelativePaths: string[]
): PilotMkdtempConventionCheckOutcome {
  const guard = loadRawMkdtempGuard(repoRoot);
  const scannedPaths: string[] = [];
  const violations: MkdtempViolation[] = [];
  for (const rel of touchedRelativePaths) {
    if (!isExtensionTestJsPath(rel) || isExemptTestPath(rel)) {
      continue;
    }
    const repoRelative = rel.replace(/\\/g, '/');
    const abs = path.join(repoRoot, repoRelative);
    if (!fs.existsSync(abs)) {
      continue;
    }
    scannedPaths.push(repoRelative);
    const text = fs.readFileSync(abs, 'utf8');
    for (const line of guard.findRawMkdtempLines(text)) {
      violations.push({ file: repoRelative, line });
    }
  }
  return { checked: true, testFilesScanned: scannedPaths.length, violations, scannedPaths };
}
