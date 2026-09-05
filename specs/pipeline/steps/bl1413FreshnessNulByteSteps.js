'use strict';

// BL-1413: step handlers for "The freshness check measures a heartbeat log
// from its newest heartbeat line, whatever bytes the file carries".
//
// Every scenario drives the REAL POSIX checker
// (swarmforge/scripts/daemon_log_freshness_check.sh) as a subprocess against a
// real temp checkout, the same convention BL-1011/BL-1012's handlers for this
// same script already established - the defect was about WHICH BYTES a shell
// command reads, so nothing short of running it can answer these. Scenarios
// 01/02 also probe heartbeat_age_secs directly (bl1413_heartbeat_age_probe.sh)
// to assert the exact "measured age" the feature text names - a healthy run
// through the checker leaves no external trace of the precise number.
//
// CONF: uses the SHIPPED daemon_log_freshness.conf/_required.conf, never a
// scoped fixture conf. BL-784's registry guard (called unconditionally by the
// real checker) also scans the REAL swarmforge/scripts/*_supervisor.bb files
// on disk and fails closed on any one missing a conf row - a fixture-scoped
// conf can satisfy the "every required name has a row" half but never that
// second, disk-scanning half, since it is not parameterized by FRESHNESS_CONF
// at all. Every daemon this suite does not care about is simply left with no
// pid file, which BL-784 already skips outright before ever measuring it.
//
// SAFETY: kill/start/announce are all stubbed to append to files under the
// fixture root; no real daemon is ever signalled or started. Scenario 04's
// five sleep(60) children are real PIDs (required so the *_supervisor
// missing-pid skip, BL-784, does not short-circuit the check before it ever
// reads their log) but are never the thing under test and are killed after.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const FEATURE = "BL-1413 The freshness check measures a heartbeat log from its newest heartbeat line, whatever bytes the file carries";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHECKER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_log_freshness_check.sh');
const PROBE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'bl1413_heartbeat_age_probe.sh');
const FIXTURES_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'fixtures', 'bl1413');

// Pinned, never a live clock (same posture as BL-1011's PINNED_EPOCH).
const NOW_EPOCH = 1700000000;

