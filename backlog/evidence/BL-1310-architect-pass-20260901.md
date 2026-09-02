# BL-1310 — architect pass (clean)

**Reviewed commit:** `c73f1698d9` (cleaner, "share the real-git ahead-count/reset
adapter pair across the two acceptance drivers")
**By:** architect

## Prior bounce remediation verified (D1/D2)

The prior architect bounce (`backlog/evidence/BL-1310-bounce-20260901.md`,
commit `69058fa141`) found BL-1198's and BL-1288's own acceptance features
still asserting the pre-BL-1310 discard behaviour for a local-ahead commit,
because their drivers wired a raw `:reset!` instead of
`refuse-reset-if-local-ahead!`.

Verified fixed in `e1f93cd2c0` and shared further in `c73f1698d9`:
- `bl1198RematchPushFirstCli.bb` and `bl1288PushFailureClassificationCli.bb`
  both now compose `:reset!` as `(refuse-reset-if-local-ahead!
  (real-git-reset-adapters {...}))` — the identical composition all three
  production call sites use.
- Both `.feature` files were reworded to match (BL-1198 scenario 02 now
  "...is kept after a rejected push"; BL-1288's outcome table row for "the
  remote rejected it" now reads `kept`, not `discarded`).
- `c73f1698d9` additionally de-duplicates the byte-identical
  `:ahead-count!`/`:raw-reset!` adapter pair the two drivers had each copied,
  into `master_main_reconcile_lib.bb`'s new `real-git-reset-adapters` — a
  legitimate cleanup, no behaviour change.

## Dependency / co-change checks (clean)

- No files under `extension/src` are touched by this parcel —
  `dependency-gate.js` has nothing to check.
- `co-change-report.js` against `master_main_reconcile_lib.bb`,
  `handoffd.bb`, and both acceptance-driver CLIs: no co-changers found for
  any of the four (below the frequency-3 threshold).

## Architecture / boundary review

- All I/O (git shell-out) stays in the extension-host-equivalent adapter
  layer (`:sh!`, `:raw-reset!`, `:ahead-count!`); `refuse-reset-if-local-ahead!`
  itself is pure decision logic over injected adapters — same shape as the
  rest of `master_main_reconcile_lib.bb`.
- Single shared implementation, loaded via `load-file` from all three
  production call sites (`handoffd.bb`, `swarm_heal.bb`,
  `post_hotfix_merge_origin.bb`) plus both acceptance drivers — no
  duplicated copies of the refusal or adapter logic remain.
- No new webview/VS Code API/browser-storage surface; not applicable to this
  parcel (pure `.bb`/`.js`/`.feature` reconcile-daemon change).

## Invariants review (both declared, non-vacuous)

Invariant 1 (never reset while local-ahead) and invariant 2 (undeterminable
ahead-count never treated as ahead=0) are each encoded in
`master_main_reconcile_lib_property_runner.bb` — confirmed non-vacuous this
pass: "a mutant that always authorises the reset is flagged (ahead=3 still
reset)" and "invariant 2 would flag a mutant that treats any non-blank value
as truthy" both fired against their respective broken mutants.

## Tests run this pass (all green)

- `specs/features/BL-1310-reconcile-never-discards-a-commit-it-cannot-name.feature`
  — 4/4.
- `specs/features/BL-1198-main-rematch-reset-must-attempt-push-before-discarding-local-ahead-commits.feature`
  — 2/2 (now proves current behaviour, not the removed discard path).
- `specs/features/BL-1288-only-a-rejected-push-authorises-discarding-local-commits.feature`
  — 5/5 (same).
- `swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb` —
  500 runs, all properties hold, all listed mutants correctly flagged.
- `swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` — all
  unit tests pass.
- `swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh` —
  real daemon, real git, real remote: all scenarios pass, including "a
  local-ahead commit colliding with origin refuses the reset and names
  BL-1310" and "an aborted merge conflict leaves no in-progress merge
  state, and BL-1310's refusal leaves the local-ahead commit exactly as it
  was found — never discarded." (Ran long — real daemon poll cadence, not a
  hang; no residual `handoffd.bb` processes or tmp fixture dirs left behind
  after completion.)

## required_wiring anchors (both present)

- `swarmforge/scripts/handoffd.bb:3190-3219` — `refuse-reset-if-local-ahead!`
  wraps the real `:reset!` adapter at the live daemon's sweep call site.
- `specs/pipeline/steps/index.js:917` — `bl1310ReconcileRefusesLocalAheadSteps`
  registered.

## Correctness read

No defect spotted beyond the already-remediated D1/D2. The reset-adapter
sharing in this commit is a straightforward extraction with no behaviour
change (confirmed by the unchanged unit/property/acceptance outcomes).

## Verdict: PASS — forwarding to hardener.
