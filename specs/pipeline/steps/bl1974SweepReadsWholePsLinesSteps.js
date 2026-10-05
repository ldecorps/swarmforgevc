'use strict';

// BL-1974: step handlers for "the fixture sweep never selects a live run's
// fixture from a partial ps line". Drives the REAL compiled
// leakedFixtureTunnelPids/isProcessAlive (extension/test/helpers/
// fixtureTunnelName.js) through their injected execFileSync with canned
// ps output/errors, per the ticket's own direction - never a restatement
// of the selector or the liveness probe.

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _fixtureTunnelName = null;
function fixtureTunnelName() {
  if (!_fixtureTunnelName) _fixtureTunnelName = require(path.join(EXT_DIR, 'test', 'helpers', 'fixtureTunnelName'));
  return _fixtureTunnelName;
}

const FEATURE = "BL-1974 The fixture sweep never selects a live run's fixture from a partial ps line";

const FIXTURE_PID = 54321;
const FIXTURE_DIR = path.join(os.tmpdir(), 'bl1974-fixture-xyz');

function fixtureLine(pid, dir, creatorPid, label) {
  const name = `sfvc-test-${creatorPid}-1-${label}-abc123`;
  return `${pid} bash ${dir}/cloudflared tunnel --config ${dir}/fake-config.yml --no-autoupdate run ${name}`;
}

// A real pid guaranteed already dead - spawnSync waits for full exit, so
// it has already been reaped by the time this returns (the same shape
// bl1287FixtureSweepFixture.js's own deadPid() uses).
function deadPid() {
  const child = spawnSync('true', []);
  return child.pid;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture cloudflared under the OS temp directory whose tunnel name records a live creating run$/, (ctx) => {
    ctx.bl1974 = { creatorPid: process.pid };
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^COLUMNS is 80 and the fixture's ps line is longer than 80 characters$/, (ctx) => {
    const line = fixtureLine(FIXTURE_PID, FIXTURE_DIR, ctx.bl1974.creatorPid, 'a-label-long-enough-to-push-this-past-eighty-characters-total');
    assert.ok(line.length > 80, `fixture line must exceed 80 chars for this scenario, got ${line.length}`);
    ctx.bl1974.execFileSync = (cmd, args) => {
      assert.equal(cmd, 'ps');
      if (args.includes('-eo')) {
        // The fix must request -ww; a selector that forgot it would, on
        // a real COLUMNS=80 terminal, get back exactly this truncated
        // 80-char line instead - cutting the creator pid off the end and
        // reading it as "unknown creator" (selected). Simulated here by
        // punishing the missing flag the same way a real terminal would.
        assert.ok(args.includes('-ww'), `expected the ps call to request -ww (unbounded width), got args: ${JSON.stringify(args)}`);
        return `${line}\n`;
      }
      if (args.includes('-p')) {
        // The creator (this test process) is alive.
        return 'S\n';
      }
      throw new Error(`unexpected ps invocation: ${JSON.stringify(args)}`);
    };
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the fixture's ps line is still its spawner's bash -c command line$/, (ctx) => {
    // The exact shape spawnFakeCloudflared's own pre-exec moment produces:
    // bash's OWN argv, still showing -c and the script text verbatim,
    // with the real bin/dir/name as later, SEPARATE argv entries - so
    // "cloudflared" and "run <name>" both appear in the line, but the
    // command is bash, not the tunnel binary.
    const line =
      `${FIXTURE_PID} bash -c "$1" tunnel --config "$2/fake-config.yml" --no-autoupdate run "$3" ` +
      `_ ${FIXTURE_DIR}/cloudflared ${FIXTURE_DIR} sfvc-test-${ctx.bl1974.creatorPid}-1-spawner-abc123`;
    ctx.bl1974.execFileSync = (cmd, args) => {
      if (args.includes('-eo')) return `${line}\n`;
      throw new Error('the spawner line must be excluded before any liveness probe is ever asked for');
    };
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^ps fails to run when the sweep asks for the creator's state$/, (ctx) => {
    const line = fixtureLine(FIXTURE_PID, FIXTURE_DIR, ctx.bl1974.creatorPid, 'probe-fails');
    ctx.bl1974.execFileSync = (cmd, args) => {
      if (args.includes('-eo')) return `${line}\n`;
      if (args.includes('-p')) {
        // "ps could not run" - never a clean exit 1 with empty stdout
        // (the one shape that confirms "gone"). No .status at all, the
        // shape a spawn-level failure (ENOENT, a thrown signal) takes.
        const err = new Error('ps: command not found');
        throw err;
      }
      throw new Error(`unexpected ps invocation: ${JSON.stringify(args)}`);
    };
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the fixture's creating run has exited$/, (ctx) => {
    ctx.bl1974.creatorPid = deadPid();
    const line = fixtureLine(FIXTURE_PID, FIXTURE_DIR, ctx.bl1974.creatorPid, 'dead-creator');
    ctx.bl1974.execFileSync = (cmd, args) => {
      if (args.includes('-eo')) return `${line}\n`;
      // process.kill(deadPid, 0) already throws inside isProcessAlive,
      // so execution never reaches a -p ps call for a truly dead creator
      // in this scenario - but answer it anyway (clean "gone" shape) in
      // case the real kernel reused the pid between runs on a loaded host.
      if (args.includes('-p')) {
        const err = new Error('');
        err.status = 1;
        err.stdout = '';
        throw err;
      }
      throw new Error(`unexpected ps invocation: ${JSON.stringify(args)}`);
    };
  });

  // ── shared When/Then ─────────────────────────────────────────────────
  scoped(/^the sweep selects leaked fixtures$/, (ctx) => {
    ctx.bl1974.selected = fixtureTunnelName().leakedFixtureTunnelPids(ctx.bl1974.execFileSync);
  });

  scoped(/^the fixture is not selected$/, (ctx) => {
    assert.ok(!ctx.bl1974.selected.includes(FIXTURE_PID), `expected ${FIXTURE_PID} not selected, got: ${JSON.stringify(ctx.bl1974.selected)}`);
  });

  scoped(/^the fixture is selected$/, (ctx) => {
    assert.ok(ctx.bl1974.selected.includes(FIXTURE_PID), `expected ${FIXTURE_PID} selected, got: ${JSON.stringify(ctx.bl1974.selected)}`);
  });
}

module.exports = { registerSteps };
