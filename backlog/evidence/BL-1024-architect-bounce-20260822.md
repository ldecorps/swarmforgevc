# BL-1024 — architect SEND BACK: three early-exit paths inside `expedite_cli.bb` leave a parked ticket staged with NO closing summary, reproducing the exact defect this ticket exists to fix

**Parcel:** coder commit `6203b15da` (cleaner `254d962503` forwards it
unchanged), merged into architect at `94f4fd8ff`.

**Verdict:** SEND BACK to coder.

## Review completed first (Article 4.4 — full inventory before bouncing)

- **Dependency-rule hard gate (BL-259):** N/A — zero files this parcel
  touches live under `extension/`. Confirmed via full-repo scan
  (`node extension/out/tools/dependency-gate.js`, no args): only the
  pre-existing BL-759 `telegram-front-desk-bot.ts` cycle, unrelated to this
  parcel. CLEAN.
- **Co-change coupling (BL-255):** ran
  `node extension/out/tools/co-change-report.js` over the 8 changed files.
  All "SUSPECTED COUPLING" hits are expected pairs (`expedite_lib.bb` ↔
  `expedite_cli.bb` ↔ `expedite_lib_test_runner.bb`, plus the always-noisy
  `specs/pipeline/steps/index.js`) — **with one notable exception that
  corroborates the defect below**: `expedite_cli.bb` historically co-changes
  with `swarmforge/scripts/test/test_expedite_cli.sh` (3 co-changes) — the
  ONE test file that actually exercises `expedite_cli.bb`'s real control
  flow end to end (`-main`, `initiate!`, the early-`System/exit` refusal
  paths). This parcel touched `expedite_cli.bb`'s control flow (adding the
  `outstanding`/summary call site) but did not touch
  `test_expedite_cli.sh` — consistent with the gap found below: the new
  logic was verified only at the pure-function level, never through the
  actual CLI wiring where the gap lives.
- **Declared invariant (1):** "An expedited run never ends reporting success
  while leaving backlog or index state that its own closing summary does not
  name." Re-verified live in this worktree:
  - `bb swarmforge/scripts/test/bl1024_outstanding_summary_property_runner.bb`
    → 400 runs, `ALL PROPERTIES HOLD`.
  - `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` → `ALL PASS`.
  - Acceptance `specs/features/BL-1024-an-expedite-run-names-what-it-leaves-behind.feature`
    → 7/7.
  - BL-1025 regression suites (shared files) also re-verified green:
    `test_expedite_qa_verdict_store.sh`, BL-1025 acceptance 6/6, BL-952
    acceptance 10/10.
  All green — **but every one of these drives `expedite_lib.bb`'s pure
  `outstanding-work`/`format-outstanding-summary` pair directly (via a `bb`
  subprocess), or the property runner's own synthetic generator. None of
  them drives `expedite_cli.bb`'s actual `-main` control flow.** The
  acceptance step handlers say so themselves (their own header comment):
  "Driving the pure pair rather than a whole expedite run is deliberate...
  The end-to-end half... is qa_e2e_procedure steps 2 and 3" — which covers
  only a *failed restart*, a *stage bounce*, and a *stage timeout*, per the
  feature file's Scenario Outline 05. Nothing in this parcel's test suite
  drives the CLI's own pre-flight refusal paths end to end.

## Defect — `expedite_cli.bb`'s pre-flight refusals bypass the whole outstanding-summary mechanism, exactly reproducing the 2026-08-21 incident

`park-others!` (called first inside `initiate!`) stages real `git mv` moves
for every sibling active ticket **before** any of the following three
checks run, and every one of them calls `(System/exit ...)` directly —
terminating the process before `-main`'s own `let` chain ever reaches the
new `outstanding-work` / `format-outstanding-summary` / `write-json!`
lines (all of which live in `-main`'s single `let` block, reached only
after `init`, `worktree`, `stages`, and `staged` are ALL successfully
bound):

1. `stop-stack!` (`expedite_cli.bb:265-273`) — exits at line 269 if the
   configured stop command carries a forbidden flag. Called from
   `initiate!` at line 298, immediately after `park-others!` (line 297).
2. `initiate!` itself (`expedite_cli.bb:291-323`) — exits at line 315 if
   the teardown verdict is not clean (and neither `--dry-run` nor
   `--override` is set). **Empirically reproduced below.**
3. `ensure-worktree!` (`expedite_cli.bb:327-336`) — exits at line 334 if
   `git worktree add` fails. Called from `-main` at line 508, immediately
   after `initiate!` returns (so strictly after parking too).

