# BL-1324 — hardener pass, 2026-09-02

Reviewed commit `21251ecb42` (architect clean sweep), merged into hardender
as `ba4910cd8c`. Review-only BL-848 stamp-off parcel: no production wiring
touched — only step handlers, a property test, and evidence files.

## Load / process hygiene
- `uptime`: load average 1.47 on 20 cores — quiet, no bypass needed.
- `pgrep -fl 'node --test|stryker'`: no strays before starting.
- No file-change cooldown concern: no production source files touched by
  this parcel (only `specs/pipeline/steps/*.js`, `extension/test/*.property.test.js`,
  evidence files).

## Checks run
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js` —
  3/3 pass.
- `npm run compile` (fresh build before acceptance, per BL-497).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature` —
  11/11 pass, matches architect's evidence.
- BL-113 soft Gherkin acceptance-mutation gate (the ticket's one
  `Scenario Outline`, `extra_cli_targets_qwen_cloud detects a qwen*
  --model token`): ran with all 4 positionals explicit
  (`run_gherkin_mutation.sh <feature> <fresh-mktemp-under-./tmp/>
  specs/pipeline/steps/index.js soft`), workdir removed after the run.
  Result: **8/8 killed, 0 survived, 0 errors** — manifest stamped into the
  feature file (`acceptance-mutation-manifest-begin/end`, `mutation-stamp`
  header). Verified this is a genuine run, not the crash-fake-kill trap:
  every "killed" mutant's TAP output shows a real assertion failure
  (`disagrees with the handler's known-value table`, `unknown <extra_cli>
  row`), not a MODULE_NOT_FOUND crash.
- CRAP: N/A — this parcel touches zero `extension/src/*.ts` files (git
  diff against `main` confirms). Matches architect's "no production
  wiring touched" finding.
- DRY: `npx jscpd specs/pipeline/steps/bl1324ClaudeSeatQwenCloudContextWindowSteps.js
  --min-lines 15 --min-tokens 50` — 0 clones found.
- Fixture hygiene read of the new step-handler file: every fixture-root
  creator (`callMatcher`, `buildLaunchScript`, `buildPaneEnv`) creates and
  removes its own root inside a single function via `try/finally` — no
  cross-step bridge-handle/temp-dir hazard (the 2026-08-13/2026-08-18
  rules). `sweepStaleFixtures()` (BL-971 pattern) sweeps stale roots by
  mtime before each new root is made. `buildPaneEnv` fakes tmux with a
  logging shell shim (no real tmux server spawned) — no socket to leak.
  The property test's own fixture uses `mkTmpDir()` (BL-743 convention).
- Whole-tree acceptance-guard sweep (this parcel touches
  `specs/pipeline/steps/` and `extension/test/`, so all 16
  `test/*Guard*.test.js` files were run, not just the file count noted in
  the standing rule from 2026-08-19 — the set has grown since):
  **3 pre-existing failures**, all unrelated to this parcel and already
  tracked:
  - `tempDirTrapGuard.test.js` → violations list does not name any
    BL-1324 file; tracked as `backlog/paused/BL-1289-a-temp-root-is-always-cleaned-up.yaml`.
  - `socketFixtureShortRootGuard.test.js` → tracked as
    `backlog/paused/BL-1290-a-socket-fixture-is-rooted-short-enough-to-bind.yaml`.
  - `liveRepoDerivationGuard.test.js` (BL-1038) → tracked as
    `backlog/paused/BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`.
  Confirmed via grep that none of the three failing violation lists
  mention `bl1324` — this parcel is not the cause.

## Lessons
No new lesson to propose this pass — the parcel's fixture discipline
already follows the documented patterns (BL-971 sweep, BL-743 mkTmpDir,
try/finally single-function fixture lifetime) from prior lessons, and no
new failure mode was found.

## Verdict
Clean sweep — no defect found. Forwarding to documenter.
