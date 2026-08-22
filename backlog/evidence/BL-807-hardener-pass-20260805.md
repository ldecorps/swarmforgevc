# BL-807 — hardener pass (2026-08-05)

Reviewed commit: b96d3942fd (architect's forward, merged fast-forward into
hardener worktree).

## Checklist

- **BL-149 mutation cooldown gate** (both changed production files):
  `mutation_cooldown_gate.bb` reports `DECISION: skip-cooldown` for both
  `swarmforge/scripts/babysitter_check.bb` and
  `swarmforge/scripts/babysitterd_sweep_lib.bb` (file age 0.77 days, inside
  the 3-day cooldown — this ticket's own coder/cleaner/architect commits are
  what set that age). Per the gate's unconditional skip rule, no Stryker-
  equivalent mutation pass runs against these files this pass — deferred to
  a later, quiet, past-cooldown pass. Moot in practice: `.bb` has no wired
  mutation/CRAP/DRY tool at all (BL-472), so this only confirms what was
  already true.
- **Unit suite** (`babysitterd_sweep_lib_test_runner.bb`): `ok`. Covers
  `check-stuck-in-process`'s new `:owner-busy?` gate directly (busy owner
  suppresses; idle owner still warns; mixed busy/idle suppresses only the
  busy one).
- **Property suite** (`babysitterd_sweep_lib_property_runner.bb`): `ok`. P5
  encodes the ticket's declared invariant over arbitrary parcel
  names/ages — the emitted WARN set tracks `:owner-busy?` alone.
- **Shell integration suite** (`test_babysitter_check.sh`, fake tmux/ps): all
  9 cases (A–I) PASS, unchanged by this parcel (it does not exercise the new
  stuck-parcel/owning-role logic — no in_process fixtures — so it is a
  regression guard on the surrounding gatherer, not new coverage here).
- **Coverage-gap assessment — `owning-role-for-path` / `stuck-parcels` /
  the widened glob** (all in `babysitter_check.bb`): no direct babashka
  unit-test coverage exists or is practical — the file executes `(-main)`
  unconditionally at load time, reading `*command-line-args*` for
  `project-root` before any function definition could be exercised in
  isolation, so `load-file`-ing it for a pure unit-test runner (the pattern
  every sibling `*_test_runner.bb` uses) would require either faking argv
  ahead of load or a structural extraction — out of scope per R5 (fix goes
  in `babysitter_check.bb`/`babysitterd_sweep_lib.bb` only). Confirmed
  non-vacuous instead, the same way the architect verified P5's property
  test: ran the required BL-113 soft Gherkin mutation sweep over the
  ticket's two Scenario Outlines (scenario 04, "below threshold", and
  scenario 05, "every mailbox shape") — **22/22 mutants killed, 0
  survivors** (manifest committed into the feature file: scenario 3 index
  2/2 killed, scenario 4 index 20/20 killed). Every mutated `<mailbox>`,
  `<role>`, `<pane-state>`, and `<outcome>` example value is provably
  load-bearing, including the master-vs-worktree mailbox distinction and
  the busy/idle liveness gate — confirming the acceptance layer is a real
  gate for this logic, not decoration.
- **CRAP / DRY**: N/A — no wired tool for `.bb` (BL-472, Startup Tools).
- **Acceptance**: not re-run wholesale this pass (architect already ran all
  11 scenarios green against the real CLI/tmux minutes earlier, and this
  pass touched only the feature file's own mutation-manifest comment block,
  not the scenarios or step handlers); the BL-113 sweep above exercises the
  full generated acceptance path per mutation anyway.
- **Process hygiene**: the BL-113 sweep deliberately makes several mutated
  scenario runs fail before reaching their final `Then` step (that early
  failure is what proves the mutant killed) — `bl807BabysitterStuckInProcessOwnerLivenessSteps.js`'s
  `cleanup(ctx)` only runs as the last statement of a successful scenario
  (no After-hook exists in `specs/pipeline/runtime.js`), so those runs leak
  their fixture tmux server. Found and reaped 5 orphaned `bl807-sock-*` tmux
  servers by hand after the sweep; confirmed clean via `pgrep -fl 'node
  --test|stryker'` and a targeted `ps` scan before handoff. Filed as a
  `rule_proposal` to the specifier (role:hardender scope) so future BL-113
  passes over tmux-fixture step handlers know to scan for this class of
  leak — the same manual-cleanup-only-at-last-step idiom recurs in 6+
  sibling step-handler files repo-wide, so this is not unique to BL-807 and
  not fixed at the source in this parcel.
- **Scope discipline**: no product behavior added; only the feature file's
  mutation-manifest comment block changed (BL-113 tooling output). Left
  `swarmforge/scripts/operator_path_lib.sh` (untracked, pre-existing, unrelated
  to this ticket) unstaged and untouched.

## Verdict

NONE — no test gap found beyond what is already covered or explicitly
deferred by policy (BL-149 cooldown, BL-472 tooling gap). Forwarding to
documenter.

By hardender.
