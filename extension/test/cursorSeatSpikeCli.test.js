'use strict';

// BL-713: the spike CLI — slice A's only live caller of the seat driver.
//
// main() is a thin wrapper (engineering.prompt's CLI rule): argument parsing,
// report formatting and exit-code selection are exported pure helpers tested
// directly, and main() itself is driven IN-PROCESS with a stubbed deps
// factory and stubbed cwd/argv — never process.chdir(), never a
// *_FORCE_RESULT env bypass.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  parseCursorSeatSpikeArgs,
  formatSeatRunReport,
  exitCodeForOutcome,
  seatHelperPath,
  readModelStewardRegistry,
  usageText,
  main,
  createLiveSeatDeps,
} = require('../out/tools/cursor-seat-spike');

// ── argument parsing ──────────────────────────────────────────────────────

test('the role is required and the rest default to the spike shape', () => {
  const args = parseCursorSeatSpikeArgs(['--role', 'documenter'], '/repo');
  assert.equal(args.role, 'documenter');
  assert.equal(args.repoRoot, '/repo');
  assert.equal(args.identity.provider, 'cursor');
  assert.equal(args.identity.model, 'auto');
  assert.equal(args.priority, '50');
});

test('every option can be given explicitly', () => {
  const args = parseCursorSeatSpikeArgs(
    ['--role', 'cleaner', '--repo', '/elsewhere', '--model', 'composer-1', '--provider', 'cursor', '--priority', '00', '--agent', 'claude'],
    '/repo'
  );
  assert.equal(args.role, 'cleaner');
  assert.equal(args.repoRoot, '/elsewhere');
  assert.equal(args.identity.model, 'composer-1');
  assert.equal(args.priority, '00');
  assert.equal(args.agent, 'claude');
});

test('a missing role is an argument error, not a run against a guessed role', () => {
  assert.throws(() => parseCursorSeatSpikeArgs([], '/repo'), /--role/);
});

test('a role outside the pipeline chain is refused by name', () => {
  assert.throws(() => parseCursorSeatSpikeArgs(['--role', 'janitor'], '/repo'), /janitor/);
});

test('a flag given with no value is refused rather than silently swallowing the next flag', () => {
  assert.throws(() => parseCursorSeatSpikeArgs(['--role'], '/repo'), /--role/);
  assert.throws(() => parseCursorSeatSpikeArgs(['--role', 'coder', '--model'], '/repo'), /--model/);
});

test('an unknown flag is refused, so a typo never runs a seat with defaults', () => {
  assert.throws(() => parseCursorSeatSpikeArgs(['--role', 'coder', '--rolle', 'x'], '/repo'), /--rolle/);
});

test('--help is recognised and the usage text names the spike-only escape', () => {
  assert.equal(parseCursorSeatSpikeArgs(['--help'], '/repo').help, true);
  assert.match(usageText(), /SWARMFORGE_CURSOR_SEAT_SPIKE/);
  assert.match(usageText(), /--role/);
});

test('the usage text is exactly this, line for line - a loose .match() cannot catch an emptied line', () => {
  assert.equal(
    usageText(),
    [
      'Usage: cursor-seat-spike --role <role> [--repo <path>] [--model <id>]',
      '                        [--provider <name>] [--agent <token>] [--priority <nn>]',
      '',
      'Drives ONE role seat over a Cursor agent session through ONE parcel:',
      'boot with the role prompt bundle, run ready_for_next.sh, do the stage',
      'work, forward through swarm_handoff.sh.',
      '',
      'Roles: specifier, coder, cleaner, architect, hardender, documenter, QA',
      '',
      'A Cursor identity that is not certified in the model steward registry is',
      'refused for a production pack. To run the spike with an uncertified',
      'candidate, set SWARMFORGE_CURSOR_SEAT_SPIKE=1.',
      '',
      'Exit codes: 0 forwarded or empty mailbox, 1 aborted, 2 refused, 64 bad arguments.',
    ].join('\n')
  );
});

// ── helper path resolution ────────────────────────────────────────────────

