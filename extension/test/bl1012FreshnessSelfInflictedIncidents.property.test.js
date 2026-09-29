const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

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
//
// BL-1399: and its OWN required-daemon registry beside it. The checker runs
// daemon_log_freshness_registry_guard.sh first (BL-784), which fails closed
// when a daemon in the REQUIRED list has no conf row. Left to itself the
// guard reads the LIVE daemon_log_freshness_required.conf out of the scripts
// directory, finds babysitterd with no row in this deliberately one-row conf,
// and refuses - three properties red on main with nothing wrong in the
// watchdog, the guard or the conf. FRESHNESS_REQUIRED is the seam the guard
// has read since it was written; using it keeps the isolation this fixture
// always intended rather than weakening it.
//
// The guard has a SECOND arm with no seam: it walks the live scripts
// directory for `*_supervisor.bb` and refuses any it cannot find a conf row
// for. `FRESHNESS_REQUIRED` alone therefore still leaves the fixture refused,
// now naming bridge_headless_supervisor. So the conf carries a row for each
// supervisor the guard will find - DERIVED from the same glob the guard walks
// rather than listed here, which is the whole lesson of BL-1398 - and each
// gets a fresh heartbeat in the fixture, so it is healthy and the watchdog
// takes no action on it. Only handoffd's age is varied, so every assertion
// below still reads handoffd's behaviour alone.
function supervisorNames() {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'))
    .filter((f) => f.endsWith('_supervisor.bb'))
    .map((f) => f.slice(0, -'.bb'.length))
    .sort();
}

