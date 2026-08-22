/**
 * BL-1015 — Boy Scout slice 2: the ACTING half. It takes the top-ranked item
 * from BL-1014's scan, cleans exactly that one inside a declared size
 * envelope, and stops. Anything bigger is refused whole rather than
 * half-applied.
 *
 * Why it consumes BL-1014's ranking rather than deriving one of its own: a
 * second, private ranking would drift from the one the operator was shown, so
 * the two halves would disagree about what "the most annoying debt" is. The
 * run reaches the scan module by name (`./boyScoutScan`) and never ranks.
 *
 * The envelope (3 files, 120 changed lines) is DERIVED, not invented: BL-634
 * recorded a 65-insertion median for a normal slice, and a Boy Scout cleanup
 * should be smaller than a normal slice, not larger. Roughly twice that median
 * is generous enough for a real refactor and small enough to stay one sitting.
 *
 * Three invariants govern everything below, and the order of the checks in
 * `boyScoutRun` is how two of them are made true by construction:
 *
 *   1. BOUNDED AND VERIFIED. At most ONE item, never over the envelope, and
 *      committed only after the repository's existing gate set passes on the
 *      cleaned result. Both the envelope check and the assertion guard run
 *      BEFORE the first write, so an oversized or unsafe cleanup is refused
 *      with the working tree untouched — never partially applied. A gate
 *      failure restores the tree from a snapshot taken at apply time.
 *   2. TESTS ARE NOT THE THING BEING CLEANED. A cleanup whose only route to
 *      green edits an existing test assertion is a behaviour change wearing a
 *      refactor's clothes. The guard (`./boyScoutRun/assertionGuard`) is
 *      deliberately conservative: every assertion line present in a test file
 *      before must still be present after, verbatim, as a multiset.
 *   3. NEVER SILENTLY EMPTY. Every run that cleans nothing carries a reason
 *      from `NO_CLEAN_REASONS`. A quiet no-op is indistinguishable from a
 *      clean repository, and that ambiguity is the failure to prevent.
 *
 * Scope boundary: this ticket adds no gate and weakens none. `runGates` runs
 * the repository's EXISTING commands, declared once in `DEFAULT_GATE_COMMANDS`.
 *
 * Split, BL-485 (this module measured 517 mutation sites against the 100-site
 * threshold, then 224 after policy/IO first moved out): policy and IO moved
 * out into `./boyScoutRun/*`, the same policy/IO seam BL-1014's
 * `boyScoutScan.ts` split used (7 modules, 8274108c3d). Two things that split
 * had to preserve, kept here too:
 *   - `boyScoutRun.ts` stays the entry file and keeps importing
 *     `./boyScoutScan` BY NAME. A second, private ranking is the failure this
 *     import exists to prevent, and BL-1015's `required_wiring` entry 1 pins
 *     that import to this path.
 *   - `required_wiring` resolves a LITERAL file path against the sender's
 *     checkout, so moving this file breaks an entry that was correct when
 *     written. BL-1014 hit exactly that: the fix is a spec-gap `note` to the
 *     specifier re-pointing the entry, not a bounce and not a silent edit.
 * The default `RunEnvironment` (real-disk IO, proposal-file parsing) lives in
 * `./boyScoutRun/environment`, and the CLI wrapper in `./boyScoutRun/cli` —
 * `main` imports `boyScoutRun` from here to keep printing the report of the
 * SAME state machine this file exports, not a second copy of it.
 */

import { normalizeSubject } from './boyScoutScan';

import { assertionsWouldChange } from './boyScoutRun/assertionGuard';
import { buildCommitMessage } from './boyScoutRun/commit';
import { defaultEnvironment } from './boyScoutRun/environment';
import { exceedsEnvelope, measureProposal, normalizeEdits } from './boyScoutRun/measure';
import { SIZE_ENVELOPE } from './boyScoutRun/types';
import type { CurrentContent, GateResult, RunEnvironment, RunResult } from './boyScoutRun/types';

export { assertionLines, assertionsWouldChange, isTestPath, TEST_PATH_PATTERNS, ASSERTION_PATTERNS } from './boyScoutRun/assertionGuard';
export { buildCommitMessage, commitEdits } from './boyScoutRun/commit';
export { main } from './boyScoutRun/cli';
export { defaultEnvironment, readProposalFile } from './boyScoutRun/environment';
export { DEFAULT_GATE_COMMANDS, defaultGateSpawn, runDeclaredGates } from './boyScoutRun/gates';
export { countChangedLines, exceedsEnvelope, measureProposal, normalizeEdits } from './boyScoutRun/measure';
export { renderRunReport } from './boyScoutRun/report';
export {
  NO_CLEAN_REASONS,
  PROPOSAL_PATH,
  SIZE_ENVELOPE,
} from './boyScoutRun/types';
export type {
  CleanupProposal,
  CurrentContent,
  Envelope,
  EnvelopeDimension,
  FileEdit,
  GateCommand,
  GateResult,
  GateSpawn,
  NoCleanReason,
  RunEnvironment,
  RunOutcome,
  RunResult,
  SpawnOutcome,
} from './boyScoutRun/types';

