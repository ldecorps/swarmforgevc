'use strict';

// BL-1012: step handlers for "The freshness watchdog stops manufacturing its
// own incidents".
//
// Every scenario drives the REAL POSIX checker
// (swarmforge/scripts/daemon_log_freshness_check.sh) against a disposable
// fixture root, through the script's own documented FRESHNESS_* env seams -
// never a reimplementation of its arithmetic in JavaScript. A parallel
// implementation here could agree with itself while the shipped cron script
// did something else entirely, which is the whole failure this ticket is
// about: a threshold nobody rechecked.
//
// FIXTURE CONF: each root gets its OWN conf pinned at handoffd|120, written
// beside the fixture rather than read from swarmforge/scripts/. That keeps
// these scenarios independent of an ops raise of the live
// daemon_log_freshness.conf. It is also the deliberate decision this ticket's
// notes asked for on the untracked
// swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf: that
// BL-373 hot-sync orphan aimed at the same goal with a single shared file,
// but nothing references it, it is not this ticket's to adopt, and a
// per-fixture conf gives stronger isolation. It is left exactly where it is,
// untouched and undeleted.
//
// SAFETY: kill/start/announce are all stubbed to append to files under the
// fixture root, so no real daemon is ever signalled or started.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHECKER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_log_freshness_check.sh');

const FEATURE = 'The freshness watchdog stops manufacturing its own incidents';

// A fixed clock, so nothing here reads the wall clock.
const NOW = 1700000000;
const BASE_THRESHOLD = 120;
// Older than the 600s ceiling, so a record is written at EVERY factor below -
// which is what lets scenario 01 read the computed effective threshold back
// off the real script rather than asserting an arithmetic restatement.
const ALWAYS_VIOLATING_AGE = 700;

// Scenario Outline handler rule: substituted parameters are validated against
// the closed sets the feature's own Examples use. An unknown row is a hard
// failure, never a passthrough that would silently assert nothing.
//
// "unreadable" is injected as a NON-NUMERIC signal, not as an empty string:
// empty means "seam not set", which correctly falls through to reading the
// real host and would make the row a function of this machine's load.
const KNOWN_FACTORS = new Map([
  ['1', { load: '1', cores: '1', effective: 120 }],
  ['2', { load: '2', cores: '1', effective: 240 }],
  ['4', { load: '4', cores: '1', effective: 480 }],
  ['20', { load: '20', cores: '1', effective: 600 }],
  ['unreadable', { load: 'unreadable', cores: 'unreadable', effective: 120 }],
]);

const KNOWN_OUTCOMES = new Set(['suppressed', 'announced']);

function isoAt(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1012-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'freshness.conf'),
    `handoffd|${BASE_THRESHOLD}|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n`
  );
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

// Every handler body runs through this so a failing assertion can never leak
// the fixture directory (engineering rule: an mkdtemp fixture is removed in a
// finally, never only after the last assertion).
function guarded(ctx, fn, { done = false } = {}) {
  try {
    fn();
  } catch (e) {
    cleanup(ctx);
    throw e;
  }
  if (done) {
    cleanup(ctx);
  }
}

