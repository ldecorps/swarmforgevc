'use strict';

// BL-1110 declared invariants (coder first authorship — BL-654):
//
// 1. A healthy handoffd delivery loop never ages its heartbeat past the
//    configured freshness budget without a logged, named stall cause —
//    mid-cycle sweep-marker progress is a named healthy cause (suppress).
// 2. Raising the handoffd freshness threshold is never the sole change
//    that closes this ticket — conf stays at 120 with a named root-cause.
//
// Non-vacuity: over-budget marker still restarts; deleting suppress path
// would fail invariant 1's healthy case. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECKER = path.join(SCRIPTS, 'daemon_log_freshness_check.sh');
const CONF = path.join(SCRIPTS, 'daemon_log_freshness.conf');

function isoAt(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function run(root, now) {
  execFileSync('/bin/sh', [CHECKER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FRESHNESS_ROOT: root,
      FRESHNESS_CONF: CONF,
      FRESHNESS_NOW_EPOCH: String(now),
      FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
      FRESHNESS_COOL_OFF_SECS: '300',
      FRESHNESS_LOAD: '1',
      FRESHNESS_CORES: '1',
      FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${root}/announces.log"`,
      FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${root}/kills.log"`,
      FRESHNESS_START_CMD: `printf '%s %s\\n' "$1" "$2" >> "${root}/starts.log"`,
    },
  });
}

function mkFixture(now, { ageSecs, markerAgeMs, sweep }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1110-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'daemon', 'handoffd.log'),
    `${isoAt(now - ageSecs)} heartbeat\n`
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log'),
    `${isoAt(now)} heartbeat\n`
  );
  if (sweep) {
    const started = now * 1000 - markerAgeMs;
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'daemon', 'handoffd.sweep-marker'),
      JSON.stringify({ sweep, started_at_ms: started }) + '\n'
    );
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'), '1\n');
  return root;
}

test(
  'BL-1110/BL-654 invariant 1: in-sweep progress suppresses stale-log restart; over-budget does not',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.boolean(), (underBudget) => {
        draws += 1;
        const now = 1700000000;
        const root = mkFixture(now, {
          ageSecs: 200,
          markerAgeMs: underBudget ? 50000 : 300000,
          sweep: 'chase-sweep',
        });
        run(root, now);
        const incidents = fs.readFileSync(
          path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
          'utf8'
        );
        if (underBudget) {
          assert.match(incidents, /suppress-in-sweep/);
          assert.doesNotMatch(incidents, /action=restart/);
        } else {
          assert.match(incidents, /action=restart/);
        }
      }),
      { numRuns: 4 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1110/BL-654 invariant 2: handoffd stays at 120 with named root-cause in checker',
  () => {
    const conf = fs.readFileSync(CONF, 'utf8');
    assert.match(conf, /^handoffd\|120\|/m);
    const checker = fs.readFileSync(CHECKER, 'utf8');
    assert.match(checker, /in_flight_sweep_under_budget/);
    assert.match(checker, /BL-1110/);
    // Non-vacuity: a sole threshold bump to 300 would fail the pin.
    assert.doesNotMatch(conf, /^handoffd\|300\|/m);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