function mkRoot(requiredNames = ['handoffd']) {
  const root = mkTmpDir('sfvc-bl1012-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  const rows = [
    `handoffd|${BASE}|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh`,
  ];
  for (const name of supervisorNames()) {
    rows.push(
      `${name}|${CEILING}|.swarmforge/daemon/${name}.log|.swarmforge/daemon/${name}.pid|noop.sh`,
    );
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'daemon', `${name}.log`),
      `${isoAt(NOW)} heartbeat\n`,
    );
  }
  fs.writeFileSync(path.join(root, 'freshness.conf'), `${rows.join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'freshness_required.conf'), `${requiredNames.join('\n')}\n`);
  return root;
}

// ageSecs === null means "no log at all" - what start_handoff_daemon.sh's own
// rotation leaves behind after a restart the checker itself performed.
function runChecker({ ageSecs, load, cores, lastRestartSecondsAgo, requiredNames, expectExit = 0 }) {
  const root = mkRoot(requiredNames);
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
        FRESHNESS_REQUIRED: path.join(root, 'freshness_required.conf'),
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
    assert.equal(
      result.status,
      expectExit,
      `checker exited ${result.status} (expected ${expectExit}): ${result.stderr}`,
    );
    const read = (rel) => {
      try {
        return fs.readFileSync(path.join(root, rel), 'utf8');
      } catch {
        return '';
      }
    };
    return {
      stderr: result.stderr || '',
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

// BL-1786: (load, cores) reach BOTH the capped and uncapped arms BY
// CONSTRUCTION - cores drawn first, then load constrained relative to it,
// so factor = max(1, floor(load/cores)) lands on the wanted side of the cap
// (factor <= 5 <=> load < 6*cores). At uniform odds over the ORIGINAL
// loadArb x coresArb only ~1 draw in 8 was uncapped, so 40 uniform runs
// commonly reached it fewer than 5 times - the BL-1760/BL-1763 recipe
// (helpers/reachFloors), not two independent uniform draws hoping to land
// on the rare side.
const uncappedCellArb = coresArb.chain((cores) =>
  fc.record({ cores: fc.constant(cores), load: fc.integer({ min: 0, max: 6 * cores - 1 }) })
);
const cappedCellArb = coresArb.chain((cores) =>
  fc.record({ cores: fc.constant(cores), load: fc.integer({ min: 6 * cores, max: 400 }) })
);

test('property (BL-1012 invariant 1): the effective threshold never exceeds the ceiling, and an age past the ceiling always restarts however contended the host', () => {
  const reach = { capped: 0, uncapped: 0 };
  const CELL_ARBS = [uncappedCellArb, cappedCellArb];
  const PER_CELL_RUNS = runsPerCell(40, CELL_ARBS.length);

  for (const cellArb of CELL_ARBS) {
    fc.assert(
      fc.property(cellArb, ({ load, cores }) => {
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
      { numRuns: PER_CELL_RUNS }
    );
  }

  // Reachability floor: a run that never generated a contention high enough to
  // hit the cap would be vacuously green about boundedness.
  assertReachFloor(reach, ['capped', 'uncapped'], 5, 'BL-1012 invariant 1 contention state');
});

// BL-1786: elapsed reaches BOTH sides of the grace window BY CONSTRUCTION.
// load/cores stay unconstrained arbitraries - this invariant's arm depends
// only on elapsed, so they need no per-cell shaping.
const insideGraceArb = fc.integer({ min: 1, max: GRACE - 1 });
const outsideGraceArb = fc.integer({ min: GRACE, max: 900 });

test('property (BL-1012 invariant 2): inside the post-restart grace window an absent log never restarts or announces, and outside it always does', () => {
  const reach = { inside: 0, outside: 0 };
  const CELL_ARBS = [insideGraceArb, outsideGraceArb];
  const PER_CELL_RUNS = runsPerCell(40, CELL_ARBS.length);

  for (const elapsedArb of CELL_ARBS) {
    fc.assert(
      fc.property(elapsedArb, loadArb, coresArb, (elapsed, load, cores) => {
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
      { numRuns: PER_CELL_RUNS }
    );
  }

  assertReachFloor(reach, ['inside', 'outside'], 5, 'BL-1012 invariant 2 grace state');
});

// BL-1786: the restart-shape and grace-shape cases reach BY CONSTRUCTION -
// two explicit cells, rather than a 50/50 fc.oneof coin flip.
const restartCaseArb = fc.record({ ageSecs: fc.integer({ min: 601, max: 5000 }), lastRestartSecondsAgo: fc.constant(null) });
const graceCaseArb = fc.record({ ageSecs: fc.constant(null), lastRestartSecondsAgo: fc.integer({ min: 1, max: 200 }) });

test('property (BL-1012 invariant 3): every incident record this run writes names both the effective threshold and the contention factor', () => {
  const reach = { restart: 0, grace: 0 };
  const CELL_ARBS = [restartCaseArb, graceCaseArb];
  const PER_CELL_RUNS = runsPerCell(30, CELL_ARBS.length);

  for (const caseArb of CELL_ARBS) {
    fc.assert(
      fc.property(caseArb, loadArb, coresArb, ({ ageSecs, lastRestartSecondsAgo }, load, cores) => {
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
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }

  // Both record-writing paths must be exercised: attribution that held only on
  // the restart path would leave the grace path unattributable.
  assertReachFloor(reach, ['restart', 'grace'], 3, 'BL-1012 invariant 3 record path');
});

// BL-1399: the seam isolates the fixture; it does not disarm the guard. A
// registry naming a daemon this fixture's conf does not carry must still be
// refused, naming it - the same fail-closed behaviour BL-784 built, proven
// against the fixture's own files rather than the live ones.
test('property (BL-1399): a fixture registry naming a daemon the conf lacks is still refused, naming it', () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z]{3,8}d$/), loadArb, coresArb, (extra, load, cores) => {
      // Constructed: the extra name is never handoffd, so every case is a
      // daemon the one-row conf genuinely lacks.
      fc.pre(extra !== 'handoffd');
      const { stderr } = runChecker({
        ageSecs: 10,
        load,
        cores,
        lastRestartSecondsAgo: null,
        requiredNames: ['handoffd', extra],
        expectExit: 1,
      });
      assert.match(stderr, /FRESHNESS_REGISTRY_GUARD/);
      assert.ok(stderr.includes(extra), `the refusal must name ${extra}: ${stderr}`);
    }),
    { numRuns: 10 },
  );
});