test('helpers are resolved inside the seat worktree, not the caller checkout', () => {
  assert.equal(
    seatHelperPath('/repo/.worktrees/documenter', 'ready_for_next'),
    '/repo/.worktrees/documenter/swarmforge/scripts/ready_for_next.sh'
  );
  assert.equal(
    seatHelperPath('/repo/.worktrees/documenter', 'swarm_handoff'),
    '/repo/.worktrees/documenter/swarmforge/scripts/swarm_handoff.sh'
  );
});

test('an unknown helper name is refused — the seat can call exactly two', () => {
  assert.throws(() => seatHelperPath('/repo', 'rotate_to_role'), /rotate_to_role/);
});

// ── registry read ─────────────────────────────────────────────────────────

test('the registry is read from the model steward path under the repo root', () => {
  const root = mkTmpDir('bl713-registry-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'model-steward'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'model-steward', 'registry.json'),
    JSON.stringify({ models: { 'cursor/auto': { status: 'candidate' } } })
  );
  const registry = readModelStewardRegistry(root);
  assert.equal(registry.models['cursor/auto'].status, 'candidate');
});

test('a missing or unparseable registry reads as undefined, so admission fails closed', () => {
  const root = mkTmpDir('bl713-registry-');
  assert.equal(readModelStewardRegistry(root), undefined);
  fs.mkdirSync(path.join(root, '.swarmforge', 'model-steward'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'model-steward', 'registry.json'), '{ not json');
  assert.equal(readModelStewardRegistry(root), undefined);
});

// ── report + exit code ────────────────────────────────────────────────────

const FORWARDED = {
  outcome: 'forwarded',
  reason: 'bl-999-a-thing forwarded to QA at abcdef0123',
  role: 'documenter',
  posture: 'spike',
  worktree: '/repo/.worktrees/documenter',
  forwardedTo: 'QA',
  transcriptPath: '/repo/.swarmforge/cursor-seat/documenter-x.transcript.md',
  decisions: [{ step: 'forward_handoff', fromSignal: 'stop_reason:completed', reason: 'finished' }],
  readyForNextCalls: 1,
};

test('the report names the outcome, the posture, the transcript and every decision', () => {
  const text = formatSeatRunReport(FORWARDED);
  assert.match(text, /forwarded/);
  assert.match(text, /documenter/);
  assert.match(text, /spike/);
  assert.match(text, /QA/);
  assert.match(text, /documenter-x\.transcript\.md/);
  assert.match(text, /stop_reason:completed/);
});

test('a refusal report names certification, since that is what the human must fix', () => {
  const text = formatSeatRunReport({
    outcome: 'refused_uncertified',
    reason: 'cursor/auto is not certified in the model steward registry (status: candidate)',
    role: 'documenter',
    posture: 'production',
    decisions: [],
    readyForNextCalls: 0,
  });
  assert.match(text, /not certified/);
  assert.match(text, /model steward registry/);
});

test('only a forward or an empty mailbox is a success exit', () => {
  assert.equal(exitCodeForOutcome({ outcome: 'forwarded' }), 0);
  assert.equal(exitCodeForOutcome({ outcome: 'no_task' }), 0);
  assert.equal(exitCodeForOutcome({ outcome: 'refused_uncertified' }), 2);
  assert.equal(exitCodeForOutcome({ outcome: 'aborted' }), 1);
});

// ── main(), in-process ────────────────────────────────────────────────────

function captureIo() {
  const out = [];
  return { out, write: (line) => out.push(line) };
}

test('main runs the seat once through the injected deps and prints the report', async () => {
  const io = captureIo();
  let seenOpts;
  const code = await main(['--role', 'documenter'], {
    cwd: '/repo',
    env: { SWARMFORGE_CURSOR_SEAT_SPIKE: '1' },
    write: io.write,
    createDeps: () => ({
      readRegistry: () => ({ models: {} }),
      composePromptBundle: async (role) => `bundle:${role}`,
      openSession: async () => ({ sessionId: 's1' }),
      sendTask: async () => ({
        signal: { kind: 'stop_reason', value: 'completed' },
        transcript: ['agent: done'],
        work: { task: 'bl-999-a-thing', commit: 'abcdef0123' },
      }),
      runHelper: async (name) =>
        name === 'ready_for_next'
          ? { exitCode: 0, stdout: 'TASK: /x\nFROM: coordinator\nTYPE: git_handoff\nPRIORITY: 50\nTASK_NAME: bl-999-a-thing\nPAYLOAD:\nbody\n' }
          : { exitCode: 0, stdout: '' },
      writeFile: () => {},
      now: () => 'STAMP',
    }),
    run: async (deps, opts) => {
      seenOpts = opts;
      const { runSeatOnce } = require('../out/swarm/cursorSeatDriver');
      return runSeatOnce(deps, opts);
    },
  });

  assert.equal(code, 0);
  assert.equal(seenOpts.role, 'documenter');
  assert.equal(seenOpts.repoRoot, '/repo');
  assert.match(io.out.join('\n'), /forwarded/);
});

