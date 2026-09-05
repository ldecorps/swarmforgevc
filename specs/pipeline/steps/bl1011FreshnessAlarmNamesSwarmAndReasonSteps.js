'use strict';

// BL-1011: step handlers for "A freshness alarm names its swarm and why it
// fired".
//
// Every scenario drives the REAL POSIX checker
// (swarmforge/scripts/daemon_log_freshness_check.sh) as a subprocess against a
// real temp checkout, with kill/start/announce stubbed to touch files under
// that checkout. The defect was about WHICH BRANCH of that shell script
// computed a variable, so nothing short of running it can answer these.
//
// FIXTURE CONF: each root gets its own conf naming ONLY handoffd, the same
// per-fixture isolation BL-1012's handlers settled on. The shipped conf also
// lists babysitterd, whose log is absent in every fixture, so it would add a
// second log-absent violation to every run and drown the condition under test.
//
// SAFETY: FRESHNESS_KILL_CMD and FRESHNESS_START_CMD are stubbed to `true`, so
// no real daemon is ever signalled or started.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeGuardSatisfyingRows } = require('../../../extension/test/helpers/freshnessFixture');

const FEATURE = 'A freshness alarm names its swarm and why it fired';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHECKER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_log_freshness_check.sh');

const FIXTURE_CONF =
  'handoffd|120|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n';

// 2026-08-21T10:00:00Z. Pinned, never a live clock - and computed rather than
// guessed: an epoch that lands before the heartbeat makes the age negative and
// nothing alarms at all.
const PINNED_EPOCH = 1787306400;

// Explicit known values per the Scenario Outline handler rule. A row the
// handlers do not know is a hard failure, never a passthrough.
const KNOWN_LOG_STATES = new Map([
  ['is missing entirely', 'log-absent'],
  ['carries no heartbeat line', 'no-heartbeat-line'],
  ['carries an unparseable time', 'unparseable-timestamp'],
]);
const KNOWN_REASONS = new Set([...KNOWN_LOG_STATES.values(), 'stale-heartbeat']);

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1011acc-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, 'freshness.conf'), FIXTURE_CONF);
  // BL-1420: the registry guard's second arm walks the live scripts
  // directory for *_supervisor.bb with no seam - a fixture conf naming
  // only handoffd is refused the instant one exists on disk. One row +
  // fresh heartbeat per live supervisor (derived from the same glob the
  // guard walks), plus the FRESHNESS_REQUIRED registry the guard's first
  // arm reads, lets the guard pass on this fixture's own terms.
  writeGuardSatisfyingRows({
    root,
    daemonRelDir: '.swarmforge/daemon',
    confPath: path.join(root, 'freshness.conf'),
    requiredPath: path.join(root, 'freshness_required.conf'),
    requiredNames: ['handoffd'],
    nowEpoch: PINNED_EPOCH,
  });
  return root;
}

function writeLog(root, state) {
  const log = path.join(root, '.swarmforge', 'daemon', 'handoffd.log');
  if (state === 'log-absent') return;
  if (state === 'no-heartbeat-line') fs.writeFileSync(log, '2026-08-21T10:00:00Z handoffd started\n');
  else if (state === 'unparseable-timestamp') fs.writeFileSync(log, 'not-a-timestamp handoffd heartbeat\n');
  else if (state === 'stale-heartbeat') fs.writeFileSync(log, '2026-08-21T10:00:00Z handoffd heartbeat\n');
}

