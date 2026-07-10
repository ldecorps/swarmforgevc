// BL-259: the gate wrapper for the pinned dependency-rule checker
// (dependency-cruiser, see .dependency-cruiser.cjs). Pure over an already-
// captured JSON string - only dependency-gate.ts's CLI touches the real
// tool/process; this module is fed RECORDED checker output in every unit
// test, per the ticket's own TESTABLE-boundary constraint. INFORMS a hard
// gate decision; this module never itself decides to bounce or forward -
// that judgment (and the actual routing action) is the architect's.

export interface DependencyViolation {
  from: string;
  to: string;
  rule: string;
}

export interface DependencyGateResult {
  passed: boolean;
  violations: DependencyViolation[];
}

interface RawDepcruiseViolation {
  from?: string;
  to?: string;
  rule?: { name?: string; severity?: string };
}

// QA bounce (6747a4812d): dependency-cruiser is a pure import/require-EDGE
// analyzer - it structurally cannot see a bare global-identifier
// reference like `localStorage.setItem(...)`, which has no import
// statement at all. The wrapper-package-import check
// (.dependency-cruiser.cjs's own no-webview-storage rule, matching
// idb/localforage/dexie/store2/lockr - none installed, by design) can
// therefore only ever catch an essentially impossible-today scenario, not
// the realistic violation. This supplementary check scans FILE TEXT
// directly and reports under the SAME rule name, so the architect's
// bounce note stays consistent regardless of which mechanism caught it.
// Word-boundary match so e.g. `myLocalStorageHelper` never false-positives.
const STORAGE_GLOBAL_PATTERN = /\b(localStorage|sessionStorage)\b/;

// Architect bounce (BL-259, 20260710): scanning RAW file text (as above)
// also matched a `//` or `/* */` comment merely discussing localStorage/
// sessionStorage (e.g. explaining why the code avoids it), failing the
// gate over prose, not code. Strips comments first - block comments
// (including multi-line) then line comments - so only genuine code
// survives to the identifier match. Not a full tokenizer (a `//`/`/*`
// inside a string literal is not distinguished), a deliberate limit
// matching this check's own "small supplementary scan" scope - the
// realistic content of media/*.js webview scripts does not lean on such
// tricks, and the primary defense (dependency-cruiser's import-graph
// analysis) is unaffected either way.
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function scanTextForStorageGlobal(filePath: string, content: string): DependencyViolation | null {
  const match = stripComments(content).match(STORAGE_GLOBAL_PATTERN);
  return match ? { from: filePath, to: match[1], rule: 'no-webview-storage' } : null;
}

// Combines dependency-cruiser's own (import-graph) violations with the
// supplementary (file-text) scan's findings into one deterministic result -
// a caller never has to reason about which mechanism found what.
export function mergeDependencyGateResults(
  depcruiseResult: DependencyGateResult,
  supplementaryViolations: DependencyViolation[]
): DependencyGateResult {
  const violations = sortViolations([...depcruiseResult.violations, ...supplementaryViolations]);
  return { passed: violations.length === 0, violations };
}

// Deterministic: sorted by from, then to, then rule - regardless of
// whatever order the underlying tool's own JSON happened to list them in,
// so two runs over identical input always report violations in the same
// order (deterministic-report-04).
function sortViolations(violations: DependencyViolation[]): DependencyViolation[] {
  return [...violations].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.rule.localeCompare(b.rule)
  );
}

// Only "error"-severity entries are a hard fail - a future "warn"-severity
// rule (not used by this ticket's own ruleset, but a real dependency-
// cruiser severity level) would surface in the report without failing the
// gate.
export function parseDependencyCruiserOutput(rawJson: string): DependencyGateResult {
  const parsed = JSON.parse(rawJson);
  const rawViolations: RawDepcruiseViolation[] = parsed?.summary?.violations ?? [];
  const violations = rawViolations
    .filter((v) => v.rule?.severity === 'error' && v.from && v.to && v.rule?.name)
    .map((v) => ({ from: v.from as string, to: v.to as string, rule: v.rule!.name as string }));
  return { passed: violations.length === 0, violations: sortViolations(violations) };
}

// The architect's bounce note: names every offending edge (source -> target)
// and the rule it breaks, one line per violation - precise and reproducible
// (the ticket's own "the bounce note is precise and reproducible" wording).
export function formatBounceNote(violations: DependencyViolation[]): string {
  const lines = violations.map((v) => `  ${v.from} -> ${v.to} violates "${v.rule}"`);
  return ['Dependency-rule gate FAILED:', ...lines].join('\n');
}

export interface GateOutcome {
  text: string;
  exitCode: 0 | 1;
}

// Hardener split (dependency-gate.ts's main() only ever gets exercised
// end-to-end against the REAL repo, never an isolated fixture - its own
// runDependencyCruiser hardcodes cwd=EXTENSION_ROOT so a subprocess test
// pointed at a fixture can't reach main()'s fail branch at all). Pulling
// the pass/fail -> printed-text/exit-code decision out into this pure
// function makes BOTH branches directly unit-testable in-process, with no
// subprocess or fixture involved - main() itself becomes a thin dispatcher.
export function renderGateOutcome(result: DependencyGateResult): GateOutcome {
  if (result.passed) {
    return { text: 'Dependency-rule gate PASSED: no forbidden edges.', exitCode: 0 };
  }
  return { text: formatBounceNote(result.violations), exitCode: 1 };
}
