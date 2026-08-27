# BL-817 hardener pass — 2026-08-19

## Reviewed commit
`94b34c2b6e` ("BL-817: architect pass - architecture compliant, all
invariants hold"), merged into hardener as `9dd...` (this parcel). Full
parcel diff (`git diff f11454ac0^ 797f89f71`) touches 18 files, unchanged
from the architect's own inventory — no further edits made by cleaner or
architect on top.

## Tooling scope check
No `extension/src/*.ts` file is touched by this parcel (`git diff
f11454ac0^ 797f89f71 --stat -- 'extension/'` shows only 2 files, both
under `extension/test/`, neither `.property.test.js` excluded from that).
Stryker (`--mutate` scoped to compiled `out/**/*.js` from `src/`) and CRAP
(`crapReport.js` scoped to `src/*.ts`) and DRY (`jscpd --config .jscpd.json
src`) are therefore all inapplicable — same situation as BL-938/BL-939
earlier today. The 16 remaining changed files live under `specs/pipeline/`,
`swarmforge/`, and `backlog/`, outside any of those tools' scope.

## Checks run (complete inventory, not first-failure-stop)

1. **Leftover process/fixture check before starting**: found 7 leaked
   `bl647.sock` fixture tmux servers still alive from the architect's own
   live-reproduction check earlier this session (temp-dir sockets, `PPID
   1`, none matching a live `.swarmforge/tmux/*.sock` or
   `operator-tmux.sock` path). Reaped all 7 by socket path (`tmux -S
   <sock> kill-server`), per this role's own discriminator rule — session
   names on all 7 were `swarmforge-coder`/`swarmforge-coordinator`,
   identical to live sessions, so only the socket path was safe to key on.
   Confirmed after: only the 6 legitimate live-swarm/operator sockets
   remain. No `node --test`/`stryker` stragglers found.
2. **Host load / BL-149 cooldown gate**: `uptime` showed load averages
   6.8–9.9 (1-/5-min) on 4 cores, right at/above the 2x-cores busy
   threshold. Ran `mutation_cooldown_gate.bb` against all 11 changed
   production files (the 3 lib files, 7 step-handler files, `index.js`):
   every file reported `DECISION: skip-busy` (`load_avg: 8.11 cores: 4
   busy_threshold: 2.00x`) except `index.js`, which reported
   `skip-cooldown` (age 0.05 days, inside the 3-day window regardless of
   load). **BL-113 Gherkin mutation over the new
   `BL-817-fixture-tmux-servers-reaped-on-abnormal-scenario-end.feature`
   Outline (scenarios 01 and 02) is deferred to the next quiet pass per
   the gate** — a clean, gate-driven deferral (busy-host reason, not
   cooldown-window ambiguity), consistent with the office-hours mutation
   bypass policy: forwarding now with targeted-test hardening rather than
   stalling the pipeline.
3. **Targeted test verification** (the smallest-slice fallback for this
   session's 120s-capped Bash tool — a full `npm test` run could not
   complete within that cap; see `lesson_bash_tool_timeout_param_capped_around_120s`):
   - `node --test specs/pipeline/test/fixtureReaper.test.js` — **7/7
     pass**, including the pre-existing invariant-2 socket-path guard
     example test (`specs/pipeline/test/` carries no standing gate per
     prior lessons, so run it directly rather than trust it untested).
   - `npx tsc -p .` — clean compile, no errors.
   - `npx vitest run test/tmuxReaperGuard.test.js --no-coverage` —
     **7/7 pass** (the new standing-suite guard test).
   - `npx vitest run --config vitest.properties.config.mjs
     test/fixtureReaperLiveSocketGuard.property.test.js` — **3/3 pass**
     (invariant 2's property test, run via the correct separate property
     lane per engineering.prompt's separation rule).
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-817-fixture-tmux-servers-reaped-on-abnormal-scenario-end.feature`
     — **9/9 PASS**, matching the architect's own run.
   - Post-run leak check: `ps aux | grep 'tmux -S'` showed only the 6
     legitimate live sessions; `git status --short` clean, no stray
     fixtures left behind.
4. **Required wiring (ticket YAML)**: both items confirmed by direct grep,
   not trusted from the commit message —
   `bl647RotationRouterLivenessSteps.js` requires `./lib/fixtureReaper`
   (line 16); `index.js` registers `bl817FixtureTmuxServersReapedSteps`
   (line 499).
5. **Stopgap-bullet removal (ticket item 3)**: grepped the committed
   `swarmforge/roles/hardender.prompt` for `BL-817` and `drop this
   bullet` — zero matches, confirming the stopgap naming this ticket was
   cleanly deleted. (This session's own already-loaded system prompt
   still shows the old text, expected per
   `lesson_composed_role_prompt_is_a_launch_time_build_output` — a
   launch-time build artifact, not a defect in this parcel.)
6. **Guard soundness spot-check (own hardening judgment, beyond the
   architect's item 7)**: read `tmuxReaperGuard.js` in full. Its
   `STARTS_TMUX_SERVER` regex requires a quote character directly
   touching `new-session` on both sides — checked this against every
   real tmux-spawn call site in `specs/pipeline/steps/*.js` (all use
   `execFileSync('tmux', [..., 'new-session', ...])`, matching) and
   against every known false-positive candidate already covered by
   `tmuxReaperGuard.test.js` (the `/lets-talk/new-session` HTTP-path
   strings and the `bl849`/`bl879` simulated-`ps`-output strings) —
   none of those have a quote character directly adjacent to
   `new-session`, so none false-positive. Also checked the 5
   `onAbnormalExit`-only step files the guard's file-level scope must
   correctly ignore (`bl769AndroidPureLogicJvmUnitSeamSteps.js`,
   `bl690EnsureDaemonRepairStartsNotHaltsSteps.js`,
   `frontDeskSurvivesRebootSteps.js`,
   `mergedCodeReachesDaemonsSteps.js`,
   `roleLifecycleParkUnneededSteps.js`) — grepped each for
   `new-session`: zero matches in all five, confirming they never start a
   tmux server and the guard is correct to pass them regardless of
   whether they call `track()`. No false negative found.
7. **Seventh-offender ordering spot-check**: independently re-confirmed
   (not just trusted from the architect's item 6) that
   `bl807BabysitterStuckInProcessOwnerLivenessSteps.js` calls `track(root)`
   inside `ensureState()` (line 207), itself called from the Background
   step, strictly before the file's own `new-session` spawn (line 135) is
   reachable from any later step.
8. **Surfaced defect (BL-944)**: already out of this parcel's scope per
   the architect's item 12 and this session's own coordinator/specifier
   bookkeeping — not re-litigated here.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling (no
`extension/src/*.ts` touched). BL-113 Gherkin mutation deferred per the
BL-149 cooldown gate (host busy at load_avg 8.11 on 4 cores) — a clean,
gate-driven deferral, not a first-failure-stop or a skipped check. All
targeted unit, property, and acceptance verification green; both
required-wiring items and the stopgap-bullet removal independently
confirmed; a small independent soundness check of the new static guard
found no false-positive/false-negative gap. Reaped 7 pre-existing leaked
fixture tmux servers (unrelated to this parcel's own runs, safe by socket
path) before starting.

Forwarding to documenter.

By hardener.