function runChecker(ctx) {
  const root = ctx.root;
  const env = {
    ...process.env,
    FRESHNESS_ROOT: root,
    FRESHNESS_CONF: path.join(root, 'freshness.conf'),
    FRESHNESS_NOW_EPOCH: String(NOW),
    FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
    FRESHNESS_COOL_OFF_SECS: '300',
    FRESHNESS_LOAD: ctx.load,
    FRESHNESS_CORES: ctx.cores,
    FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${root}/announces.log"`,
    FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${root}/kills.log"`,
    FRESHNESS_START_CMD: `printf '%s %s\\n' "$1" "$2" >> "${root}/starts.log"`,
  };
  const result = spawnSync('/bin/sh', [CHECKER], { encoding: 'utf8', env });
  if (result.status !== 0) {
    throw new Error(`checker exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function readFileOr(root, rel, fallback = '') {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return fallback;
  }
}

function incidents(ctx) {
  return readFileOr(ctx.root, path.join('.swarmforge', 'daemon', 'freshness-incidents.log'));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a watched daemon "([^"]+)" with a base threshold of (\d+) seconds$/, (ctx, daemon, base) => {
    assert.equal(daemon, 'handoffd', `these handlers fixture only handoffd, not "${daemon}"`);
    assert.equal(Number(base), BASE_THRESHOLD, 'the fixture conf pins the base threshold - keep them in step');
    ctx.root = mkRoot();
    // Default contention: factor 1, i.e. today's behaviour, unless a Given
    // below overrides it. Never left to the host.
    ctx.load = '1';
    ctx.cores = '1';
    ctx.logMissing = false;
    ctx.age = null;
    ctx.restartedSecondsAgo = null;
  });

  // ── Givens ───────────────────────────────────────────────────────────
  scoped(/^the host contention factor is (.+)$/, (ctx, factor) => {
    guarded(ctx, () => {
      const known = KNOWN_FACTORS.get(factor);
      assert.ok(known, `unknown contention factor "${factor}" - the handlers know ${[...KNOWN_FACTORS.keys()]}`);
      ctx.load = known.load;
      ctx.cores = known.cores;
      ctx.expectedEffective = known.effective;
    });
  });

  scoped(/^the daemon's heartbeat is (\d+) seconds old$/, (ctx, age) => {
    guarded(ctx, () => {
      ctx.age = Number(age);
    });
  });

  scoped(/^the watchdog restarted the daemon (\d+) seconds ago$/, (ctx, elapsed) => {
    guarded(ctx, () => {
      ctx.restartedSecondsAgo = Number(elapsed);
    });
  });

  // The log is ABSENT, which is exactly what start_handoff_daemon.sh's own
  // rotation leaves behind after a restart the checker itself performed.
  scoped(/^the daemon's log is missing$/, (ctx) => {
    guarded(ctx, () => {
      ctx.logMissing = true;
    });
  });

  // ── Whens ────────────────────────────────────────────────────────────
  function stageAndRun(ctx) {
    if (!ctx.logMissing) {
      const age = ctx.age === null ? ALWAYS_VIOLATING_AGE : ctx.age;
      fs.writeFileSync(
        path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'),
        `${isoAt(NOW - age)} heartbeat\n`
      );
    }
    if (ctx.restartedSecondsAgo !== null) {
      fs.writeFileSync(
        path.join(ctx.root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
        `epoch=${NOW - ctx.restartedSecondsAgo} daemon=handoffd age_secs=999999999 threshold=${BASE_THRESHOLD} action=restart\n`
      );
    }
    runChecker(ctx);
  }

  // Both phrasings drive the SAME real checker. "the effective threshold is
  // computed" is not a separate entry point - the threshold is read back off
  // the incident record the real run writes, so scenario 01 asserts the
  // shipped arithmetic rather than a restatement of it.
  scoped(/^the effective threshold is computed$/, (ctx) => {
    guarded(ctx, () => stageAndRun(ctx));
  });

  scoped(/^the freshness check runs$/, (ctx) => {
    guarded(ctx, () => stageAndRun(ctx));
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^the effective threshold is (\d+) seconds$/, (ctx, expected) => {
    guarded(
      ctx,
      () => {
        const text = incidents(ctx);
        const match = text.match(/effective_threshold=(\d+)/);
        assert.ok(match, `no effective_threshold recorded - the record must name it:\n${text}`);
        assert.equal(Number(match[1]), Number(expected));
        // The row's own expectation and the handler's table must agree, or the
        // table could drift into asserting something the feature never said.
        assert.equal(Number(expected), ctx.expectedEffective);
      },
      { done: true }
    );
  });

  scoped(/^the daemon is restarted$/, (ctx) => {
    guarded(
      ctx,
      () => {
        const starts = readFileOr(ctx.root, 'starts.log');
        assert.match(starts, /start_handoff_daemon\.sh/, `the daemon was not restarted:\n${incidents(ctx)}`);
        assert.match(incidents(ctx), /action=restart/);
      },
      { done: true }
    );
  });

  scoped(/^the violation outcome is (\w+)$/, (ctx, outcome) => {
    guarded(
      ctx,
      () => {
        assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome "${outcome}" - the handlers know ${[...KNOWN_OUTCOMES]}`);
        const announces = readFileOr(ctx.root, 'announces.log');
        const starts = readFileOr(ctx.root, 'starts.log');
        if (outcome === 'suppressed') {
          assert.equal(announces.includes('daemon=handoffd'), false, `expected no announce, got:\n${announces}`);
          assert.equal(starts.includes('start_handoff_daemon.sh'), false, `expected no restart, got:\n${starts}`);
          // Suppressed is not silent: the decision is still recorded, so the
          // window is auditable rather than an invisible mute.
          assert.match(incidents(ctx), /action=grace/);
        } else {
          assert.match(announces, /daemon=handoffd/, `expected an announce, got:\n${announces}`);
        }
      },
      { done: true }
    );
  });

  scoped(/^the incident record names the effective threshold$/, (ctx) => {
    guarded(ctx, () => {
      assert.match(incidents(ctx), /effective_threshold=480/);
    });
  });

  scoped(/^the incident record names the contention factor$/, (ctx) => {
    guarded(
      ctx,
      () => {
        assert.match(incidents(ctx), /contention_factor=4/);
        // The base is still recorded alongside, so every reader that predates
        // this ticket keeps working.
        assert.match(incidents(ctx), new RegExp(`threshold=${BASE_THRESHOLD} `));
      },
      { done: true }
    );
  });
}

module.exports = { registerSteps };
