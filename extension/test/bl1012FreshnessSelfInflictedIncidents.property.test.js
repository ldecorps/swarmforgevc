const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1012, declared invariants (coder-authored per the Invariants section of
// coder.prompt / BL-654). Runs ONLY via `npm run test:properties`.
//
//   1. Bounded - the effective threshold is capped by a finite ceiling. An
//      arbitrarily loaded host never earns an arbitrarily long window.
//   2. Never acts on evidence it destroyed - within the post-restart grace
//      window an absent/heartbeat-less log never produces a restart or an
//      announce, because the watchdog's own restart rotated that log away.
//   3. Attributable - every incident record names the effective threshold and
//      the contention factor that produced it.
//
// These drive the REAL POSIX checker through its documented FRESHNESS_* env
// seams, exactly as the BL-789 sibling property file already does for this
// same script. Re-deriving the arithmetic in JavaScript would let this file
// agree with itself while the shipped cron script did something else - which
// is precisely the class of fault this ticket exists to close.
//
// GENERATOR REACH: the assertions at the end of each property prove the
// generator actually reached the interesting states (capped vs uncapped,
// inside vs outside the grace window) rather than hoping it did.

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHECKER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_log_freshness_check.sh');

const NOW = 1700000000;
const BASE = 120;
const CEILING = 600;
const GRACE = 300;

function isoAt(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// A fixture root with its OWN conf pinned at handoffd|120, so these
// properties are independent of any ops change to the live conf.
function mkRoot() {
  const root = mkTmpDir('sfvc-bl1012-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'freshness.conf'),
    `handoffd|${BASE}|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n`
  );
  return root;
}

// ageSecs === null means "no log at all" - what start_handoff_daemon.sh's own
// rotation leaves behind after a restart the checker itself performed.
function runChecker({ ageSecs, load, cores, lastRestartSecondsAgo }) {
  const root = mkRoot();
  try {
    if (ageSecs !== null) {
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'daemon', 'handoffd.log'),
        `${isoAt(NOW - ageSecs)} heartbeat\n`
      );
    }
    if (lastRestartSecondsAgo !== null) {
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
        `epoch=${NOW - lastRestartSecondsAgo} daemon=handoffd age_secs=999999999 threshold=${BASE} action=restart\n`
      );
    }
    const result = spawnSync('/bin/sh', [CHECKER], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        FRESHNESS_ROOT: root,
        FRESHNESS_CONF: path.join(root, 'freshness.conf'),
        FRESHNESS_NOW_EPOCH: String(NOW),
        FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
        FRESHNESS_COOL_OFF_SECS: '300',
        FRESHNESS_RESTART_GRACE: String(GRACE),
        FRESHNESS_MAX_THRESHOLD_SECS: String(CEILING),
        FRESHNESS_LOAD: String(load),
        FRESHNESS_CORES: String(cores),
        FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'announces.log')}"`,
        FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'kills.log')}"`,
        FRESHNESS_START_CMD: `printf '%s %s\\n' "$1" "$2" >> "${path.join(root, 'starts.log')}"`,
      },
    });
    assert.equal(result.status, 0, `checker exited ${result.status}: ${result.stderr}`);
    const read = (rel) => {
      try {
        return fs.readFileSync(path.join(root, rel), 'utf8');
      } catch {
        return '';
      }
    };
    return {
      incidents: read(path.join('.swarmforge', 'daemon', 'freshness-incidents.log')),
      announces: read('announces.log'),
      starts: read('starts.log'),
    };
  } finally {
    // A throw above must never leak the fixture directory.
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The record this run appended (the seeded prior-restart line, when present,
// is always the first).
function lastRecord(incidents) {
  const lines = incidents.split('\n').filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

const loadArb = fc.integer({ min: 0, max: 400 });
const coresArb = fc.integer({ min: 1, max: 16 });

test('property (BL-1012 invariant 1): the effective threshold never exceeds the ceiling, and an age past the ceiling always restarts however contended the host', () => {
  const reach = { capped: 0, uncapped: 0 };

  fc.assert(
    fc.property(loadArb, coresArb, (load, cores) => {
      // An age past the ceiling: a genuinely dead daemon. It must be caught at
      // EVERY contention, which is what makes the bound a real bound.
      const { incidents, starts } = runChecker({
        ageSecs: CEILING + 1,
        load,
        cores,
        lastRestartSecondsAgo: null,
      });
      const record = lastRecord(incidents);
      const effective = Number(record.match(/effective_threshold=(\d+)/)?.[1]);
      const factor = Number(record.match(/contention_factor=(\d+)/)?.[1]);

      assert.ok(Number.isFinite(effective), `no effective_threshold recorded: ${record}`);
      assert.ok(effective <= CEILING, `effective ${effective} exceeded the ceiling ${CEILING}`);
      assert.ok(factor >= 1, `contention factor ${factor} fell below its floor of 1`);
      assert.ok(effective >= BASE, `effective ${effective} fell below the base ${BASE}`);
      assert.match(starts, /start_handoff_daemon\.sh/, `a dead daemon was not caught at load=${load} cores=${cores}`);

      if (BASE * factor > CEILING) {
        reach.capped += 1;
        assert.equal(effective, CEILING);
      } else {
        reach.uncapped += 1;
        assert.equal(effective, BASE * factor);
      }
    }),
    { numRuns: 40 }
  );

  // Reachability floor: a run that never generated a contention high enough to
  // hit the cap would be vacuously green about boundedness.
  assert.ok(reach.capped >= 5, `generator reached only ${reach.capped} capped states`);
  assert.ok(reach.uncapped >= 5, `generator reached only ${reach.uncapped} uncapped states`);
});

test('property (BL-1012 invariant 2): inside the post-restart grace window an absent log never restarts or announces, and outside it always does', () => {
  const reach = { inside: 0, outside: 0 };

  fc.assert(
    fc.property(fc.integer({ min: 1, max: 900 }), loadArb, coresArb, (elapsed, load, cores) => {
      const { incidents, announces, starts } = runChecker({
        ageSecs: null, // the log our own restart rotated away
        load,
        cores,
        lastRestartSecondsAgo: elapsed,
      });

      if (elapsed < GRACE) {
        reach.inside += 1;
        assert.equal(announces.includes('daemon=handoffd'), false, `announced inside the grace window (elapsed=${elapsed})`);
        assert.equal(starts.includes('start_handoff_daemon.sh'), false, `restarted inside the grace window (elapsed=${elapsed})`);
        // Suppressed is never silent - the decision stays auditable.
        assert.match(lastRecord(incidents), /action=grace/);
      } else {
        reach.outside += 1;
        // Past the grace window the absence is real evidence again. Whether it
        // escalates (still inside the cool-off) or restarts, it must SAY so.
        assert.match(announces, /daemon=handoffd/, `stayed silent past the grace window (elapsed=${elapsed})`);
      }
    }),
    { numRuns: 40 }
  );

  assert.ok(reach.inside >= 5, `generator reached only ${reach.inside} inside-grace states`);
  assert.ok(reach.outside >= 5, `generator reached only ${reach.outside} outside-grace states`);
});

test('property (BL-1012 invariant 3): every incident record this run writes names both the effective threshold and the contention factor', () => {
  const reach = { restart: 0, grace: 0 };

  fc.assert(
    fc.property(
      fc.oneof(
        fc.record({ ageSecs: fc.integer({ min: 601, max: 5000 }), lastRestartSecondsAgo: fc.constant(null) }),
        fc.record({ ageSecs: fc.constant(null), lastRestartSecondsAgo: fc.integer({ min: 1, max: 200 }) })
      ),
      loadArb,
      coresArb,
      ({ ageSecs, lastRestartSecondsAgo }, load, cores) => {
        const { incidents } = runChecker({ ageSecs, load, cores, lastRestartSecondsAgo });
        const record = lastRecord(incidents);

        assert.match(record, /effective_threshold=\d+/, `record omits the effective threshold: ${record}`);
        assert.match(record, /contention_factor=\d+/, `record omits the contention factor: ${record}`);
        // The base is still recorded alongside, so readers predating this
        // ticket keep working.
        assert.match(record, new RegExp(`threshold=${BASE} `), `record dropped the base threshold: ${record}`);

        if (record.includes('action=grace')) {
          reach.grace += 1;
        } else {
          reach.restart += 1;
        }
      }
    ),
    { numRuns: 30 }
  );

  // Both record-writing paths must be exercised: attribution that held only on
  // the restart path would leave the grace path unattributable.
  assert.ok(reach.restart >= 3, `generator reached only ${reach.restart} restart records`);
  assert.ok(reach.grace >= 3, `generator reached only ${reach.grace} grace records`);
});
