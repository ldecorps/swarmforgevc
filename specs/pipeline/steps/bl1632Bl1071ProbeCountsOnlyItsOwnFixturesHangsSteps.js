'use strict';

// BL-1632: step handlers for "The bl1071 stray-hang probe counts only its
// own fixture's hangs" (specifier-authored feature, lands with this handler
// in the same parcel - BL-233, BL-1371).
//
// Scenarios 01 and 02 reuse BL-1071's own shared fixture
// (extension/test/helpers/bl1071SweepFixture.js) - makeSweepFixture,
// breakProbes, writeStub, runSweep, and this ticket's own two exports,
// HANG_SHAPES and fixtureHangs. Scenario 03 reuses BL-1621's "runs alone
// under the properties config" step shape; scenario 04 reuses its
// evidence-reading shape, scoped to this feature and this file.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const {
  makeSweepFixture,
  breakProbes,
  writeStub,
  runSweep,
  TMUX_NO_SERVER,
  HANG_SHAPES,
  fixtureHangs,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'bl1071SweepFixture'));

const FEATURE = "BL-1632 The bl1071 stray-hang probe counts only its own fixture's hangs";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const FILE_REL = 'test/bl1071RecoveryBoundedInTime.property.test.js';
const FILE_BASENAME = 'bl1071RecoveryBoundedInTime.property.test.js';

const FIXTURE_PREFIX = 'bl1632-acc-';

function sweepStale() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runProperty() {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', FILE_REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── bl1071-probe-counts-only-its-own-fixtures-hangs-01 ─────────────────
  scoped(/^a hang process alive on the host that no sweep fixture started$/, (ctx) => {
    sweepStale();
    const foreign = spawn('sleep', ['3600'], { detached: true, stdio: 'ignore' });
    foreign.unref();
    ctx.foreignPid = foreign.pid;
  });

  scoped(/^a sweep fixture built with the plain hang shape$/, (ctx) => {
    ctx.fixture01 = breakProbes(makeSweepFixture(mkdir, { swarmStub: HANG_SHAPES.plain }), [], {
      planeMissing: true,
    });
    writeStub(ctx.fixture01, 'tmux', TMUX_NO_SERVER);
  });

  scoped(/^the sweep runs against that fixture with a 1500 ms recovery bound$/, (ctx) => {
    const r = runSweep(ctx.fixture01, { BABYSITTER_ENSURE_TIMEOUT_MS: '1500' });
    ctx.sweep01output = r.output;
  });

  scoped(/^the sweep reports the recovery unfinished$/, (ctx) => {
    assert.match(ctx.sweep01output, /REPAIR \[unfinished\] control-plane/, ctx.sweep01output);
  });

  scoped(/^the fixture's probe reports 0 hangs$/, (ctx) => {
    const n = fixtureHangs(ctx.fixture01);
    assert.equal(n, 0, `expected the fixture's own scoped probe to read 0, got ${n}`);
  });

  scoped(/^the foreign hang process is still alive$/, (ctx) => {
    try {
      assert.ok(
        isAlive(ctx.foreignPid),
        'the foreign hang process (started by no fixture) was reaped by a sweep scoped to a different fixture'
      );
    } finally {
      try {
        process.kill(ctx.foreignPid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      ctx.foreignPid = null;
    }
  });

  // ── bl1071-probe-counts-only-its-own-fixtures-hangs-02 ─────────────────
  scoped(
    /^a sweep fixture built with the grandchild hang shape whose swarm stub has been started in a process group of its own$/,
    (ctx) => {
      ctx.fixtureA = breakProbes(makeSweepFixture(mkdir, { swarmStub: HANG_SHAPES.grandchild }), [], {
        planeMissing: true,
      });
      writeStub(ctx.fixtureA, 'tmux', TMUX_NO_SERVER);
      const child = spawn('bash', [path.join(ctx.fixtureA.root, 'swarm')], { detached: true, stdio: 'ignore' });
      ctx.fixtureASwarmPid = child.pid;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && fixtureHangs(ctx.fixtureA) < 2) {
        execFileSync('sleep', ['0.05']);
      }
    }
  );

  scoped(/^a second sweep fixture built with the grandchild hang shape whose swarm stub has not run$/, (ctx) => {
    ctx.fixtureB = breakProbes(makeSweepFixture(mkdir, { swarmStub: HANG_SHAPES.grandchild }), [], {
      planeMissing: true,
    });
    writeStub(ctx.fixtureB, 'tmux', TMUX_NO_SERVER);
  });

  scoped(/^each fixture's hang probe is read$/, (ctx) => {
    try {
      ctx.hangsA = fixtureHangs(ctx.fixtureA);
      ctx.hangsB = fixtureHangs(ctx.fixtureB);
    } finally {
      // The whole process GROUP the swarm stub started - a leaked `sleep
      // 3600` from this handler would itself be the peer this ticket
      // removes.
      if (ctx.fixtureASwarmPid) {
        try {
          process.kill(-ctx.fixtureASwarmPid, 'SIGKILL');
        } catch {
          /* already gone */
        }
        ctx.fixtureASwarmPid = null;
      }
    }
  });

  scoped(/^the first fixture's probe reports 2 hangs$/, (ctx) => {
    assert.equal(ctx.hangsA, 2, `expected 2 hangs for the first fixture (direct + grandchild), got ${ctx.hangsA}`);
  });

  scoped(/^the second fixture's probe reports 0 hangs$/, (ctx) => {
    assert.equal(ctx.hangsB, 0, `expected 0 hangs for the second fixture, whose swarm stub never ran, got ${ctx.hangsB}`);
  });

  // ── bl1071-probe-counts-only-its-own-fixtures-hangs-03 ─────────────────
  scoped(
    /^extension\/test\/bl1071RecoveryBoundedInTime\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      const result = runProperty();
      ctx.bl1632run = { result, output: `${result.stdout || ''}${result.stderr || ''}` };
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = ctx.bl1632run;
    assert.equal(s.result.status, 0, `expected the file to pass, got:\n${s.output.slice(-4000)}`);
  });

  // ── bl1071-probe-counts-only-its-own-fixtures-hangs-04 ─────────────────
  scoped(
    /^the parcel's evidence for extension\/test\/bl1071RecoveryBoundedInTime\.property\.test\.js is read$/,
    (ctx) => {
      const candidates = fs
        .readdirSync(EVIDENCE_DIR)
        .filter((f) => f.startsWith('BL-1632-') && f.endsWith('.md'))
        .map((f) => path.join(EVIDENCE_DIR, f))
        .filter((full) => fs.readFileSync(full, 'utf8').includes(FILE_BASENAME));
      assert.ok(candidates.length > 0, `no BL-1632 evidence file mentions ${FILE_BASENAME}`);
      ctx.bl1632evidence = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
    }
  );

  scoped(
    /^it records the failing assertion message verbatim from a full property-lane run and the change that removed it$/,
    (ctx) => {
      const text = ctx.bl1632evidence;
      assert.match(
        text,
        /stray hangs before, \d+ after/,
        `evidence does not quote the failing assertion verbatim:\n${text.slice(0, 2000)}`
      );
      assert.match(
        text,
        /removed|fixed|remedy|resolved|scoped/i,
        `evidence does not record the change that removed it:\n${text.slice(0, 2000)}`
      );
    }
  );
}

module.exports = { registerSteps };
