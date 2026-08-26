/**
 * BL-755: pure multi-branch parser coverage check for /pilot land. A
 * run-touched function whose body is a cond/case/if-else chain with ≥3 arms
 * must have a distinct exercising test per arm — else refuse as
 * untested-parser-branch (never silently praised for covering only the
 * narrated hazard). IO stays in commitClaimGitReader / pilot-acceptance-gate.
 */

export const UNTESTED_PARSER_BRANCH_REFUSAL =
  'multi-branch parser has an arm with no distinct exercising test';

export const MIN_PARSER_ARMS = 3;

export type ParserArm = {
  label: string;
  marker: string;
};

export type MultiBranchParser = {
  functionName: string;
  sourcePath: string;
  arms: ParserArm[];
};

export type UntestedParserBranchMiss = {
  functionName: string;
  sourcePath: string;
  armLabel: string;
};

export type MultiBranchParserCoverageOutcome =
  | {
      checked: true;
      parsersScanned: number;
      miss?: UntestedParserBranchMiss;
    }
  | { checked: false };

export function armExercisedByTests(arm: ParserArm, testTexts: string[]): boolean {
  return testTexts.some((text) => text.includes(arm.marker));
}

/**
 * Extract ≥3-arm parsers from Clojure/Babashka source: (defn name … (cond …)).
 * Arm markers are string/keyword literals appearing in each clause head or body.
 */
export function extractCondParsers(source: string, sourcePath: string): MultiBranchParser[] {
  const parsers: MultiBranchParser[] = [];
  const defnRe = /\(defn\s+([A-Za-z0-9_!?*-]+)/g;
  let defnMatch: RegExpExecArray | null;
  while ((defnMatch = defnRe.exec(source)) !== null) {
    const functionName = defnMatch[1];
    const from = defnMatch.index;
    const nextDef = source.slice(from + 1).search(/\(defn\s+/);
    const body = nextDef === -1 ? source.slice(from) : source.slice(from, from + 1 + nextDef);
    const condIdx = body.search(/\(cond\b/);
    if (condIdx < 0) {
      continue;
    }
    const arms = extractCondArms(body.slice(condIdx));
    if (arms.length >= MIN_PARSER_ARMS) {
      parsers.push({ functionName, sourcePath, arms });
    }
  }
  return parsers;
}

function extractCondArms(condBody: string): ParserArm[] {
  const arms: ParserArm[] = [];
  const slice = condBody.slice(0, 800);
  const stringLits = [...slice.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const lit of stringLits) {
    if (!arms.some((a) => a.marker === lit)) {
      arms.push({ label: lit, marker: lit });
    }
  }
  return arms;
}

/**
 * Extract ≥3-arm if/else-if/else or switch parsers from TS/JS source.
 * Markers are string literals returned or compared in each arm.
 */
export function extractTsMultiArmParsers(source: string, sourcePath: string): MultiBranchParser[] {
  const parsers: MultiBranchParser[] = [];
  const fnRe =
    /(?:function\s+([A-Za-z0-9_]+)|(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\()/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRe.exec(source)) !== null) {
    const functionName = fnMatch[1] || fnMatch[2] || fnMatch[3];
    if (!functionName) {
      continue;
    }
    const from = fnMatch.index;
    const brace = source.indexOf('{', from);
    if (brace < 0) {
      continue;
    }
    const body = sliceBalancedBlock(source, brace);
    const arms = extractTsArms(body);
    if (arms.length >= MIN_PARSER_ARMS) {
      parsers.push({ functionName, sourcePath, arms });
    }
  }
  return parsers;
}

function sliceBalancedBlock(source: string, openBrace: number): string {
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace, i + 1);
      }
    }
  }
  return source.slice(openBrace);
}

function extractTsArms(body: string): ParserArm[] {
  const returnLits = [...body.matchAll(/return\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
  const caseLits = [...body.matchAll(/case\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
  const startsWithLits = [...body.matchAll(/startsWith\(\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
  const combined = [...new Set([...returnLits, ...caseLits, ...startsWithLits])];
  return combined.map((lit) => ({ label: lit, marker: lit }));
}

export function extractMultiBranchParsers(
  files: Array<{ path: string; text: string }>
): MultiBranchParser[] {
  const out: MultiBranchParser[] = [];
  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/');
    if (/\.bb$/.test(normalized) || /\.clj$/.test(normalized)) {
      out.push(...extractCondParsers(file.text, normalized));
    } else if (/\.(ts|js|mjs|cjs)$/.test(normalized)) {
      out.push(...extractTsMultiArmParsers(file.text, normalized));
    }
  }
  return out;
}

export function assessMultiBranchParserCoverage(input: {
  parsers: MultiBranchParser[] | undefined;
  testTexts: string[] | undefined;
}): MultiBranchParserCoverageOutcome {
  if (input.parsers === undefined || input.testTexts === undefined) {
    return { checked: false };
  }
  const parsers = input.parsers.filter((p) => p.arms.length >= MIN_PARSER_ARMS);
  if (parsers.length === 0) {
    return { checked: true, parsersScanned: 0 };
  }
  for (const parser of parsers) {
    for (const arm of parser.arms) {
      if (!armExercisedByTests(arm, input.testTexts)) {
        return {
          checked: true,
          parsersScanned: parsers.length,
          miss: {
            functionName: parser.functionName,
            sourcePath: parser.sourcePath,
            armLabel: arm.label,
          },
        };
      }
    }
  }
  return { checked: true, parsersScanned: parsers.length };
}