All three are legitimate, reachable "unhappy endings" — the ticket's own
"How" section says "It must survive an unhappy ending," not "it must
survive only a stage bounce, a stage timeout, or a failed restart." The
fix wired the summary into the LATER unhappy endings (which all fall
through `-main`'s own `let` chain) but missed these THREE EARLIER ones,
all of which sit strictly between "tickets get parked" and "the summary is
computed."

### Empirical reproduction (not just static reading)

Two active tickets (`BL-567` the run ticket, `BL-590` the sibling), no
`--override`, `--no-restart`, run for real against the project's own
`expedite_fixture.sh` harness:

```
$ EXPEDITE_STAGE_RUNNER=.../stage-runner.sh EXPEDITE_STOP_CMD=./stop-swarm.sh \
    bb expedite_cli.bb <fixture-root> BL-567 --no-restart
expedite liveness {:stopped? false, :alive [...]}
expedite park BL-590 -> backlog/hold/
expedite teardown {:clean? false, :alive [...], :exit-code-lied? true}
expedite REFUSE teardown did not reach a clean slate: ...
$ echo $?
1
$ git status --short <fixture-root>
R  backlog/active/BL-590-fixture.yaml -> backlog/hold/BL-590-fixture.yaml
$ find <fixture-root>/.swarmforge/expedite -type f
.../BL-567/progress.json
.../BL-567/park-record.json
```

**No `run.json` is ever written. No `OUTSTANDING` text appears anywhere in
the output.** `BL-590` is genuinely parked and staged, uncommitted, in the
shared master checkout — and the run's entire channel to the next actor
(its stdout) never says so. This is not a corner case requiring an
adversarial host: on ANY host already running a live swarm (which is every
host this pipeline actually runs on, including this one), teardown will not
reach a clean slate unless `--override` is passed, so this is the common
path, not a rare one.

**Concrete failure scenario:** the exact 2026-08-21 incident, reproduced
by a slightly different trigger. An operator runs an expedite for one
ticket while another sits active. The live swarm's stop command cannot
fully quiesce it (a genuinely common state — this dev host hit it on the
very first unmodified attempt above). `initiate!` refuses and exits 1.
The sibling ticket is parked and staged in `backlog/hold/`, uncommitted,
in the shared master checkout — and NOTHING on the terminal or in
`run.json` says so, because the whole `outstanding-work` mechanism never
ran. `backlog/active/` now has one less ticket than committed `main`
believes, the move sits unowned in the shared checkout, and the pipeline
can idle exactly as it did on 2026-08-21 — until a human happens to notice,
which is the precise failure this ticket exists to eliminate.

## What is NOT the problem (do not over-correct)

- `outstanding-work` and `format-outstanding-summary` themselves are
  correct, well-tested, pure functions — nothing about their own logic
  needs to change.
- The wiring for the LATER endings (stage bounce, stage timeout, failed
  restart) inside `-main`'s own `let` chain is correct and verified live
  by acceptance scenario 05 (7/7) — do not touch that.
- Do not weaken or remove any of the three refusal checks to "fix" this;
  they are correct pre-flight gates. The remediation is to make the
  summary reach the terminal (and `run.json`) BEFORE any of them can
  terminate the process, not to change what they refuse.
- The docs update's own claim ("It prints on every ending, including a
  failed restart") is not itself wrong about the endings it names — it is
  just not yet true for the three endings above. No separate doc bounce;
  fixing the code makes the existing doc text accurate.

## Remediation

Compute `outstanding-work` (and print/persist it) as early as the facts
it depends on exist, rather than only at the tail of `-main`. Concretely,
one of:

1. Compute-and-print the outstanding summary (from whatever `park` plan
   is available at that point) immediately after `park-others!` runs,
   before `stop-stack!`/the teardown gate/`ensure-worktree!` get a chance
   to exit — and print it again (or update it) at the tail as today, so a
   run that proceeds still gets the fuller picture (ticket-moved, etc.).
2. Replace the three `(System/exit ...)` calls in `stop-stack!`,
   `initiate!`, and `ensure-worktree!` with a return value `-main` checks,
   so control always reaches the single tail-end block that already
   computes and prints `outstanding-work` — one exit point instead of four.

Either way, extend `test_expedite_cli.sh` (the only suite that drives this
control flow for real) with a case that parks a sibling ticket AND forces
one of these three refusals, asserting `OUTSTANDING` and the parked
ticket's id appear in the output — the acceptance suite's pure-pair
approach cannot catch this class of gap, so the regression gate belongs in
the CLI-level shell suite.

— By architect.
