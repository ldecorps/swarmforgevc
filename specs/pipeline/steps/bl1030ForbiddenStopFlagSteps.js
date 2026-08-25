'use strict';

// BL-1030: step handlers for "the expeditor's forbidden-stop-flag guard reads
// the configured command as a command line".
//
// Every scenario drives the REAL expeditor CLI (swarmforge/scripts/
// expedite_cli.bb) over the REAL fixture repo (swarmforge/scripts/test/
// expedite_fixture.sh), with EXPEDITE_STOP_CMD set to the Examples value. That
// is the whole point of this ticket: the defect survived four green unit
// assertions because they were written in a shape the caller could not
// produce, so a handler that called the predicate directly with its own
// hand-split arguments would reproduce the exact mistake being fixed.
//
// The three facts each scenario needs are read back from the fixture on disk,
// never inferred from the CLI's chatter:
//   did it refuse?          - the process exit code
//   did the stop command
//   run?                    - the stub's own invocation log
//   was anything parked?     - backlog/hold/ and backlog/active/
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');

// The fixture's probe seam: a recorded liveness answer, so no scenario here
// depends on whether a real swarm happens to be up on this host. Same shape
// test_expedite_cli.sh writes for its own stopped-swarm cases.
const PROBE_STOPPED = { 'tmux-servers-answering': 0, 'role-agents': 0 };

// BL-971: a fixture directory is swept by PREFIX before the run, not merely
// removed after it. Nothing traps SIGKILL, so a killed run leaves its tree
// behind; sweeping first bounds the leak to one run instead of forever.
const FIXTURE_PREFIX = 'bl1030-expedite-';

const RUN_TICKET = 'BL-567';
const SIBLING_TICKET = 'BL-590';
const STOP_LOG = path.join('.swarmforge', 'expedite-fixture', 'stop-invocations.log');

// BL-421: every Examples column value is validated against an explicit lookup,
// never passed through - a gherkin-mutator edit into an unrecognised command
// or flag must fail the scenario rather than slip into an else branch.
//
// Each entry says what the command IS, so the handler asserts against the
// ticket's own claim about it rather than against whatever the code returns.
const KNOWN_COMMANDS = {
  './stop-swarm.sh --sweep-inbox': { verdict: 'refused', flag: '--sweep-inbox' },
  './stop-swarm.sh --reset-worktrees': { verdict: 'refused', flag: '--reset-worktrees' },
  './stop-swarm.sh --full /repos/fixture-target': { verdict: 'refused', flag: '--full' },
  './stop-swarm.sh && ./stop-swarm.sh --full': { verdict: 'refused', flag: '--full' },
  './stop-swarm.sh': { verdict: 'admitted' },
  './stop-swarm.sh /repos/fixture-target': { verdict: 'admitted' },
  './stop-swarm.sh /repos/full-sweep-inbox-fix': { verdict: 'admitted' },
  "./stop-swarm.sh '--sweep-inbox": { verdict: 'unreadable' },
};

const KNOWN_FLAGS = new Set(['--sweep-inbox', '--reset-worktrees', '--full']);

function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const entry of fs.readdirSync(tmp)) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
    }
  }
}

function fixtureRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const made = spawnSync('bash', [FIXTURE, path.join(root, 'repo'), '--active', RUN_TICKET, '--active', SIBLING_TICKET], {
    encoding: 'utf8',
  });
  assert.equal(made.status, 0, `the expedite fixture failed to build:\n${made.stderr}`);
  const repo = path.join(root, 'repo');
  const probe = path.join(root, 'probe-stopped.json');
  fs.writeFileSync(probe, JSON.stringify(PROBE_STOPPED));
  return { repo, probe };
}

