# BL-914 hardener pass — 2026-08-19

## Reviewed commit
`dd754c0014` ("BL-914: architect pass - architecture compliant, both
invariants hold"), merged into hardener as `925...` (this parcel).

## Tooling scope check
No `extension/src/*.ts` file is touched by this parcel (`git diff
d63a9bdcf^ d8b3f11b3f --stat -- 'extension/'` shows only 3 files, all
under `extension/test/`; the new `testTimeoutParser.js` lives under
`specs/pipeline/steps/lib/`, not `extension/src`). Stryker/CRAP/DRY are
therefore all inapplicable — same situation as BL-817 earlier in this
same batch.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: `uptime` load averages 12–15 on
   4 cores (host busier than the BL-817 pass minutes earlier). Ran
   `mutation_cooldown_gate.bb` against all 7 changed files: 6 reported
   `DECISION: skip-busy`, `index.js` reported `skip-cooldown` (age 0.05
   days). No mutation tooling would apply here regardless (no
   `extension/src` touched), so nothing was deferred that would otherwise
   have run.
2. **Targeted test verification** (smallest-slice, per this session's
   120s-capped Bash tool):
   - `npx vitest run test/testTimeoutParser.property.test.js --config
     vitest.properties.config.mjs` — **2/2 pass** (the architect's own
     added property coverage for the one new pure module).
   - `npx vitest run test/dependencyGateCliReportsAndScope.test.js` —
     **2/2 pass**, 20.3s total; the named heavy test itself ran 13.7s,
     inside its new 45000ms budget with real headroom to spare.
   - `npx vitest run test/renderBriefingBurndownCli.test.js` — **5/5
     pass**, 26.2s total; the two named heavy tests ran 10.2s and 3.4s.
   - `npx vitest run test/renderBriefingDiagramsCli.test.js` — **4/4
     pass**, 40.9s total; the two named heavy tests ran 13.5s and 17.2s.
     **These are the exact two tests I personally watched time out at
     20000ms/20345ms and 26431ms** during this same session's earlier
     full-suite verification attempt for the prior BL-817 parcel (before
     BL-914's fix was merged into this worktree) — direct, first-hand
     before/after confirmation the fix actually resolves the real
     observed failure, not just a synthetic one.
   - `run_acceptance.sh
     specs/features/BL-914-per-test-timeout-for-heavy-subprocess-render-tests.feature`
     — **5/5 PASS**, matching the architect's own run.
   - Post-run leak check: only the 8 legitimate live-swarm/operator
     tmux sessions present; `git status --short` clean.
3. **Required wiring / invariants, independently re-verified**:
   - `specs/pipeline/steps/index.js` registers `bl914PerTestTimeoutSteps`
     (line 500).
   - All 6 named `test(...)` call sites carry the literal `45000` third
     argument (grepped directly, not read from the commit message):
     `dependencyGateCliReportsAndScope.test.js:32`,
     `renderBriefingBurndownCli.test.js:57,67`,
     `renderBriefingDiagramsCli.test.js:47,104,126`.
   - `extension/vitest.config.mjs`'s `testTimeout: 20000` (line 95)
     unchanged — invariant 1 confirmed directly, not merely trusted.
4. **Scope-boundary spot-check** (own hardening judgment, beyond what the
   architect already covered): confirmed the ticket's own explicit
   exclusion — `activateBounceWatcher.test.js`, `bounceDrain.test.js`,
   `bounceWatcher.test.js` — were NOT touched by this parcel
   (`git diff d63a9bdcf^ d8b3f11b3f --stat` lists none of the three);
   the real-timer violation those three carry is correctly left for a
   separate fix, not entrenched here by grant of extra headroom.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling (no
`extension/src/*.ts` touched). All targeted unit, property, and
acceptance verification green, including a direct live before/after
comparison against the exact two subprocess-render tests this session
personally observed time out earlier today. Both invariants and the
required wiring independently re-confirmed by direct grep, not trusted
from any commit message.

Forwarding to documenter.

By hardener.
