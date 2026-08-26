# BL-352 run-history-headless — 20260713 (coder)

## What shipped

`swarmforge.sh`'s own launch path (and `kill_all_swarm.sh`'s own stop path) now record into the SAME
`runs.jsonl` `runLog.ts`'s `appendRun`/`updateLastRunForTarget` already define — the shape a shell-launched
swarm (which is how the real swarm actually runs, including this box's own self-hosting swarm) never
appeared in before this ticket.

## Design: one shared new CLI, called from both shell scripts

`extension/src/tools/record-run.ts` (new) — `node record-run.js start <target-path>` appends a run
entry (`{name, targetPath, startedAt, status: 'running'}`); `node record-run.js stop <target-path>`
completes the most recent entry for that target (`{completedAt, status: 'stopped'}`). Both reuse
`runLog.ts`'s own functions unchanged — no second run-record format, per the ticket's own explicit
instruction. `generateDefaultRunName` (previously a private function inside `extension.ts`) was moved
into `run/resolveRunName.ts` so this headless CLI (no `vscode.*` available) generates the exact same
`run-YYYYMMDD-HHMM` timestamp-default shape a VS Code launch would, from one shared implementation.

Wired in at the natural completion points: `swarmforge.sh` calls `record-run.js start` right after
"SwarmForge is ready." (every role's session has actually launched); `kill_all_swarm.sh` calls
`record-run.js stop` right after tmux/daemon teardown completes (step 6.5, before the optional
inbox-sweep/worktree-reset extras). Both degrade silently (best-effort, `|| true`, and only invoked
if the compiled CLI file exists at all) — a missing/stale build must never block a real launch or stop
over a history-recording concern.

## The double-recording risk, and how it's actually closed

Traced how a VS Code-initiated launch reaches `./swarm` before writing anything: there are TWO
separate TS launch paths that both ultimately spawn the top-level `./swarm` script directly —
`extension.ts`'s main `launchSwarm` command (via `swarmOrchestrator.ts`'s `orchestrateFullLaunch` →
`startSwarmAgents`) and `autoLaunchSwarmOnActivation` (via `swarmLauncher.ts`'s own `launchSwarm`
function). Both of these ALREADY call `runLog.ts`'s `appendRun` themselves, unchanged, before ever
reaching `./swarm` — so if `swarmforge.sh`'s own new recording fired unconditionally, EVERY editor
launch would get two entries.

Both paths converge on exactly one shared function that builds the env `./swarm` is spawned with:
`swarmLauncher.ts`'s `buildLaunchEnv` (confirmed via a repo-wide grep — it has exactly these two
callers, nothing else). `buildLaunchEnv` now unconditionally sets
`SWARMFORGE_SKIP_SHELL_RUN_RECORD=1` on its own output; `swarmforge.sh` checks that flag before
running its own new recording. A genuine shell launch (`./swarm` invoked directly by a human, never
through `buildLaunchEnv` at all) simply never carries the flag, so `swarmforge.sh`'s default is to
record — exactly the asymmetry the ticket's own scenario 04 requires.

The stop side has no equivalent risk: `swarmStopper.ts` (VS Code's `stopSwarm` command) does its own
direct tmux/process teardown in TypeScript and never shells to `kill_all_swarm.sh` at all (confirmed —
no `spawnSync`/`execFileSync`/`.sh` reference anywhere in that file), so `kill_all_swarm.sh`'s own new
`record-run.js stop` call can never double-complete a run the VS Code path also completed.

## Test coverage

- `extension/test/recordRunCli.test.js` (new) — the real compiled CLI, `HOME` sandboxed to a
  throwaway directory so no test ever touches this box's own real `~/.swarmforge/runs.jsonl` (the
  live production swarm's own run history): `start` appends a run naming the target with a running
  status and real timestamps; `stop` completes the SAME entry (never a second one); `stop` against a
  target with no prior run is a safe no-op; `stop` only completes the matching target's run, never a
  different one; an unknown mode or missing target path exits non-zero with a usage message.
- `extension/test/resolveRunName.test.js` — 2 new tests for the moved `generateDefaultRunName`
  (fixed-instant formatting, and defaulting to "now" when no instant is given).
- `extension/test/swarmLauncher.test.js` — 1 new test confirming `buildLaunchEnv` always sets the
  skip flag.
- `specs/pipeline/steps/runHistoryHeadlessSteps.js` (new, registered in
  `specs/pipeline/steps/index.js`) — all 4 Gherkin scenarios in `BL-352-run-history-headless.feature`,
  driven against the real compiled CLI with a sandboxed `HOME`. Scenario 04 (no double-recording on an
  editor launch) verifies the real skip-flag wiring both at the TS level (`buildLaunchEnv`'s real
  output) and by reading `swarmforge.sh`'s own real source for the guard/invocation shape — a full
  real invocation of `swarmforge.sh`/`kill_all_swarm.sh` was deliberately NOT attempted: that would
  spin up a real swarm (real tmux sessions, real agents) on THIS box, risking collision with the live
  self-hosting swarm already running here, the same collision class BL-328's own fixtures went out of
  their way to avoid (never binding the real production bridge port). Found and fixed a real step-text
  collision with `resourceSamplerActivationSteps.js`'s own "the swarm is stopped" step, resolved with
  the same `ctx.<flag>Runner`-delegation pattern already established in this codebase this session
  (BL-351/BL-353's own identical fixes).

Full regression: `npx vitest run` in `extension/` — 233 test files, 3248 tests, all green. Re-ran
`BL-264-wire-resource-sampler-activation.feature`'s own acceptance suite (the file whose shared step I
edited) — all green, confirming no regression in its own scenarios. `zsh -n`/`bash -n` syntax-checked
both edited shell scripts. No `.bb` file was touched by this ticket.

## What was explicitly not done

Per the ticket's own scope: the run log format/shape was not redesigned (reused `RunEntry` unchanged),
the `/runlog` bridge surface was not touched, and none of the other four BL-336 findings were
addressed here. No real swarm launch/stop was exercised against this box's own live production swarm
at any point.
