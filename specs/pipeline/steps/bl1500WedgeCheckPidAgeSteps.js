'use strict';

// BL-1500: step handlers for "the BL-977 wedge check presents a daemon
// older than the startup grace". Scenario 01 drives the REAL
// `--check-once` path over a fixture built in bl977SupervisorProgressSteps
// .js's own shape (reused via its exports), varying only the one thing its
// scenarios never do - the pid file's age against the 2026-09-02 startup
// grace. Scenario 02 runs the REAL BL-977 feature end to end through the
// acceptance CLI, proving all ten of its scenarios resolve from the
// checkout this run is in.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  mkSupervisorFixture,
  ageHeartbeat,
  writeMarker,
  runCheckOnce,
  supervisorLog,
  STALL_MS,
} = require('./bl977SupervisorProgressSteps');

const FEATURE = 'BL-1500 The BL-977 wedge check presents a daemon older than the startup grace';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'cli.js');
const BL977_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-977-supervisor-never-halts-a-progressing-daemon.feature'
);

const KNOWN_PID_FILE_AGES = new Set(['older', 'younger']);
const KNOWN_STATES = new Set(['healthy', 'halted']);

// The same past-budget heartbeat/marker shape BL-977's own scenario 05
// stages (400000/300000 ms, both past the 225000 ms in-sweep budget) -
// this scenario's point is the pid file's age, not a new wedge shape.
const WEDGED_HEARTBEAT_AGE_MS = 400000;
const WEDGED_MARKER_AGE_MS = 300000;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 (outline) ────────────────────────────────────────────────
  scoped(
    /^a supervisor fixture whose heartbeat and in-flight sweep marker are both past the in-sweep budget and whose pid names a live process$/,
    (ctx) => {
      // pidAgeMs 0: leave the pid file at its just-written, fresh mtime -
      // the next step ages it, or doesn't, per the outline row. That row
      // is exactly the boundary this scenario proves.
      mkSupervisorFixture(ctx, { pidAgeMs: 0 });
      ageHeartbeat(ctx, WEDGED_HEARTBEAT_AGE_MS);
      writeMarker(ctx, 'dropped-parcel-sweep', WEDGED_MARKER_AGE_MS);
    }
  );

  scoped(/^the pid file is (older|younger) than one stall window$/, (ctx, age) => {
    if (!KNOWN_PID_FILE_AGES.has(age)) {
      throw new Error(`unknown <pid_file_age> token: ${age}`);
    }
    if (age === 'older') {
      const pidFile = path.join(ctx.daemonDir, 'handoffd.pid');
      const t = (Date.now() - (STALL_MS + 30000)) / 1000;
      fs.utimesSync(pidFile, t, t);
    }
    // 'younger': the fixture already left the pid file at its fresh mtime.
  });

  scoped(/^the supervisor checks twice$/, (ctx) => {
    ctx.firstCheck = runCheckOnce(ctx);
    ctx.secondCheck = runCheckOnce(ctx);
  });

  scoped(/^the status reads (healthy|halted)$/, (ctx, state) => {
    if (!KNOWN_STATES.has(state)) {
      throw new Error(`unknown <state> token: ${state}`);
    }
    const statusPath = path.join(ctx.daemonDir, 'handoffd.status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(status.state, state, `status file: ${JSON.stringify(status)}`);
  });

  scoped(/^the swarm halt count across both checks is (\d+)$/, (ctx, count) => {
    const log = supervisorLog(ctx);
    const halts = (log.match(/alarm-and-halt/g) || []).length;
    assert.equal(halts, Number(count), `expected ${count} halt(s) across both checks:\n${log}`);
  });

  // ── Scenario 02 ────────────────────────────────────────────────────────
  scoped(/^the BL-977 feature file as tracked in the checkout the acceptance run is in$/, () => {
    if (!fs.existsSync(BL977_FEATURE)) {
      throw new Error(`missing BL-977 feature file at ${BL977_FEATURE}`);
    }
  });

  scoped(/^the BL-977 feature runs through the acceptance runner$/, (ctx) => {
    const env = { ...process.env };
    delete env.RESEND_API_KEY;
    const result = spawnSync(process.execPath, [CLI, BL977_FEATURE], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    ctx.bl1500NestedRun = { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^it reports ten scenarios passed and none failed$/, (ctx) => {
    const out = ctx.bl1500NestedRun?.output || '';
    const pass = /^# pass (\d+)/m.exec(out);
    const fail = /^# fail (\d+)/m.exec(out);
    assert.equal(pass ? Number(pass[1]) : null, 10, `expected pass 10, got:\n${out}`);
    assert.equal(fail ? Number(fail[1]) : null, 0, `expected fail 0, got:\n${out}`);
  });
}

module.exports = { registerSteps };
