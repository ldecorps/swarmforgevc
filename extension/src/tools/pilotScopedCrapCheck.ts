/**
 * BL-741: scoped CRAP check for /pilot land. Applies crapReport logic to
 * extension TypeScript files the run touched. IO (git touched-path resolution)
 * stays in commitClaimGitReader / pilot-acceptance-gate.
 */
import * as fs from 'fs';
import * as path from 'path';

export const PILOT_CRAP_VIOLATION_REFUSAL = 'touched function exceeds CRAP threshold';

export const PILOT_CRAP_THRESHOLD = 6;

export type CrapViolation = {
  file: string;
  function: string;
  crap: number;
};

export type PilotScopedCrapCheckOutcome =
  | { checked: true; tsFilesScanned: number; violations: CrapViolation[] }
  | { checked: false };

const EXT_TS_RE = /^extension\/.*\.ts$/;

type CrapFunction = {
  name: string;
  complexity: number;
  startLine: number;
  endLine: number;
};

type CrapLib = {
  computeCrap: (complexity: number, coverage: number) => number;
  isFlagged: (crap: number, threshold: number) => boolean;
  extractFunctions: (sourceFile: unknown) => CrapFunction[];
  parseSource: (absFile: string, sourceText: string) => unknown;
  statementCoverageFraction: (
    fileCoverage: unknown,
    startLine: number,
    endLine: number,
    nestedRanges: unknown
  ) => number;
  nestedRangesOf: (fn: CrapFunction, functions: CrapFunction[]) => unknown;
};

export function isExtensionTsPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return EXT_TS_RE.test(normalized) && !normalized.endsWith('.d.ts');
}

function loadCrapLib(extensionDir: string): CrapLib {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(extensionDir, 'scripts', 'crapLib'));
}

function defaultCoveragePath(extensionDir: string): string {
  return path.join(extensionDir, 'coverage', 'coverage-final.json');
}

function violationsForFile(
  absFile: string,
  repoRoot: string,
  coverage: Record<string, unknown>,
  crapLib: CrapLib
): CrapViolation[] {
  const sourceText = fs.readFileSync(absFile, 'utf8');
  const sourceFile = crapLib.parseSource(absFile, sourceText);
  const fileCoverage = coverage[absFile];
  const functions = crapLib.extractFunctions(sourceFile);
  const repoRelative = path.relative(repoRoot, absFile).replace(/\\/g, '/');
  const violations: CrapViolation[] = [];
  for (const fn of functions) {
    const cov = crapLib.statementCoverageFraction(
      fileCoverage,
      fn.startLine,
      fn.endLine,
      crapLib.nestedRangesOf(fn, functions)
    );
    const crap = crapLib.computeCrap(fn.complexity, cov);
    if (crapLib.isFlagged(crap, PILOT_CRAP_THRESHOLD)) {
      violations.push({ file: repoRelative, function: fn.name, crap });
    }
  }
  return violations;
}

/**
 * Run scoped CRAP against touched extension/*.ts paths. `mutation_cost: low`
 * never skips this check — callers must not gate invocation on mutation cost.
 */
export function assessPilotScopedCrap(
  repoRoot: string,
  touchedRelativePaths: string[],
  coveragePath?: string
): PilotScopedCrapCheckOutcome {
  const extensionDir = path.join(repoRoot, 'extension');
  const targets = touchedRelativePaths
    .filter(isExtensionTsPath)
    .map((rel) => path.join(repoRoot, rel))
    .filter((abs) => fs.existsSync(abs));
  if (targets.length === 0) {
    return { checked: true, tsFilesScanned: 0, violations: [] };
  }
  const covPath = coveragePath ?? defaultCoveragePath(extensionDir);
  if (!fs.existsSync(covPath)) {
    return { checked: false };
  }
  const coverage = JSON.parse(fs.readFileSync(covPath, 'utf8')) as Record<string, unknown>;
  const crapLib = loadCrapLib(extensionDir);
  const violations = targets.flatMap((abs) => violationsForFile(abs, repoRoot, coverage, crapLib));
  return { checked: true, tsFilesScanned: targets.length, violations };
}
