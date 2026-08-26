'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1133 invariants (coder-first authorship, BL-654). Drives REAL
// daemon_log_freshness_check.sh and reads REAL babysitterd.sh — never a
// parallel pulse reimplementation. Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECKER = path.join(SCRIPTS, 'daemon_log_freshness_check.sh');
const CONF = path.join(SCRIPTS, 'daemon_log_freshness.conf');
const DAEMON = path.join(SCRIPTS, 'babysitterd.sh');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');
const CHECK_BB = path.join(SCRIPTS, 'babysitter_check.bb');
const CACHE_HELPER = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');

function makeRoot() {
  const root = mkTmpDir('bl1133-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  return root;
}

function isoTimestamp(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
}

function runChecker(root, now) {
  return spawnSync('/bin/sh', [CHECKER], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      FRESHNESS_ROOT: root,
      FRESHNESS_CONF: CONF,
      FRESHNESS_NOW_EPOCH: String(now),
      FRESHNESS_LOAD: '1',
      FRESHNESS_CORES: '1',
      FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
      FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'announces.log')}"`,
      FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'kills.log')}"`,
      FRESHNESS_START_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'starts.log')}"`,
    },
  });
}

// ── Invariant 1 ──────────────────────────────────────────────────────────
// "A wedged babysitterd with no further heartbeat lines still trips
// stale-heartbeat past the configured threshold — this never weakens BL-675."
//
// Generator reach: ages from barely-stale (601) through multi-hour mute so a
// regression that only special-cased "moderately stale" still fails.
const muteAgeArb = fc.integer({ min: 601, max: 100000 });

test('property (invariant 1): mute babysitterd log past threshold always records stale-heartbeat', () => {
  fc.assert(
    fc.property(muteAgeArb, (muteAge) => {
      const root = makeRoot();
      const now = 1700000000;
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'daemon', 'handoffd.log'),
        `${isoTimestamp(now)} heartbeat\n`
      );
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log'),
        `${isoTimestamp(now - muteAge)} heartbeat\n`
      );
      fs.writeFileSync(path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid'), '1\n');

      const result = runChecker(root, now);
      assert.equal(result.status, 0, `checker exited nonzero: ${result.stderr}`);

      const incidents = path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log');
      assert.ok(fs.existsSync(incidents), 'expected incidents file');
      const text = fs.readFileSync(incidents, 'utf8');
      assert.match(text, /daemon=babysitterd/);
      assert.match(text, /reason=stale-heartbeat/);
    }),
    { numRuns: 20 }
  );
});

// Non-vacuous: a fresh heartbeat must NOT trip stale-heartbeat.
test('property (invariant 1 non-vacuous): fresh babysitterd heartbeat does not record stale-heartbeat', () => {
  const root = makeRoot();
  const now = 1700000000;
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'daemon', 'handoffd.log'),
    `${isoTimestamp(now)} heartbeat\n`
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log'),
    `${isoTimestamp(now - 30)} heartbeat\n`
  );
  const result = runChecker(root, now);
  assert.equal(result.status, 0);
  const incidents = path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log');
  if (fs.existsSync(incidents)) {
    const text = fs.readFileSync(incidents, 'utf8');
    assert.doesNotMatch(text, /daemon=babysitterd.*reason=stale-heartbeat|reason=stale-heartbeat.*daemon=babysitterd/);
    assert.ok(!/daemon=babysitterd/.test(text) || !/reason=stale-heartbeat/.test(text));
  }
});

// ── Invariant 2 ──────────────────────────────────────────────────────────
// "Pulses are content-free log lines only; the check never writes the git
// index/worktree."
//
// Executable encoding: pulse_heartbeat body is printf-only; a --tick-once
// against a disposable git root leaves the index/worktree clean. Generator
// reach: varies prior log noise length so truncation/path edges still hold.
const priorNoiseArb = fc.integer({ min: 0, max: 40 });

test('property (invariant 2): pulse_heartbeat is printf-only and tick leaves git clean', () => {
  fc.assert(
    fc.property(priorNoiseArb, (noiseLines) => {
      const src = fs.readFileSync(DAEMON, 'utf8');
      const helperMatch = src.match(/pulse_heartbeat\(\)\s*\{([\s\S]*?)\n\}/);
      assert.ok(helperMatch, 'pulse_heartbeat helper must exist');
      const body = helperMatch[1];
      assert.match(body, /printf.*heartbeat/);
      assert.doesNotMatch(body, /\bgit\b|\bindex\b|\bworktree\b|\badd\b|\bcommit\b/i);

      const root = makeRoot();
      spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], {
        cwd: root,
      });
      const log = path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log');
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.writeFileSync(log, `${'noise line\n'.repeat(noiseLines)}`);

      const tick = spawnSync('bash', [DAEMON, root, '--tick-once'], {
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, BABYSITTERD_INTERVAL_S: '1' },
      });
      assert.equal(tick.status, 0, `tick-once failed: ${tick.stderr || tick.stdout}`);

      // Pulse/check may create .swarmforge/ runtime dirs; the invariant is that
      // they never stage or mutate the git index/worktree of project files.
      const diff = spawnSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' });
      const cached = spawnSync('git', ['diff', '--cached', '--name-only'], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(diff.status, 0);
      assert.equal(cached.status, 0);
      assert.equal(diff.stdout.trim(), '', `worktree dirty after pulse/tick:\n${diff.stdout}`);
      assert.equal(cached.stdout.trim(), '', `index dirty after pulse/tick:\n${cached.stdout}`);

      const logText = fs.readFileSync(log, 'utf8');
      assert.ok((logText.match(/\bheartbeat\b/g) || []).length >= 2);
    }),
    { numRuns: 8 }
  );
});

// ── Invariant 3 ──────────────────────────────────────────────────────────
// "BL-1086 cache/batch semantics for pipeline-code-on-main are unchanged by
// this ticket."
//
// Executable encoding: this parcel must not alter the gather/cache surfaces
// (babysitter_check.sh cache path + sweep lib batch helpers). Pulse-only
// churn in babysitterd.sh is allowed; deleting or rewriting the BL-1086
// contract tokens is not.
test('property (invariant 3): BL-1086 cache/batch contract tokens remain in gather surfaces', () => {
  const checkSh = fs.readFileSync(CHECK_SH, 'utf8');
  const checkBb = fs.readFileSync(CHECK_BB, 'utf8');
  const sweepSrc = fs.readFileSync(CACHE_HELPER, 'utf8');
  const daemonSrc = fs.readFileSync(DAEMON, 'utf8');

  assert.match(checkSh, /babysitter_check\.bb/);
  assert.match(checkBb, /pipeline-code-on-main-cache/);
  assert.match(checkBb, /gather-pipeline-code-on-main-cached/);
  assert.match(sweepSrc, /pipeline-code-on-main/);
  // Pulse path must not absorb gather/cache logic into babysitterd.sh.
  assert.doesNotMatch(daemonSrc, /pipeline-code-on-main-cache\.json/);
  assert.match(daemonSrc, /pulse_heartbeat/);
});
