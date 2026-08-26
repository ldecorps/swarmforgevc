/**
 * BL-753: pure unreachable step-handler check for /pilot land. When the run
 * touches specs/pipeline/steps/*.js paired with the ticket's acceptance
 * feature, every registered regex (define / defineScoped / scoped helper)
 * must match at least one rendered feature step — else refuse as an
 * untested-behavior flag, never a cosmetic dead-code nit.
 * IO (git, feature parse) stays in commitClaimGitReader / pilot-acceptance-gate.
 */

export const UNREACHABLE_STEP_HANDLER_REFUSAL =
  'touched step file registers a pattern that matches no rendered acceptance step';

export const STEP_HANDLER_PATH_RE = /^specs\/pipeline\/steps\/[^/]+\.js$/;

export type UnreachableStepHandlerMiss = {
  pattern: string;
  stepFilePath: string;
};

export type UnreachableStepHandlerCheckOutcome =
  | {
      checked: true;
      stepFilesScanned: number;
      patternsChecked: number;
      miss?: UnreachableStepHandlerMiss;
    }
  | { checked: false };

export type FeatureStepIr = {
  name?: string;
  background?: Array<{ text: string }>;
  scenarios: Array<{
    steps: Array<{ text: string }>;
    examples?: Array<Record<string, string>>;
  }>;
};

export function isStepHandlerPath(relativePath: string): boolean {
  return STEP_HANDLER_PATH_RE.test(relativePath.replace(/\\/g, '/'));
}

/** Step file is paired when FEATURE constant matches, or basename cites the ticket. */
export function isPairedStepFile(
  relativePath: string,
  stepFileText: string,
  featureName: string | undefined,
  ticketId: string | undefined
): boolean {
  if (ticketId) {
    const base = relativePath.replace(/\\/g, '/').split('/').pop() || '';
    const compact = ticketId.replace(/-/g, '[-_]?');
    if (new RegExp(compact, 'i').test(base)) {
      return true;
    }
  }
  if (!featureName) {
    return false;
  }
  const featureConst = stepFileText.match(/\b(?:const|let|var)\s+FEATURE\s*=\s*['"]([^'"]+)['"]/);
  return featureConst !== null && featureConst[1] === featureName;
}

/** Same substitution as specs/pipeline/runtime.js (BL-259 multi-word placeholders). */
export function substituteExample(text: string, exampleRow?: Record<string, string>): string {
  if (!exampleRow) {
    return text;
  }
  return text.replace(/<([^<>]+)>/g, (whole, name) => (name in exampleRow ? exampleRow[name] : whole));
}

export function renderFeatureStepTexts(feature: FeatureStepIr): string[] {
  const background = feature.background || [];
  const out: string[] = [];
  for (const scenario of feature.scenarios) {
    const rows =
      scenario.examples && scenario.examples.length > 0 ? scenario.examples : [undefined];
    for (const row of rows) {
      for (const step of [...background, ...scenario.steps]) {
        out.push(substituteExample(step.text, row));
      }
    }
  }
  return out;
}

/**
 * Regex literals passed to registry.define / defineScoped, or to a scoped(...)
 * helper whose second argument is the pattern.
 */
export function extractRegisteredPatternSources(stepFileText: string): string[] {
  const found: string[] = [];
  const re =
    /(?:\b(?:defineScoped|define)\s*\(|\bscoped\s*\(\s*[\w.$]+\s*,)\s*(\/(?:\\.|[^/\n])+\/[gimsuy]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stepFileText)) !== null) {
    found.push(match[1]);
  }
  return found;
}

function compilePatternLiteral(literal: string): RegExp | undefined {
  const bodyMatch = literal.match(/^\/((?:\\.|[^/])+)\/([gimsuy]*)$/);
  if (!bodyMatch) {
    return undefined;
  }
  try {
    return new RegExp(bodyMatch[1], bodyMatch[2]);
  } catch {
    return undefined;
  }
}

function patternMatchesAnyStep(literal: string, steps: string[]): boolean {
  const re = compilePatternLiteral(literal);
  if (!re) {
    return true; // unparsable literal: fail open for that pattern
  }
  return steps.some((step) => re.test(step));
}

export function assessUnreachableStepHandlers(input: {
  feature: FeatureStepIr | undefined;
  stepFiles: Array<{ path: string; text: string }> | undefined;
  ticketId?: string;
}): UnreachableStepHandlerCheckOutcome {
  if (input.feature === undefined || input.stepFiles === undefined) {
    return { checked: false };
  }
  const featureName = input.feature.name;
  const stepFiles = input.stepFiles.filter(
    (f) =>
      isStepHandlerPath(f.path) &&
      isPairedStepFile(f.path, f.text, featureName, input.ticketId)
  );
  if (stepFiles.length === 0) {
    return { checked: true, stepFilesScanned: 0, patternsChecked: 0 };
  }
  const rendered = renderFeatureStepTexts(input.feature);
  let patternsChecked = 0;
  for (const file of stepFiles) {
    const patterns = extractRegisteredPatternSources(file.text);
    for (const pattern of patterns) {
      patternsChecked += 1;
      if (!patternMatchesAnyStep(pattern, rendered)) {
        return {
          checked: true,
          stepFilesScanned: stepFiles.length,
          patternsChecked,
          miss: { pattern, stepFilePath: file.path },
        };
      }
    }
  }
  return {
    checked: true,
    stepFilesScanned: stepFiles.length,
    patternsChecked,
  };
}