function runChecker(root, { nowEpoch, creds }) {
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    FRESHNESS_ROOT: root,
    FRESHNESS_CONF: path.join(root, 'freshness.conf'),
    FRESHNESS_REQUIRED: path.join(root, 'freshness_required.conf'),
    FRESHNESS_NOW_EPOCH: String(nowEpoch),
    FRESHNESS_INCIDENT_FILE: path.join(root, 'incidents.log'),
    FRESHNESS_COOL_OFF_SECS: '300',
    FRESHNESS_LOAD: '1',
    FRESHNESS_CORES: '1',
    FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${root}/announces.log"`,
    FRESHNESS_KILL_CMD: 'true',
    FRESHNESS_START_CMD: 'true',
  };
  if (creds) {
    env.TELEGRAM_BOT_TOKEN = 'already-set';
    env.TELEGRAM_CHAT_ID = '12345';
  }
  execFileSync('/bin/sh', [CHECKER], { env, encoding: 'utf8' });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return {
    announced: read(path.join(root, 'announces.log')),
    incidents: read(path.join(root, 'incidents.log')),
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a watched daemon "handoffd" with a threshold of (\d+) seconds$/, (ctx, threshold) => {
    assert.equal(Number(threshold), 120, 'the fixture conf pins handoffd at 120s; a different Example needs a different conf');
    ctx.creds = false;
    ctx.identity = null;
    ctx.logState = null;
  });

  scoped(/^the checkout's identity names swarm "?([^"\s]+)"?$/, (ctx, swarm) => {
    ctx.identity = swarm;
  });

  scoped(/^Telegram credentials are already set in the environment$/, (ctx) => {
    // The path that shipped broken: the swarm name was resolved only inside
    // the branch that FILLS IN missing credentials, so this path announced
    // anonymously.
    ctx.creds = true;
  });

  scoped(/^the daemon's log (is missing entirely|carries no heartbeat line|carries an unparseable time)$/, (ctx, state) => {
    assert.ok(KNOWN_LOG_STATES.has(state), `unknown log state "${state}" - the handlers know ${[...KNOWN_LOG_STATES.keys()]}`);
    ctx.logState = KNOWN_LOG_STATES.get(state);
    ctx.expectedAge = null;
  });

  scoped(/^the daemon's log carries a heartbeat (\d+) seconds old$/, (ctx, secs) => {
    ctx.logState = 'stale-heartbeat';
    ctx.expectedAge = Number(secs);
  });

  scoped(/^the freshness check reports a violation$/, (ctx) => {
    const root = makeRoot();
    try {
      if (ctx.identity) {
        fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'),
          `swarm_name\t${ctx.identity}\nswarm_mode\tautonomous\n`);
      }
      writeLog(root, ctx.logState);
      const nowEpoch = ctx.expectedAge === null ? 1800000000 : PINNED_EPOCH + ctx.expectedAge;
      ctx.result = runChecker(root, { nowEpoch, creds: ctx.creds });
      // A run that never alarmed would make every assertion below trivially
      // satisfiable, so the precondition is asserted rather than assumed.
      assert.match(ctx.result.announced, /FRESHNESS_VIOLATION/,
        `the fixture must actually produce a violation; announced: ${JSON.stringify(ctx.result.announced)}`);
    } finally {
      // Removed in a finally, never only after the last assertion.
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  scoped(/^the reported reason is "?([a-z-]+)"?$/, (ctx, reason) => {
    assert.ok(KNOWN_REASONS.has(reason), `unknown reason "${reason}" - the handlers know ${[...KNOWN_REASONS]}`);
    assert.ok(ctx.result.announced.includes(`reason=${reason}`),
      `the announced text must state which condition fired; got: ${ctx.result.announced}`);
  });

  scoped(/^the reported text contains no sentinel number$/, (ctx) => {
    assert.ok(!ctx.result.announced.includes('999999999'),
      `a value that is not an age must never render as a number; got: ${ctx.result.announced}`);
    // And the same on the durable channel - an operator reads both.
    assert.ok(!ctx.result.incidents.includes('999999999'),
      `the durable record must not carry the sentinel either; got: ${ctx.result.incidents}`);
  });

  scoped(/^the reported age is (\d+) seconds$/, (ctx, secs) => {
    assert.ok(ctx.result.announced.includes(`age_secs=${secs}`),
      `a measurable age must still report as a number - rendering everything "unknown" would hide it; got: ${ctx.result.announced}`);
  });

  scoped(/^the reported text names swarm "?([^"\s]+)"?$/, (ctx, swarm) => {
    assert.ok(ctx.result.announced.includes(`swarm=${swarm}`),
      `an alarm must be attributable to its sending swarm; got: ${ctx.result.announced}`);
  });

  scoped(/^the incident record names swarm "([^"]+)"$/, (ctx, swarm) => {
    assert.ok(ctx.result.incidents.includes(`swarm=${swarm}`),
      `the durable record must be attributable too - announce can fail, the record persists; got: ${ctx.result.incidents}`);
  });

  scoped(/^the incident record names the reason "([a-z-]+)"$/, (ctx, reason) => {
    assert.ok(ctx.result.incidents.includes(`reason=${reason}`),
      `the durable record must state the condition; got: ${ctx.result.incidents}`);
  });
}

module.exports = { registerSteps };