function blank(ranked: number): RunResult {
  return {
    outcome: 'nothing-to-do',
    reason: null,
    subject: null,
    summary: null,
    measured: { files: 0, lines: 0 },
    envelope: { ...SIZE_ENVELOPE },
    exceeded: [],
    editedPaths: [],
    committed: false,
    gate: null,
    ranked,
    detail: null,
  };
}

/**
 * The whole run. The ORDER of the checks is load-bearing, not stylistic:
 * everything that can refuse happens before the first write, so a refused or
 * abandoned cleanup leaves the working tree exactly as it found it
 * (invariant 1, "never partially applied").
 */
export function boyScoutRun(root: string, overrides: Partial<RunEnvironment> = {}): RunResult {
  const env: RunEnvironment = { ...defaultEnvironment, ...overrides };

  const { ranked } = env.scanRepository(root);
  if (ranked.length === 0) {
    return { ...blank(0), reason: 'nothing-ranked' };
  }

  const top = ranked[0];
  const base = { ...blank(ranked.length), subject: top.subject };
  const proposal = env.propose(top, root, env.readFile);
  if (!proposal || proposal.edits.length === 0) {
    return { ...base, reason: 'no-cleanup-proposed' };
  }

  const edits = normalizeEdits(proposal.edits);
  const withProposal = { ...base, summary: proposal.summary, editedPaths: edits.map((e) => e.path) };

  // Invariant 1, "at most ONE item": the run never touches anything other than
  // the top-ranked one, and a proposal that names something else is refused
  // rather than quietly re-pointed at the right item.
  if (normalizeSubject(proposal.subject) !== normalizeSubject(top.subject)) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'wrong-item',
      detail: `the proposal is for ${proposal.subject}, not the top-ranked ${top.subject}`,
    };
  }
  const others = new Set(ranked.slice(1).map((entry) => normalizeSubject(entry.subject)));
  const trespass = edits.filter((edit) => others.has(normalizeSubject(edit.path)));
  if (trespass.length > 0) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'wrong-item',
      detail: `the proposal would also edit other ranked item(s): ${trespass.map((e) => e.path).join(', ')}`,
    };
  }

  const currentOf: CurrentContent = (relPath) => env.readFile(root, relPath);
  const measured = measureProposal(edits, currentOf);
  if (measured.files === 0) {
    // Applying, gating and committing an empty diff would report "cleaned"
    // for a run that changed nothing — invariant 3's exact ambiguity.
    return { ...withProposal, reason: 'no-cleanup-proposed', detail: 'the proposal changes nothing' };
  }

  const exceeded = exceedsEnvelope(measured, SIZE_ENVELOPE);
  if (exceeded.length > 0) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'envelope-exceeded',
      measured,
      exceeded,
      detail: `the cleanup would change ${measured.files} file(s) and ${measured.lines} line(s)`,
    };
  }

  const offending = assertionsWouldChange(edits, currentOf);
  if (offending) {
    return {
      ...withProposal,
      outcome: 'abandoned',
      reason: 'assertion-would-change',
      measured,
      detail: offending.path,
    };
  }

  // From here on the tree is written to, so every exit restores it first.
  const snapshot = new Map<string, string | null>(edits.map((edit) => [edit.path, currentOf(edit.path)]));
  const restore = () => {
    for (const [relPath, content] of snapshot) env.writeFile(root, relPath, content);
  };

  let gate: GateResult;
  try {
    for (const edit of edits) env.writeFile(root, edit.path, edit.after);
    gate = env.runGates(root);
  } catch (err) {
    restore();
    throw err;
  }

  if (!gate.passed) {
    restore();
    return { ...withProposal, outcome: 'abandoned', reason: 'gate-failed', measured, gate };
  }

  const cleaned: RunResult = { ...withProposal, outcome: 'cleaned', reason: null, measured, gate };
  try {
    env.commit(root, buildCommitMessage(cleaned), cleaned.editedPaths);
  } catch (err) {
    restore();
    throw err;
  }
  return { ...cleaned, committed: true };
}

// ── CLI ───────────────────────────────────────────────────────────────────
// `main` lives in `./boyScoutRun/cli` (imported and re-exported above) so
// this file's own mutation-site count stays about the state machine, not the
// argv/stdout wrapper around it.

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  process.exitCode = require('./boyScoutRun/cli').main();
}
