# BL-352 run-history-headless — architect review (20260713)

Merged cleaner 05987a454f (on top of coder, merge-base 9b7ce40619).

## Hard gate (BL-259)
`node extension/out/tools/dependency-gate.js` against all changed/new source
files (`extension.ts`, `run/resolveRunName.ts`, `swarm/swarmLauncher.ts`,
`tools/record-run.ts`), after a clean `npm run compile`:
**PASSED — no forbidden edges.**

## Co-change (BL-255, informational)
`co-change-report.js` over the same file set: only the familiar broad
`extension.ts` orchestrator coupling (pre-existing, every ticket touches it)
and `swarmLauncher.ts`/`swarmforge.sh` co-changing with their own test file —
expected for this ticket's own scope. No send-back warranted.

## Architecture checks
- CLI `main()` thin-wrapper rule: `record-run.ts`'s `main` is built via the
  existing `makeArgsGuardedMain` helper; `parseCliArgs` is pure/exported and
  directly unit-tested — correct split, same pattern as `co-change-report.ts`.
- Secrets/extension-host-only-I/O/webview-storage/two-layer rules: untouched
  by this ticket (pure shell + CLI + run-log wiring, no webview involved).
- Integrate-not-fork: `swarmforge.sh`/`kill_all_swarm.sh` edits are local
  modifications to this repo's own maintained fork (per
  `local-engineering.prompt`), not changes to an unmodified upstream tool.

## Correctness verification (double-recording is the load-bearing claim)
Read the source directly rather than trusting the evidence file:
- `swarmforge.sh:1297` skips its own `record-run.js start` call exactly when
  `SWARMFORGE_SKIP_SHELL_RUN_RECORD=1` is set.
- `swarmLauncher.ts:324` (`buildLaunchEnv`) unconditionally sets that flag.
  Grepped `buildLaunchEnv` call sites: exactly two
  (`swarmLauncher.ts:411`, used by its own `launchSwarm` — the function both
  `autoLaunchSwarmOnActivation` and the drain-mode "Launch Next Item" command
  call after their own `appendRun`; and `extension.ts:1260`, inside the main
  `swarmforge.launchSwarm` command's own `withProgress` block, immediately
  after that same command's own `appendRun` at line 1243). Every TS path that
  reaches `buildLaunchEnv` has already called `appendRun` itself — confirmed,
  not assumed — so the shell-side skip is correctly gated in all cases.
- A genuine shell-only launch (no `buildLaunchEnv` in the process at all)
  never carries the flag, so `swarmforge.sh` records by default — matches
  scenario 04's asymmetry.
- Stop side: grepped `swarmStopper.ts` for any shell-out to
  `kill_all_swarm.sh` — none exists; VS Code's `stopSwarm` command does its
  own direct tmux teardown, so `kill_all_swarm.sh:152`'s new
  `record-run.js stop` call can never double-complete a run the VS Code path
  already completed.

## Verification run
- Fresh `npm run compile`: clean.
- `npx vitest run` in `extension/`: 233 files / 3275 tests, all green.
- Drove this ticket's own acceptance feature live
  (`BL-352-run-history-headless.feature`): 4/4 scenarios pass.
- Re-ran `BL-264-wire-resource-sampler-activation.feature` (the file whose
  shared step handler this ticket edited): 3/3 scenarios pass, no regression.
- `zsh -n swarmforge/scripts/swarmforge.sh` (its actual shebang shell) and
  `bash -n swarmforge/scripts/kill_all_swarm.sh`: both clean. (Note: `bash -n`
  on `swarmforge.sh` itself reports a syntax error at line 114 —
  `[[ "$value" == <-> ]]` — but that construct is zsh-only glob syntax and
  the file is `#!/usr/bin/env zsh`; confirmed pre-existing on the merge-base
  commit, unrelated to this ticket, and not a real defect once checked under
  the correct shell.)

No correctness defect found. Ticket's own scope (run-log format unchanged,
`/runlog` surface untouched, other BL-336 findings out of scope) was
respected.

## Verdict
PASS. Forwarding to hardener.
