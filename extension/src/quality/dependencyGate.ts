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
