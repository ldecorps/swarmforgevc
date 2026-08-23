'use strict';

// BL-1030 declared invariant 3 (property authorship rests with the coder,
// first pass - BL-654): "A refusal changes nothing: no ticket has been parked
// and the stop command has not run."
//
// This is the half the pure predicate cannot speak to. The guard was not only
// reading the wrong thing - it was reading it in the wrong PLACE, downstream
// of park-others!, so a refusal exited with every other active ticket already
// moved to backlog/hold/ in the shared master checkout. Moving the check is
// the fix; this property is what holds it moved.
//
// So every draw runs the REAL expeditor CLI over a REAL fixture repo built by
// the REAL fixture script, and then reads the four facts back off disk rather
// than out of the CLI's chatter:
//
//   backlog/hold/                 must be empty
//   backlog/active/               must hold both tickets, unmoved
//   the stop stub's own log       must record no invocation
//   .swarmforge/handoffs/**       must still hold every seeded parcel
//
// That last one is the point of the whole ticket: --sweep-inbox archives
// exactly those parcels, and they are what a parked ticket needs in order to
// resume. A property that checked only the exit code would pass against a
// guard that refused loudly after doing the damage.
//
// Draws are deliberately few and each is a real subprocess run: the value here
// is covering both refusal REASONS against real filesystem effects, not volume.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - the guard moved back below park-others! in initiate! (its
//     position before this ticket): RED on the first draw, "a refused run
//     parked a sibling ticket".
//   break 2 - stop-stack! given back its own getenv instead of the checked
//     command, and called before the guard: RED, "the stop command ran during
//     a refused run".
//   break 3 - the unreadable branch of stop-invocation-verdict admitting: RED
//     on the first unbalanced-quote draw, "expected a refusal, got exit 0".
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');

const RUN_TICKET = 'BL-567';
const SIBLING_TICKET = 'BL-590';
const PROBE_STOPPED = { 'tmux-servers-answering': 0, 'role-agents': 0 };
const FORBIDDEN = ['--sweep-inbox', '--reset-worktrees', '--full'];

// Every root is allocated through the SHARED helper (BL-420), so the
// per-test afterEach sweep removes it even on a throw; the explicit rmSync
// calls below are the early-removal case that helper documents, keeping only
// one fixture tree on disk at a time across a multi-draw sweep. The prefix
// sweep on top of that is BL-971: nothing traps SIGKILL, so a killed run must
// not leave a tree for the next run to trip over.
const FIXTURE_PREFIX = 'bl1030-costs-nothing-';

const DRAWS = 8;

