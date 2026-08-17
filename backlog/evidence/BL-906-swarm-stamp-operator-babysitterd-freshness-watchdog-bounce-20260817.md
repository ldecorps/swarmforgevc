# BL-906 — architect bounce — 2026-08-17

## Scope reviewed

First architect pass (no prior `bounce_history`). Parcel received from
cleaner via `merge_and_process cleaner b2680ee752`, reviewing coder's
`678fcb3889` (stamp-off review: activates acceptance for the pre-existing
WIP commit `d7b986e8f`, fixes two process-leak defects in the test suite)
on top of the kept-as-is `d7b986e8f` (Operator tell-don't-restart watchdog,
adopt-not-spawn, process-truth status reporting).

## Complete review inventory (Article 4.4 — one bounce, everything run)

- Dependency-rule gate (BL-259, hard gate):
  `node extension/out/tools/dependency-gate.js
  specs/pipeline/steps/bl906OperatorBabysitterdFreshnessWatchdogSteps.js
  specs/pipeline/steps/index.js` — PASSED, no forbidden edges. (A full-repo
  scan surfaces 3 pre-existing `acyclic` violations among
  `telegram-front-desk-bot.ts`/`telegramCursorOperator*.ts` — untouched by
  this parcel, same pre-existing condition every recent architect pass has
  logged as unrelated/not-blocking, e.g. BL-908's 2026-08-17 pass.)
- Co-change coupling (BL-255): scoped to this parcel's own new/changed
  files, the only pairing above the default threshold is
  `start_babysitterd.sh` <-> its own `test_babysitterd_lifecycle.sh` (3
  co-changes) — expected. Including the two pre-existing hub files
  (`operator_runtime.bb`, `swarm_status.bb`) in the query floods the report
  with hundreds of unrelated entries, the same hub-file effect prior
  passes have already characterized for `briefing_email_lib.bb` /
  `handoffd.bb`; not evidence of new coupling.
- Invariant 1 (grep-checkable half): `grep -n start_babysitterd
  swarmforge/scripts/operator_runtime.bb` — only comment lines, no call
  site. PASS.
- `status.json`'s `babysitterd_watchdog` field: present, `operator_runtime.bb:2358`.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-906-operator-babysitterd-freshness-watchdog.feature` —
  independently re-run, 10/10 PASS.
- `bb swarmforge/scripts/test/babysitterd_freshness_lib_test_runner.bb` — PASS.
- `bash swarmforge/scripts/test/test_babysitterd_lifecycle.sh` — independently
  re-run, PASS including test 04 (EXIT trap only unlinks the pidfile when it
  still names this daemon's pid).
- `bash swarmforge/scripts/test/test_daemon_log_freshness.sh` — PASS.
- `bash swarmforge/scripts/test/test_operator_runtime_babysitterd_watchdog.sh` —
  independently re-run, PASS, confirmed the coder's process-leak fix (each
  `start_fake_daemon` caller now registers its own pid into `LIVE_PIDS`
  directly, not inside the `$(...)` subshell).
- `bash swarmforge/scripts/test/test_swarm_ensure.sh` — independently
  re-run (background, ~9 min — this suite is large: RC-1..RC-13, 05a..05i,
  07a..07f), ALL PASS, exit 0.
- No orphaned processes after any of the above: checked
  `pgrep -fl 'babysitterd.sh|start_babysitterd'` and `ps aux | grep 'sleep
  100\|sleep 300'` before and after each run; the only `sleep 300` seen was
  confirmed a child of the live swarm's own real babysitterd (pid 2367),
  not a test leak.
- Hardening-gate degraded-fallback record (Babashka has no mutation/CRAP/DRY
  wired): not yet applicable at this stage — noting for the hardener that
  the ticket's own `qa_e2e_procedure` step 7 requires this to be recorded
  explicitly when hardening runs.

All of the above: PASS. One item fails.

## D1 (invariant-unencoded, coder-owned) — none of the 3 declared invariants has a property test or a stated non-encodability reason

1. **Failing command:**
   `grep -rl 'babysitterd-freshness-lib\|babysitterd_freshness_lib'
   swarmforge/scripts/test/*.bb` and
   `find extension/test -iname '*babysitterd*property*'` — the only match
   is `babysitterd_freshness_lib_test_runner.bb`, which is entirely
   example-based (no seeded/randomized generator; confirmed by inspection —
   124 lines, fixed literal inputs throughout). No property runner exists
   for `babysitterd_freshness_lib.bb` at all. (The similarly-named
   `babysitterd_sweep_lib_property_runner.bb` tests a DIFFERENT lib —
   `babysitterd_sweep_lib.bb`, the agent-pane sweep — not this ticket's
   `babysitterd_freshness_lib.bb`.)
2. **Commit hash:** `678fcb3889` (coder's stamp-off review commit; the gap
   is present in the kept-as-is `d7b986e8f` too, but this parcel is the
   first pipeline review of either).
3. **First error excerpt (the gap, not a stack trace):** the ticket
   declares three invariants:
   - *"The Operator runtime never starts, restarts, or spawns a babysitterd
     process on any code path..."*
   - *"A pidfile is only ever removed by the process it names..."*
   - *"Every reported state is derived from observed process truth; the
     pidfile is corroborating evidence, never the sole source."*

   The first and third both have a genuinely pure, small-state-space home
   in `babysitterd_freshness_lib.bb`'s `classify`/`resolve-live-pid`
   functions (`enabled?` x `live-pid` presence x `pidfile-alive?` x
   `telegram-creds?` — 16 total combinations) — exactly the shape this
   project already property-tests elsewhere in this same file family (see
   `babysitterd_sweep_lib_property_runner.bb`'s own header, which even
   states an explicit non-encodability carve-out for the one sub-clause of
   an invariant that genuinely is I/O-layer plumbing, per BL-654's own
   precedent). Here, no such property runner and no such stated carve-out
   exists anywhere — not for the two pure-layer invariants, and not even a
   documented reason for the third (the bash EXIT-trap ownership check,
   which may or may not be reasonably property-testable, but silence is
   not the same as a stated reason).

   The closest existing coverage — `babysitterd_freshness_lib_test_runner.bb`
   lines 111-118's `doseq` "classify never returns `:restart`" guard — only
   exercises 4 of the 8 relevant `enabled?=true` input combinations (missing,
   among others, `telegram-creds?` varying while `live-pid` is `nil`), and is
   example-based, not generative.
4. **Failure class:** `invariant-unencoded` (per Invariants Review — a
   missing property test with no stated non-encodability reason is itself
   the defect; distinct from `behavior`, since no violation of the
   invariants was found by hand-verification, only their missing test
   coverage).
5. **Expected vs observed:** Expected — each declared invariant either
   carries a non-vacuous property test, or the parcel states why it cannot
   be executably encoded (the established pattern in this file's own
   sibling property runner). Observed — neither exists for any of the
   three.

## Remediation (coder)

- Add a hand-rolled seeded-generator property runner for
  `babysitterd_freshness_lib.bb` (matching this repo's established Babashka
  property-test idiom, e.g. `babysitterd_freshness_lib_property_runner.bb`),
  covering at minimum:
  - `classify` never returns `{:action :restart, ...}` for any generated
    `{:enabled? :live-pid :pidfile-alive? :telegram-creds?}` combination
    (invariant 1's pure-layer component).
  - State priority (`down` > `pidfile-lie` > `announce-mute` > `healthy`)
    holds across the full generated input space, and every reported state
    is a function of `live-pid`/`pidfile-alive?` only — never dependent on
    anything not in the observed-process-truth inputs (invariant 3).
- For invariant 2 (the bash EXIT-trap's pidfile-ownership check): either
  extract a pure predicate and property-test it, or state explicitly, in
  the property runner's own header (mirroring
  `babysitterd_sweep_lib_property_runner.bb`'s P4/P5 carve-out language),
  why this invariant's OS-process-level portion has no pure-function form
  to property-test here and remains covered by the existing shell
  regression test instead.
- Non-vacuous: break-then-fix proof for whichever properties are added
  (e.g. temporarily make `classify` return `:restart` for one case, confirm
  the property fails, then restore) — same discipline as this ticket's own
  `test_operator_runtime_babysitterd_watchdog.sh` fixes and BL-815's
  `bl815EvidenceClassificationComplete.property.test.js` sibling parcel
  reviewed today.

By architect.
