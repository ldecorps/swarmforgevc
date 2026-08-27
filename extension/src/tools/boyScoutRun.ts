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
 * Three invariants govern the state machine in `./boyScoutRun/run`, and the
 * order of the checks there is how two of them are made true by construction:
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
 *   - `./boyScoutRun/run` stays the state machine and keeps importing
 *     `../boyScoutScan` BY NAME. A second, private ranking is the failure this
 *     import exists to prevent, and BL-1015's `required_wiring` entry 1 pins
 *     that import to this path.
 *   - `required_wiring` resolves a LITERAL file path against the sender's
 *     checkout, so moving this file breaks an entry that was correct when
 *     written. BL-1014 hit exactly that: the fix is a spec-gap `note` to the
 *     specifier re-pointing the entry, not a bounce and not a silent edit.
 * The default `RunEnvironment` (real-disk IO, proposal-file parsing) lives in
 * `./boyScoutRun/environment`, the state machine in `./boyScoutRun/run`, and
 * the CLI wrapper in `./boyScoutRun/cli` — both `main` and this barrel import
 * `boyScoutRun` from `./boyScoutRun/run` so there is one state machine, not a
 * second copy of it.
 *
 * BL-1015 D2 (architect send-back #1): `run.ts` exists specifically so this
 * barrel and `./boyScoutRun/cli` do not import each other. `cli.ts` used to
 * import `boyScoutRun` from this file while this file dynamically
 * `require()`s `./boyScoutRun/cli` for the block below — dependency-cruiser's
 * acyclic rule counts a resolved `require()` the same as a static import, so
 * that pair was a real cycle. Both sides now depend inward on `./run`.
 */

export { assertionLines, assertionsWouldChange, isTestPath, TEST_PATH_PATTERNS, ASSERTION_PATTERNS } from './boyScoutRun/assertionGuard';
export { buildCommitMessage, commitEdits } from './boyScoutRun/commit';
export { defaultEnvironment, readProposalFile } from './boyScoutRun/environment';
export { DEFAULT_GATE_COMMANDS, defaultGateSpawn, runDeclaredGates } from './boyScoutRun/gates';
export { countChangedLines, exceedsEnvelope, measureProposal, normalizeEdits } from './boyScoutRun/measure';
export { renderRunReport } from './boyScoutRun/report';
export { boyScoutRun } from './boyScoutRun/run';
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

// ── CLI ───────────────────────────────────────────────────────────────────
// `main` lives in `./boyScoutRun/cli` (not re-exported from here - see the
// file doc comment above for why) so this file's own mutation-site count
// stays about re-export wiring, not the argv/stdout wrapper.

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  process.exitCode = require('./boyScoutRun/cli').main();
}