const rng = (() => {
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
const randInt = (n) => Math.floor(rng() * n);
const randNth = (xs) => xs[randInt(xs.length)];
const randWord = () => {
  let w = '';
  for (let i = 0, n = 3 + randInt(7); i < n; i += 1) w += String.fromCharCode(97 + randInt(26));
  return w;
};

// Both refusal reasons, constructed rather than hoped for. A sweep that only
// drew flagged commands would never exercise the fail-closed path, and it is
// the newer of the two.
function buildRefusedCommand(kind) {
  const flag = randNth(FORBIDDEN);
  if (kind === 'forbidden-flag') {
    const shape = randInt(3);
    if (shape === 0) return `./stop-swarm.sh ${flag}`;
    if (shape === 1) return `./stop-swarm.sh ${flag} /repos/${randWord()}`;
    return `./stop-swarm.sh && ./stop-swarm.sh ${flag}`;
  }
  const shape = randInt(3);
  if (shape === 0) return `./stop-swarm.sh '${flag}`;
  if (shape === 1) return `./stop-swarm.sh "${flag}`;
  return `./stop-swarm.sh $${randWord().toUpperCase()}`;
}

function sweepStaleFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function listing(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function parcels(repo) {
  const root = path.join(repo, '.swarmforge', 'handoffs');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.handoff')) found.push(path.relative(root, full));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return found.sort();
}

function stopInvocations(repo) {
  const log = path.join(repo, '.swarmforge', 'expedite-fixture', 'stop-invocations.log');
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

function runExpeditor(root, command) {
  const repo = path.join(root, 'repo');
  const made = spawnSync('bash', [FIXTURE, repo, '--active', RUN_TICKET, '--active', SIBLING_TICKET], {
    encoding: 'utf8',
  });
  assert.equal(made.status, 0, `the expedite fixture failed to build:\n${made.stderr}`);

  const probe = path.join(root, 'probe-stopped.json');
  fs.writeFileSync(probe, JSON.stringify(PROBE_STOPPED));

  const before = {
    active: listing(path.join(repo, 'backlog', 'active')),
    hold: listing(path.join(repo, 'backlog', 'hold')),
    parcels: parcels(repo),
  };
  assert.deepEqual(before.hold, [], 'the fixture must start with an empty hold/');
  assert.ok(before.parcels.length > 0, 'the fixture must seed parcels - they are what --sweep-inbox destroys');

  const run = spawnSync('bb', [CLI, repo, RUN_TICKET, '--no-restart'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPEDITE_PROBE_FILE: probe,
      EXPEDITE_STOP_CMD: command,
      EXPEDITE_START_CMD: './start-swarm.sh',
      EXPEDITE_STAGE_RUNNER: path.join(repo, 'stage-runner.sh'),
    },
  });

  return {
    repo,
    before,
    exitCode: run.status,
    output: `${run.stdout ?? ''}${run.stderr ?? ''}`,
    after: {
      active: listing(path.join(repo, 'backlog', 'active')),
      hold: listing(path.join(repo, 'backlog', 'hold')),
      parcels: parcels(repo),
      stops: stopInvocations(repo),
    },
  };
}

test('BL-1030/BL-654 invariant 3: a refusal changes nothing - nothing parked, nothing stopped, no parcel lost', () => {
  sweepStaleFixtures();
  const reached = { 'forbidden-flag': 0, unreadable: 0 };

  try {
    for (let i = 0; i < DRAWS; i += 1) {
      const kind = i % 2 === 0 ? 'forbidden-flag' : 'unreadable';
      const command = buildRefusedCommand(kind);
      const root = fs.realpathSync(mkTmpDir(FIXTURE_PREFIX));
      const r = runExpeditor(root, command);

      assert.notEqual(r.exitCode, 0, `expected a refusal, got exit ${r.exitCode} for: ${command}\n${r.output}`);
      assert.match(r.output, /REFUSE/, `a refusal must say so on the terminal: ${command}\n${r.output}`);
      reached[kind] += 1;

      assert.deepEqual(
        r.after.hold,
        [],
        `a refused run parked a sibling ticket - the check must be decided before anything moves: ${command}`
      );
      assert.deepEqual(
        r.after.active,
        r.before.active,
        `a refused run moved backlog/active/: ${command}`
      );
      assert.deepEqual(
        r.after.stops,
        [],
        `the stop command ran during a refused run - this is the unrecoverable act: ${command}`
      );
      assert.deepEqual(
        r.after.parcels,
        r.before.parcels,
        `a refused run lost the parcels a parked ticket needs to resume: ${command}`
      );

      fs.rmSync(root, { recursive: true, force: true });
    }
  } finally {
    // BL-971: removed in a finally, so a throw above leaks nothing.
    sweepStaleFixtures();
  }

  assert.ok(reached['forbidden-flag'] >= 3, `generator coverage: flagged refusals reached ${reached['forbidden-flag']} (floor 3)`);
  assert.ok(reached.unreadable >= 3, `generator coverage: unreadable refusals reached ${reached.unreadable} (floor 3)`);
});

test('BL-1030/BL-654 invariant 3, the other direction: an ADMITTED command really does stop the stack', () => {
  // Without this, "changes nothing" would be satisfied by a guard that refused
  // every command, and the whole sweep above would be vacuous.
  sweepStaleFixtures();
  const root = fs.realpathSync(mkTmpDir(FIXTURE_PREFIX));
  try {
    const r = runExpeditor(root, './stop-swarm.sh /repos/full-sweep-inbox-fix');
    assert.ok(!/REFUSE stop command/.test(r.output), `a safe look-alike path was refused:\n${r.output}`);
    assert.equal(r.after.stops.length, 1, `an admitted command never reached the stop stub:\n${r.output}`);
    assert.deepEqual(
      r.after.hold,
      [`${SIBLING_TICKET}-fixture.yaml`],
      `an admitted run must still park the sibling - that is the expeditor working:\n${r.output}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    sweepStaleFixtures();
  }
});
