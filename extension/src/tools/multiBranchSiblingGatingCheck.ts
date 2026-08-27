/**
 * BL-751: pure sibling-branch gating check for /pilot land. A run-touched
 * multi-arm cond/case whose predicate arms share guard tokens must not land
 * when one arm omits a guard that ≥2 siblings share (grace periods, etc.).
 * IO stays in commitClaimGitReader / pilot-acceptance-gate.
 */

export const SIBLING_BRANCH_GATING_ASYMMETRY_REFUSAL =
  'multi-branch dispatch has a sibling-branch gating asymmetry';

export const MIN_GATING_ARMS = 3;

export type CondArmGating = {
  label: string;
  guards: string[];
};

export type MultiBranchGatingDispatch = {
  functionName: string;
  sourcePath: string;
  arms: CondArmGating[];
};

export type SiblingGatingAsymmetryMiss = {
  functionName: string;
  sourcePath: string;
  armLabel: string;
  missingGuard: string;
};

export type MultiBranchSiblingGatingOutcome =
  | {
      checked: true;
      dispatchesScanned: number;
      miss?: SiblingGatingAsymmetryMiss;
    }
  | { checked: false };

export function normalizeGuardToken(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Extract comparable guard tokens from one cond arm's predicate. */
export function extractGuardTokens(condition: string): string[] {
  const trimmed = condition.trim();
  if (!trimmed || trimmed === ':else') {
    return [];
  }
  const tokens = new Set<string>();
  for (const match of trimmed.matchAll(/\b([A-Za-z][\w-]*\?)/g)) {
    tokens.add(match[1]);
  }
  for (const match of trimmed.matchAll(/\((>=|<=|>|<|=|not=)\s+[^()]+\)/g)) {
    tokens.add(normalizeGuardToken(match[0]));
  }
  for (const match of trimmed.matchAll(/\((pos\?|neg\?)\s+[^)]+\)/g)) {
    tokens.add(normalizeGuardToken(match[0]));
  }
  return [...tokens];
}

/** Parse predicate arms from a `(cond …)` body slice. */
export function extractCondGatingArms(condBody: string): CondArmGating[] {
  const arms: CondArmGating[] = [];
  let rest = condBody.replace(/^\(\s*cond\b/, '').trim();
  while (rest.length > 0) {
    rest = rest.trim();
    if (rest.startsWith(':else')) {
      break;
    }
    if (!rest.startsWith('(')) {
      break;
    }
    let depth = 0;
    let end = 0;
    for (let i = 0; i < rest.length; i += 1) {
      const ch = rest[i];
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === 0) {
      break;
    }
    const condition = rest.slice(0, end);
    rest = rest.slice(end).trim();
    const labelMatch = rest.match(/^(:[\w-]+)/);
    if (!labelMatch) {
      break;
    }
    arms.push({
      label: labelMatch[1].slice(1),
      guards: extractGuardTokens(condition),
    });
    rest = rest.slice(labelMatch[1].length).trim();
  }
  return arms;
}

export function extractCondGatingDispatches(source: string, sourcePath: string): MultiBranchGatingDispatch[] {
  const dispatches: MultiBranchGatingDispatch[] = [];
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
    const arms = extractCondGatingArms(body.slice(condIdx));
    const predicateArms = arms.filter((arm) => arm.guards.length > 0);
    if (predicateArms.length >= MIN_GATING_ARMS) {
      dispatches.push({ functionName, sourcePath, arms });
    }
  }
  return dispatches;
}

export function extractMultiBranchGatingDispatches(
  files: Array<{ path: string; text: string }>
): MultiBranchGatingDispatch[] {
  const out: MultiBranchGatingDispatch[] = [];
  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/');
    if (/\.(bb|clj)$/.test(normalized)) {
      out.push(...extractCondGatingDispatches(file.text, normalized));
    }
  }
  return out;
}

function findGatingAsymmetry(dispatch: MultiBranchGatingDispatch): SiblingGatingAsymmetryMiss | undefined {
  const predicateArms = dispatch.arms.filter((arm) => arm.guards.length > 0);
  if (predicateArms.length < MIN_GATING_ARMS) {
    return undefined;
  }
  const guardCounts = new Map<string, number>();
  for (const arm of predicateArms) {
    for (const guard of arm.guards) {
      guardCounts.set(guard, (guardCounts.get(guard) || 0) + 1);
    }
  }
  const sharedGuards = [...guardCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([guard]) => guard);
  for (const arm of predicateArms) {
    for (const shared of sharedGuards) {
      if (arm.guards.includes(shared)) {
        continue;
      }
      const related = predicateArms.some(
        (other) =>
          other !== arm &&
          other.guards.includes(shared) &&
          other.guards.some((guard) => arm.guards.includes(guard))
      );
      if (related) {
        return {
          functionName: dispatch.functionName,
          sourcePath: dispatch.sourcePath,
          armLabel: arm.label,
          missingGuard: shared,
        };
      }
    }
  }
  return undefined;
}

export function assessMultiBranchSiblingGating(input: {
  dispatches: MultiBranchGatingDispatch[] | undefined;
}): MultiBranchSiblingGatingOutcome {
  if (input.dispatches === undefined) {
    return { checked: false };
  }
  const eligible = input.dispatches.filter(
    (dispatch) => dispatch.arms.filter((arm) => arm.guards.length > 0).length >= MIN_GATING_ARMS
  );
  if (eligible.length === 0) {
    return { checked: true, dispatchesScanned: 0 };
  }
  for (const dispatch of eligible) {
    const miss = findGatingAsymmetry(dispatch);
    if (miss) {
      return { checked: true, dispatchesScanned: eligible.length, miss };
    }
  }
  return { checked: true, dispatchesScanned: eligible.length };
}