function isoAt(offsetSeconds) {
  return new Date((NOW_EPOCH - offsetSeconds) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
}

function handoffdLogPath(root) {
  return path.join(root, '.swarmforge', 'daemon', 'handoffd.log');
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1413acc-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  // babysitterd is in the shipped required registry with no pid-file skip
  // (only *_supervisor rows get that) - a fresh heartbeat keeps it out of
  // every scenario's way.
  fs.writeFileSync(path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log'), `${isoAt(0)} heartbeat\n`);
  return root;
}

function probeAge(logFile) {
  const out = execFileSync('/bin/sh', [PROBE, CHECKER, logFile], {
    env: { PATH: process.env.PATH, NOW: String(NOW_EPOCH) },
    encoding: 'utf8',
  }).trim();
  const [age, reason] = out.split(' ');
  return { age: Number(age), reason };
}

function runChecker(root) {
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    FRESHNESS_ROOT: root,
    FRESHNESS_NOW_EPOCH: String(NOW_EPOCH),
    FRESHNESS_INCIDENT_FILE: path.join(root, 'incidents.log'),
    FRESHNESS_COOL_OFF_SECS: '300',
    FRESHNESS_LOAD: '1',
    FRESHNESS_CORES: '1',
    FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${root}/announces.log"`,
    FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${root}/kills.log"`,
    FRESHNESS_START_CMD: `printf '%s %s\\n' "$1" "$2" >> "${root}/starts.log"`,
  };
  execFileSync('/bin/sh', [CHECKER], { env, encoding: 'utf8' });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return {
    announced: read(path.join(root, 'announces.log')),
    incidents: read(path.join(root, 'incidents.log')),
    kills: read(path.join(root, 'kills.log')),
    starts: read(path.join(root, 'starts.log')),
  };
}

function ensureCtx(ctx) {
  if (!ctx.bl1413) {
    ctx.bl1413 = { root: makeRoot(), supervisors: false, children: [] };
  }
  return ctx.bl1413;
}

// Shipped daemon_log_freshness.conf paths for the five live supervisors this
// ticket's incident named.
const SUPERVISOR_FIXTURES = [
  ['handoffd-supervisor.trimmed.log', ['.swarmforge', 'daemon', 'handoffd-supervisor.log'], ['.swarmforge', 'daemon', 'handoffd-supervisor.pid']],
  ['front-desk-supervisor.trimmed.log', ['.swarmforge', 'operator', 'front-desk-supervisor.log'], ['.swarmforge', 'operator', 'front-desk-supervisor.pid']],
  ['cursor-bridge-supervisor.trimmed.log', ['.swarmforge', 'operator', 'cursor-bridge-supervisor.log'], ['.swarmforge', 'operator', 'cursor-bridge-supervisor.pid']],
  ['onboarder-supervisor.trimmed.log', ['.swarmforge', 'operator', 'onboarder-supervisor.log'], ['.swarmforge', 'operator', 'onboarder-supervisor.pid']],
  ['operator-runtime-supervisor.trimmed.log', ['.swarmforge', 'operator', 'operator-runtime-supervisor.log'], ['.swarmforge', 'operator', 'operator-runtime-supervisor.pid']],
];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a watched daemon whose log carries heartbeat lines from a fixture clock$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the log holds old heartbeat lines, then one NUL-filled line, then a heartbeat 10 seconds ago$/, (ctx) => {
    const state = ensureCtx(ctx);
    const content = Buffer.concat([
      Buffer.from(`${isoAt(500)} heartbeat\n`),
      Buffer.from(`${isoAt(400)} heartbeat\n`),
      Buffer.from(`${isoAt(300)} heartbeat\n`),
      Buffer.from([0, 0, 0]),
      Buffer.from(`\n${isoAt(10)} heartbeat\n`),
    ]);
    fs.writeFileSync(handoffdLogPath(state.root), content);
    state.expectedAge = 10;
  });

  scoped(/^the log holds a heartbeat 20 seconds ago followed by one NUL-filled line$/, (ctx) => {
    const state = ensureCtx(ctx);
    const content = Buffer.concat([Buffer.from(`${isoAt(20)} heartbeat\n`), Buffer.from([0, 0, 0])]);
    fs.writeFileSync(handoffdLogPath(state.root), content);
    state.expectedAge = 20;
  });

  scoped(/^the log holds a heartbeat older than the daemon's threshold and a NUL-filled line before it$/, (ctx) => {
    const state = ensureCtx(ctx);
    // handoffd's shipped threshold is 120s - 200s is unambiguously past it.
    const content = Buffer.concat([Buffer.from([0, 0, 0]), Buffer.from(`\n${isoAt(200)} heartbeat\n`)]);
    fs.writeFileSync(handoffdLogPath(state.root), content);
    state.expectedAge = 200;
  });

  scoped(/^the five supervisor logs as they stood on 2026-09-05, each with its NUL-filled line$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.supervisors = true;
    fs.writeFileSync(handoffdLogPath(state.root), `${isoAt(0)} heartbeat\n`);

    const recentTs = isoAt(10);
    for (const [src, logRel, pidRel] of SUPERVISOR_FIXTURES) {
      const dest = path.join(state.root, ...logRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(FIXTURES_DIR, src), dest);
      fs.appendFileSync(dest, `${recentTs} heartbeat\n`);
      // A pid file naming a REAL live process - *_supervisor rows are
      // skipped entirely when their pid file is absent (BL-784), which
      // would make this scenario pass trivially without ever reaching
      // heartbeat_age_secs. negotiation_relay_supervisor and
      // bridge_headless_supervisor are deliberately left pid-less: this
      // incident never touched them, and BL-784's skip is exactly what
      // keeps them out of the way.
      const child = spawn('sleep', ['60'], { stdio: 'ignore' });
      state.children.push(child);
      fs.writeFileSync(path.join(state.root, ...pidRel), String(child.pid));
    }
  });

  scoped(/^the freshness check runs(?: with restart and announce stubbed)?$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.result = runChecker(state.root);
    if (!state.supervisors) {
      state.probed = probeAge(handoffdLogPath(state.root));
    }
  });

  scoped(/^the daemon's measured age is (\d+) seconds$/, (ctx, secs) => {
    const state = ensureCtx(ctx);
    assert.equal(state.probed.age, Number(secs), `measured age mismatch: ${JSON.stringify(state.probed)}`);
    assert.equal(state.probed.reason, 'stale-heartbeat');
  });

  scoped(/^no restart is performed and nothing is announced$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.result.kills, '', `expected no kill: ${state.result.kills}`);
    assert.equal(state.result.starts, '', `expected no restart: ${state.result.starts}`);
    assert.equal(state.result.announced, '', `expected no announce: ${state.result.announced}`);
  });

  scoped(/^the daemon is restarted and a FRESHNESS_VIOLATION restart is announced naming its real age$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(state.result.starts.includes('start_handoff_daemon.sh'), `expected a restart: ${JSON.stringify(state.result)}`);
    assert.ok(
      state.result.announced.includes(`FRESHNESS_VIOLATION restart swarm=primary daemon=handoffd age_secs=${state.expectedAge}`),
      `announce must name the real age (${state.expectedAge}), not the NUL sentinel: ${state.result.announced}`
    );
    assert.ok(!state.result.announced.includes('999999999'), 'announce must never carry the raw sentinel');
  });

  scoped(/^every supervisor's measured age is under its threshold$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.result.kills, '', `no supervisor should have been killed: ${state.result.kills}`);
  });

  scoped(/^neither stub is invoked$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.result.starts, '', `expected no restart: ${state.result.starts}`);
    assert.equal(state.result.announced, '', `expected no announce: ${state.result.announced}`);
    for (const child of state.children) {
      child.kill();
    }
  });
}

module.exports = { registerSteps };
