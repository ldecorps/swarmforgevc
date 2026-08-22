# BL-877 — architect pass, bounce re-entry — 2026-08-11

## Scope reviewed

Parcel received from cleaner (`git_handoff`, task
`BL-877-portable-process-liveness-without-proc`), commit `207c48870`
merged into this worktree — cleaner's merge of coder handoff `b17fb7e3ac`,
which itself sits on top of the hardener's bounce commit `61976261d`
(`swarmforge/scripts/test/test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh`,
new) merged into the coder's branch at `21b844d74`.

This is a re-entry: my own prior pass on this ticket (`729a4e944`,
`backlog/evidence/BL-877-architect-pass-20260811.md`) forwarded clean to
the hardener. The hardener then found and bounced one defect (D1,
`backlog/evidence/BL-877-bounce-20260811.md`); this pass reviews only the
coder's fix for that bounce — `git diff 729a4e944 HEAD`:

- `swarmforge/scripts/fixture_reaper_sweep_lib.bb` (the fix, 25
  insertions / 16 deletions)
- `swarmforge/scripts/test/test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh`
  (hardener's new wiring test, unchanged since the bounce)
- `backlog/evidence/BL-877-bounce-20260811.md` (hardener's evidence, not
  reviewed as code)

The rest of the ticket's scope (the shared `proc_fd_scan_lib.bb`
primitive, `operator_runtime.bb`'s sandbox-sweep consumer, the acceptance
feature/steps) is unchanged since my clean prior pass and not re-reviewed
here.

## D1 fix verification

Hardener's bounce: `default-adapters`' local `(when (nil? pid->paths)
(log! ...))` fired via its own `default-log!` before `:log!` was
overridden by the caller (`operator_runtime.bb`'s `assoc` runs after
`default-adapters` returns), so the liveness-undetermined message never
reached the caller's `runtime.log`. Suggested fix: move the check into
`sweep!`, after `:log!` is resolved from the fully-assoc'd adapters map —
the same pattern `operator_runtime.bb`'s own sandbox-sweep-tick code
already uses (confirmed again this pass: `operator_runtime.bb:822`,
identical shape).

Coder applied exactly that: `default-adapters` now just sets `:pid->paths
(live-process-paths!)` and `:log! default-log!` with no side effect;
`sweep!` gained `(let [... log! (or (:log! adapters) default-log!)] (when
(nil? (:pid->paths adapters)) (log! "...")) ...)`, using the same
already-resolved `log!` every other message in `sweep!` uses. Message
text unchanged, safe-direction behavior unchanged (`pids-rooted-in` still
treats `nil` `:pid->paths` as `{}` via `filter`'s nil-safe behavior).

Checked for regressions the move could introduce:
- Both real call sites (`operator_runtime.bb:1992` and
  `reap_stale_test_fixtures.bb:18`) always populate `:pid->paths` in the
  adapters map they pass (via `default-adapters` or its `assoc`'d
  override) — no caller omits the key, so `(nil? (:pid->paths adapters))`
  never fires on an absent key vs. a genuinely-undetermined `nil`.
- No double-log: `default-adapters` no longer logs anything itself;
  `sweep!` is the sole log site for this message now, matching the
  sandbox-sweep sibling's shape exactly (one determination, one log, at
  the point `:log!` is final).

## Independent re-verification (ran directly, not taken from the coder's or hardener's writeups)

- `test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh` —
  3/3 ok, including the check that failed before this fix (message now
  present in `runtime.log` via the overridden `:log!`).
- `test_operator_runtime_sandbox_sweep_liveness_undetermined.sh`
  (sibling, unaffected by this fix) — 3/3 ok.
- `test_operator_runtime_fixture_reaper_sweep.sh` — 9/9 ok.
- `test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh` — all
  ok, including "the remaining orphaned process is killed too".
- `test_operator_runtime_sandbox_sweep.sh` — 6/6 ok (unaffected sibling,
  confirms no collateral regression).
- `proc_fd_scan_lib_test_runner.bb` — ALL CHECKS PASSED (shared primitive,
  untouched by this fix).
- Full BL-877 acceptance suite
  (`specs/features/BL-877-portable-process-liveness-without-proc.feature`)
  — 7/7 scenarios pass, ~21s.

## Dependency-rule gate (BL-259, hard gate)

This delta touches no JS/TS file (`.bb` and `.sh` only, plus a `.md`
evidence file) — outside dependency-cruiser's graph, same as noted in my
prior pass. Ran `node extension/out/tools/dependency-gate.js` with no
arguments as a full-repo sanity check anyway: it reports a pre-existing
`acyclic` violation among `telegram-front-desk-bot.ts`,
`telegramCursorOperatorExec.ts`, `telegramCursorOperatorLiveness.ts` —
none of which appear anywhere in this ticket's diff (`git diff
729a4e944 HEAD` touches zero telegram files). Pre-existing, out of this
parcel's scope, not this ticket's to fix.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against both changed
files. `fixture_reaper_sweep_lib.bb` reports the same coupling shape as
my prior pass — its real consumer (`operator_runtime.bb`), its own
sibling test files, and same-domain sweep/reaper files. The new test file
co-changes only with its own bounce evidence file (committed together).
No new coupling defect.

## Invariants re-check

This fix is entirely about invariant 1 ("liveness is never silently
assumed absent ... surfaces that") — specifically, that the surfacing
actually reaches the daemon's own log, not just stdout. Confirmed via the
independent test run above: the message now lands in the fixture the test
reads as `runtime.log`. Invariants 2 and 3 are untouched by this delta
(no change to the verdict logic or to the shared-primitive structure) and
were already verified in my prior pass.

## Property testing

No pure JS module in this delta (same Babashka testability-boundary gap
noted in my prior pass). No property test obligation.

## Verdict

Clean. The coder's fix matches the hardener's suggested remediation
exactly, introduces no regression, and the previously-red check now
passes for real (verified independently, not from the writeup).
Forwarding to hardener.

By architect.