function listing(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function stopInvocations(repo) {
  const log = path.join(repo, STOP_LOG);
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

function registerSteps(registry) {
  const FEATURE = 'the expeditor\'s forbidden-stop-flag guard reads the configured command as a command line';
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  define(
    /^a repo with no live swarm, a fixture ticket in backlog\/active\/ and a second active ticket the run would park$/,
    (ctx) => {
      sweepStaleFixtures();
      const { repo, probe } = fixtureRoot();
      ctx.repo = repo;
      ctx.probe = probe;
      assert.deepEqual(
        listing(path.join(repo, 'backlog', 'active')),
        [`${RUN_TICKET}-fixture.yaml`, `${SIBLING_TICKET}-fixture.yaml`],
        'the fixture must start with both tickets active, or scenario 04 proves nothing'
      );
      assert.deepEqual(listing(path.join(repo, 'backlog', 'hold')), [], 'backlog/hold/ must start empty');
      assert.deepEqual(stopInvocations(repo), [], 'the stop stub must start with no recorded invocation');
      ctx.parcelsBefore = spawnSync('bash', ['-c', `find ${JSON.stringify(path.join(repo, '.swarmforge', 'handoffs'))} -name '*.handoff' | wc -l`], {
        encoding: 'utf8',
      }).stdout.trim();
      assert.notEqual(ctx.parcelsBefore, '0', 'the fixture must seed pending parcels - they are what --sweep-inbox would destroy');
    }
  );

  // ── Given ─────────────────────────────────────────────────────────────
  define(/^the configured stop command is (.+)$/, (ctx, command) => {
    const known = KNOWN_COMMANDS[command];
    assert.ok(known, `unknown configured command "${command}" - known: ${Object.keys(KNOWN_COMMANDS).join(' | ')}`);
    ctx.command = command;
    ctx.expected = known;
  });

  // ── When ──────────────────────────────────────────────────────────────
  define(/^the expeditor initiates the fixture ticket$/, (ctx) => {
    const run = spawnSync('bb', [CLI, ctx.repo, RUN_TICKET, '--no-restart'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EXPEDITE_PROBE_FILE: ctx.probe,
        EXPEDITE_STOP_CMD: ctx.command,
        EXPEDITE_START_CMD: './start-swarm.sh',
        EXPEDITE_STAGE_RUNNER: path.join(ctx.repo, 'stage-runner.sh'),
      },
    });
    ctx.exitCode = run.status;
    ctx.output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  });

  // ── Then: refused, naming the flag ────────────────────────────────────
  // The capture is `--flag`-shaped on purpose. A `(.+)` here would also match
  // scenario 03's "naming the command it could not read", and first-match-wins
  // resolution would run the wrong handler with prose as its flag.
  define(/^the expeditor refuses naming (--[a-z-]+) and the stop command never runs$/, (ctx, flag) => {
    assert.ok(KNOWN_FLAGS.has(flag), `unknown flag "${flag}" - known: ${[...KNOWN_FLAGS].join(', ')}`);
    assert.equal(ctx.expected.verdict, 'refused', `the Examples row for "${ctx.command}" is not a refusal case`);
    assert.equal(ctx.expected.flag, flag, `this row's command carries ${ctx.expected.flag}, not ${flag}`);

    assert.notEqual(ctx.exitCode, 0, `the expeditor admitted "${ctx.command}":\n${ctx.output}`);
    assert.match(ctx.output, /REFUSE stop command carries a forbidden flag/, ctx.output);
    assert.ok(
      ctx.output.includes(flag),
      `the refusal must name the flag that caused it; got:\n${ctx.output}`
    );
    assert.deepEqual(
      stopInvocations(ctx.repo),
      [],
      `the stop command ran despite being refused - this is the unrecoverable act the guard exists to prevent`
    );
  });

  // ── Then: admitted ────────────────────────────────────────────────────
  define(/^the stop command runs and initiation continues$/, (ctx) => {
    assert.equal(ctx.expected.verdict, 'admitted', `the Examples row for "${ctx.command}" is not an admitted case`);
    assert.ok(
      !/REFUSE stop command/.test(ctx.output),
      `a safe stop command was refused - a guard that refuses a legitimate path is one an operator works around:\n${ctx.output}`
    );
    assert.equal(
      stopInvocations(ctx.repo).length,
      1,
      `the stop command was admitted but never ran:\n${ctx.output}`
    );
    // Initiation continued: it got past the teardown probe to the stage work.
    assert.match(ctx.output, /teardown/, ctx.output);
  });

  // ── Then: unreadable ──────────────────────────────────────────────────
  define(
    /^the expeditor refuses naming the command it could not read and the stop command never runs$/,
    (ctx) => {
      assert.equal(ctx.expected.verdict, 'unreadable', `the Given for this scenario is not the unreadable case`);
      assert.notEqual(ctx.exitCode, 0, `the expeditor admitted a command it cannot read:\n${ctx.output}`);
      assert.match(ctx.output, /could not be read as a command line/, ctx.output);
      assert.ok(
        ctx.output.includes(ctx.command),
        `the refusal must name the command it could not read; got:\n${ctx.output}`
      );
      assert.deepEqual(stopInvocations(ctx.repo), [], 'an unreadable command was run anyway');
    }
  );

  // ── Then: a refusal costs nothing ─────────────────────────────────────
  define(/^the second active ticket is still in backlog\/active\/ and backlog\/hold\/ is empty$/, (ctx) => {
    assert.notEqual(ctx.exitCode, 0, 'this scenario needs a refusal to have happened');
    assert.deepEqual(
      listing(path.join(ctx.repo, 'backlog', 'hold')),
      [],
      'the refusal parked a sibling before deciding - a check that only reads an env var must cost nothing'
    );
    assert.deepEqual(
      listing(path.join(ctx.repo, 'backlog', 'active')),
      [`${RUN_TICKET}-fixture.yaml`, `${SIBLING_TICKET}-fixture.yaml`],
      'active/ moved during a refused run'
    );
    assert.deepEqual(stopInvocations(ctx.repo), [], 'the stop command ran during a refused run');
    const after = spawnSync(
      'bash',
      ['-c', `find ${JSON.stringify(path.join(ctx.repo, '.swarmforge', 'handoffs'))} -name '*.handoff' | wc -l`],
      { encoding: 'utf8' }
    ).stdout.trim();
    assert.equal(after, ctx.parcelsBefore, 'a refused run lost pending parcels');
  });
}

module.exports = { registerSteps };
