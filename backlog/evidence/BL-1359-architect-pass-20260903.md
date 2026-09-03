# BL-1359 — architect pass (2026-09-03)

## Verdict

No architectural defect. Forwarding to hardener.

## Two-layer / boundary checks

Not applicable in substance — this parcel touches only `swarmforge/scripts/babysitter_check.bb`
and `babysitterd_sweep_lib.bb` (the pipeline-code-on-main sweep's own git plumbing),
plus its acceptance/property/unit tests. No webview, no VS Code API surface, no
process-spawn-bypassing-tmux, no secrets handling. Integrate-not-fork: unchanged
(operates on this repo's own git history, not SwarmForge upstream source).

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` (full-repo scan, since the parcel's
changed files straddle the `extension/` boundary — `specs/pipeline/steps/*.js`,
`extension/test/*.property.test.js`): **PASSED, no forbidden edges.**

## Co-change tool (BL-255, informational)

Ran against all six changed files. `babysitter_check.bb` <-> `babysitterd_sweep_lib.bb`
(44 co-changes) is the one substantive pairing and it is exactly what this parcel
touches together (the sweep implementation and its restated classifier comment) —
expected, not a new coupling. `specs/pipeline/steps/index.js`'s high co-change count
is the shared-registry-every-ticket-appends-to pattern the ticket itself names, not
a defect. No action.

## Invariants review (BL-633/654)

All three ticket-declared invariants have a non-vacuous property test
(`extension/test/bl1359MergeChargedInvariants.property.test.js`), driving the REAL
`.bb` code against real git fixtures (never a JS restatement of the decision) —
re-ran myself: 3/3 green (`npx vitest run --config vitest.properties.config.mjs
bl1359MergeChargedInvariants` from `extension/`). Reach is by construction
(tookNone/tookAll/tookSome all asserted >0), not by hope. No violation found on
independent re-read of `commit-touched-paths`, `commit-first-parent`, and the new
`(nil? touched) -> ::adjudication-failed` row in `offender-row`.

## Re-verified myself (not just re-reading the coder/cleaner evidence)

- `bb swarmforge/scripts/test/bl1359_merge_charged_test_runner.bb` — ALL PASS.
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1359-a-merge-is-charged-only-with-what-it-introduced.feature` — 7/7.
- `npx vitest run --config vitest.properties.config.mjs bl1359MergeChargedInvariants` (from `extension/`) — 3/3.
- `bash swarmforge/scripts/test/test_babysitter_check.sh` — ALL PASS (regression, unaffected).
- `bb swarmforge/scripts/test/bl962_merge_adjudication_test_runner.bb` — reproduces the
  same single pre-existing FAIL the coder/cleaner named ("no second ancestry predicate").
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-631*.feature` — reproduces
  16/17, same pre-existing gap named by the coder.

## Two pre-existing out-of-parcel reds — grepped, confirmed untracked

Per the architect prompt's grep-before-reporting-untracked rule:

1. `bl962_merge_adjudication_test_runner.bb`'s "no second ancestry predicate" structural
   invariant (a `merge-base` call at `babysitter_check.bb:841`, introduced by BL-1187
   `ec2416a9d6`, a live breach of BL-925 invariant 2). `grep -rl "second ancestry predicate"
   backlog/` and `grep -rl BL-1187 backlog/` (excluding `evidence/`) return only BL-1187's
   own done ticket and evidence files — no ticket for this specific breach.
2. `BL-631` acceptance 16/17 ("the QA-exclusive path set comes from BL-632's single source,
   not a copy"). `grep -rl "single source, not a copy" backlog/` and `grep -rl BL-632
   backlog/` (excluding `evidence/`) return only BL-632/BL-631's own done tickets — no open
   ticket for this gap.

Both are deterministic (reproduced independently, byte-identical to the coder's baseline
claim of "reverting this parcel's files to HEAD, same failure either way") and outside this
parcel's diff — not a bounce. Sending a `note` (priority 00) to specifier + coordinator
naming both, rather than dropping them.

## Structure

Both comments that stated the false `--first-parent` claim are corrected in this same
parcel (`babysitter_check.bb:480-486`-equivalent, `babysitterd_sweep_lib.bb:449-456`),
as the ticket required. `merge-parent-facts`/`adjudicate-merge-paths` unchanged, matching
the ticket's prediction. Property-testing pass (BL-479): no other pure module was touched
by this parcel beyond what BL-1359's own declared-invariant test already covers — no
additional undeclared-property work needed.
