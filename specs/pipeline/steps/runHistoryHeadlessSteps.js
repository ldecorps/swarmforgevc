'use strict';

// BL-352 (BL-336 finding H5): step handlers for "A swarm launched from the
// command line appears in the run history". The actual RECORDING behavior
// (start appends, stop completes the SAME entry, the target is named, no
// double-entry) is driven against the REAL compiled record-run.js CLI with
// a sandboxed HOME (never this box's own real ~/.swarmforge/runs.jsonl -
// the live production swarm's own run history). Actually invoking
// swarmforge.sh/kill_all_swarm.sh for real is deliberately NOT done here:
// a full launch would spin up a real swarm (real tmux sessions, real
// agents) on THIS box, risking collision with the live self-hosting swarm
// already running - the same collision class BL-328's own fixtures went
// out of their way to avoid (never binding the real production bridge
// port). Their own WIRING (the right CLI invoked at the right point, the
// right skip-guard respected) is instead verified against their real
// source, mirroring BL-336's own audit posture for exactly this kind of
// "real invocation is impractical/risky here" case.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-run.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(args, home) {
  const env = { PATH: process.env.PATH, HOME: home };
  const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', env });
  return JSON.parse(out);
}

function runsFile(home) {
  return path.join(home, '.swarmforge', 'runs.jsonl');
}

function readRuns(home) {
  try {
    return fs
      .readFileSync(runsFile(home), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a run history the human can read$/, () => {
    // Narrative only - runs.jsonl / the bridge's own /runlog surface.
  });

  // ── run-history-headless-01 / -03 (shared Given) ──────────────────────
  registry.define(/^no editor is attached$/, (ctx) => {
    ctx.home = mkTmp('sfvc-bl352-home-');
    ctx.target = mkTmp('sfvc-bl352-target-');
  });

  registry.define(/^the swarm is launched from the command line$/, (ctx) => {
    ctx.startResult = runCli(['start', ctx.target], ctx.home);
  });

  registry.define(/^that run appears in the run history$/, (ctx) => {
    const runs = readRuns(ctx.home);
    assert.equal(runs.length, 1, `expected exactly one run recorded, got: ${JSON.stringify(runs)}`);
    assert.equal(runs[0].targetPath, ctx.target);
    assert.equal(runs[0].status, 'running');
  });

  // ── run-history-headless-02 ────────────────────────────────────────────
  registry.define(/^a swarm was launched from the command line and recorded$/, (ctx) => {
    ctx.home = mkTmp('sfvc-bl352-home-');
    ctx.target = mkTmp('sfvc-bl352-target-');
    const first = runCli(['start', ctx.target], ctx.home);
    assert.equal(first.recorded, 'start');
    ctx.swarmStopRunner = () => {
      ctx.stopResult = runCli(['stop', ctx.target], ctx.home);
    };
  });

  registry.define(/^that run is recorded as finished$/, (ctx) => {
    assert.equal(ctx.stopResult.recorded, 'stop');
    const runs = readRuns(ctx.home);
    assert.equal(runs.length, 1, `expected the SAME entry completed, not a second one appended, got: ${JSON.stringify(runs)}`);
    assert.equal(runs[0].status, 'stopped');
    assert.ok(Date.parse(runs[0].completedAt), 'expected a real completedAt timestamp');
  });

  // ── run-history-headless-03 ────────────────────────────────────────────
  registry.define(/^the swarm is launched from the command line against a target$/, (ctx) => {
    ctx.startResult = runCli(['start', ctx.target], ctx.home);
  });

  registry.define(/^the recorded run names that target$/, (ctx) => {
    const runs = readRuns(ctx.home);
    assert.equal(runs[runs.length - 1].targetPath, ctx.target, `expected the recorded run to name the real target path, got: ${JSON.stringify(runs)}`);
  });

  // ── run-history-headless-04 ────────────────────────────────────────────
  registry.define(/^an editor is attached$/, (ctx) => {
    ctx.home = mkTmp('sfvc-bl352-home-');
    ctx.target = mkTmp('sfvc-bl352-target-');
  });

  registry.define(/^the swarm is launched from the editor$/, (ctx) => {
    // extension.ts's own launchSwarm command already calls appendRun
    // itself (unchanged, pre-existing - simulated here directly, the
    // exact shape it writes) - the real guarantee this scenario proves is
    // that swarmforge.sh's own NEW recording, reached via the SAME
    // ./swarm script an editor launch also runs, does NOT ALSO record a
    // second entry, because buildLaunchEnv (real, compiled, unit-tested
    // in swarmLauncher.test.js) sets SWARMFORGE_SKIP_SHELL_RUN_RECORD on
    // every editor-initiated launch's own env.
    fs.mkdirSync(path.dirname(runsFile(ctx.home)), { recursive: true });
    fs.appendFileSync(
      runsFile(ctx.home),
      JSON.stringify({ name: 'run-editor-launch', targetPath: ctx.target, startedAt: new Date().toISOString(), status: 'running' }) + '\n'
    );

    const { buildLaunchEnv } = require(path.join(EXT_DIR, 'out', 'swarm', 'swarmLauncher'));
    const editorLaunchEnv = buildLaunchEnv('run-editor-launch');
    assert.equal(editorLaunchEnv.SWARMFORGE_SKIP_SHELL_RUN_RECORD, '1', 'expected an editor-initiated launch env to carry the skip flag');

    // The real swarmforge.sh source respects exactly that flag, at the
    // exact point it would otherwise record a second entry.
    const swarmforgeSrc = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh'), 'utf8');
    assert.match(
      swarmforgeSrc,
      /if \[\[ "\$\{SWARMFORGE_SKIP_SHELL_RUN_RECORD:-\}" != "1" \]\]; then/,
      'expected swarmforge.sh to guard its own run-recording on the skip flag'
    );
    assert.match(swarmforgeSrc, /node "\$RECORD_RUN_CLI" start "\$WORKING_DIR"/, 'expected swarmforge.sh to invoke record-run.js start when not skipped');
  });

  registry.define(/^that run appears in the run history once$/, (ctx) => {
    const runs = readRuns(ctx.home).filter((r) => r.targetPath === ctx.target);
    assert.equal(runs.length, 1, `expected exactly one recorded run for this launch, got: ${JSON.stringify(runs)}`);
  });
}

module.exports = { registerSteps };