test('main returns the refusal exit code when the identity is uncertified on a production pack', async () => {
  const io = captureIo();
  const code = await main(['--role', 'documenter'], {
    cwd: '/repo',
    env: {},
    write: io.write,
    createDeps: () => ({
      readRegistry: () => ({ models: {} }),
      composePromptBundle: async () => 'bundle',
      openSession: async () => {
        throw new Error('a refused run must never open a session');
      },
      sendTask: async () => {
        throw new Error('unreachable');
      },
      runHelper: async () => {
        throw new Error('a refused run must never call a helper');
      },
      writeFile: () => {},
      now: () => 'STAMP',
    }),
  });
  assert.equal(code, 2);
  assert.match(io.out.join('\n'), /not certified/);
});

test('main prints usage and succeeds for --help without touching the swarm', async () => {
  const io = captureIo();
  const code = await main(['--help'], {
    cwd: '/repo',
    env: {},
    write: io.write,
    createDeps: () => {
      throw new Error('--help must not build live deps');
    },
  });
  assert.equal(code, 0);
  assert.match(io.out.join('\n'), /SWARMFORGE_CURSOR_SEAT_SPIKE/);
});

test('an argument error is reported on its own exit code, with the usage text', async () => {
  const io = captureIo();
  const code = await main(['--role', 'janitor'], {
    cwd: '/repo',
    env: {},
    write: io.write,
    createDeps: () => {
      throw new Error('a bad argument must not build live deps');
    },
  });
  assert.equal(code, 64);
  assert.match(io.out.join('\n'), /janitor/);
});

// ── createLiveSeatDeps's runHelper (a real subprocess adapter) ─────────────
//
// Against a FIXTURE worktree with its own fake helper script — never the
// real ready_for_next.sh/swarm_handoff.sh, so this never touches a live
// swarm mailbox (the exact hazard the hardener's own standing lesson on
// bare sweep-harness invocations warns about).

function writeFixtureHelper(repoRoot, role, script, body) {
  const scriptsDir = path.join(repoRoot, '.worktrees', role, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const target = path.join(scriptsDir, script);
  fs.writeFileSync(target, body, { mode: 0o755 });
  return target;
}

test('runHelper reports exit 0 and the real stdout on a successful helper', async () => {
  const repoRoot = mkTmpDir('sfvc-bl713-runhelper-');
  writeFixtureHelper(repoRoot, 'documenter', 'ready_for_next.sh', '#!/bin/sh\necho NO_TASK\nexit 0\n');
  const deps = createLiveSeatDeps({ role: 'documenter', repoRoot, identity: { provider: 'cursor', model: 'auto' }, agent: 'claude', priority: '50' }, {});
  const result = await deps.runHelper('ready_for_next', []);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /NO_TASK/);
});

test('runHelper maps a non-zero helper exit to that exact code, with whatever it printed to stdout', async () => {
  const repoRoot = mkTmpDir('sfvc-bl713-runhelper-fail-');
  writeFixtureHelper(repoRoot, 'documenter', 'swarm_handoff.sh', '#!/bin/sh\necho "refused: quarantined"\nexit 3\n');
  const deps = createLiveSeatDeps({ role: 'documenter', repoRoot, identity: { provider: 'cursor', model: 'auto' }, agent: 'claude', priority: '50' }, {});
  const result = await deps.runHelper('swarm_handoff', ['./tmp/draft.txt']);
  assert.equal(result.exitCode, 3);
  assert.match(result.stdout, /refused: quarantined/);
});
