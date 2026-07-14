const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, buildStatusQuery, main } = require('../out/tools/operator-decide');

// ── parseArgs (pure) ─────────────────────────────────────────────────────

test('parseArgs reads a status-ticket command with its ticket id', () => {
  assert.deepEqual(parseArgs(['SUP-1', 'status-ticket', 'BL-100']), { mode: 'status-ticket', threadId: 'SUP-1', ticketId: 'BL-100' });
});

test('parseArgs reads a status-swarm command with no further args', () => {
  assert.deepEqual(parseArgs(['SUP-1', 'status-swarm']), { mode: 'status-swarm', threadId: 'SUP-1' });
});

test('parseArgs reads a status-gates command with no further args', () => {
  assert.deepEqual(parseArgs(['SUP-1', 'status-gates']), { mode: 'status-gates', threadId: 'SUP-1' });
});

test('parseArgs reads an approve command, joining multi-word answer text', () => {
  assert.deepEqual(parseArgs(['SUP-1', 'approve', 'yes', 'go', 'ahead']), { mode: 'approve', threadId: 'SUP-1', answerText: 'yes go ahead' });
});

test('parseArgs throws a usage error for a missing thread id', () => {
  assert.throws(() => parseArgs([]), /Usage/);
});

test('parseArgs throws a usage error for an unknown mode', () => {
  assert.throws(() => parseArgs(['SUP-1', 'nonsense']), /Usage/);
});

test('parseArgs throws a usage error for status-ticket with no ticket id', () => {
  assert.throws(() => parseArgs(['SUP-1', 'status-ticket']), /Usage/);
});

test('parseArgs throws a usage error for approve with no answer text', () => {
  assert.throws(() => parseArgs(['SUP-1', 'approve']), /Usage/);
});

// ── subprocess (real CLI, real fs, no live tmux/pane) ────────────────────
// Proves the argv -> resolveCliMainWorktreeContext -> composeStatusAnswer
// -> reply-outbox WIRING, not the already-tested projection/decision logic
// itself. status-swarm is the lightest real mode to fixture (only needs
// .swarmforge/roles.tsv + operator status.json, no backlog/git history).

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-operator-decide-cli-')));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'status.json'),
    JSON.stringify({ state: 'dispatching', agents_running: 2, pending_events: 1 })
  );
  return root;
}

// ── buildStatusQuery (real fixture fs/git, in-process) ───────────────────
// main()'s own per-mode projection wiring, split out during cleanup so
// main() itself stays a flat dispatch - exercised here directly against
// the same real fixture the subprocess tests below use, so it runs
// in-process (counted by coverage) instead of only through the CLI.

function fixtureCtx(root) {
  return { projectRoot: root, mainWorktreePath: root, roleWorktrees: [], reply: () => {} };
}

test('buildStatusQuery for status-ticket reads the real backlog projection', () => {
  const root = initFixture();
  const { query, projections } = buildStatusQuery({ mode: 'status-ticket', threadId: 'SUP-1', ticketId: 'BL-999' }, fixtureCtx(root));
  assert.deepEqual(query, { kind: 'ticket', ticketId: 'BL-999' });
  assert.ok(projections.backlog);
});

test('buildStatusQuery for status-swarm reads the real operator status.json', () => {
  const root = initFixture();
  const { query, projections } = buildStatusQuery({ mode: 'status-swarm', threadId: 'SUP-1' }, fixtureCtx(root));
  assert.deepEqual(query, { kind: 'swarm-liveness' });
  assert.equal(projections.operatorStatus.state, 'dispatching');
});

test('buildStatusQuery for status-gates reads the live pending-gate view', () => {
  const root = initFixture();
  const { query, projections } = buildStatusQuery({ mode: 'status-gates', threadId: 'SUP-1' }, fixtureCtx(root));
  assert.deepEqual(query, { kind: 'pending-gates' });
  assert.deepEqual(projections.pendingGates, []);
});

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'operator-decide.js');

function replyOutboxLines(root) {
  const file = path.join(root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Runs the REAL main() in-process (argv + cwd injected), so in-process
// coverage and mutation tooling can see the wiring a subprocess-only smoke
// test cannot (the engineering article's CLI main()-thin-wrapper rule).
// main() prints nothing on success (it only appends to the reply outbox
// file) and throws synchronously on a usage error, so no stdout mock is
// needed here - only process.argv/process.cwd(), ALWAYS restored in
// `finally` (non-negotiable: Vitest runs every test file in one worker
// process, so a test that leaves the cwd moved silently corrupts every
// test that runs after it).
async function runCli(root, argv) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  try {
    process.argv = ['node', CLI_PATH, ...argv];
    process.cwd = () => root;
    await main();
  } finally {
    process.argv = previousArgv;
    process.cwd = originalCwd;
  }
}

function runCliSubprocess(root, argv) {
  return execFileSync('node', [CLI_PATH, ...argv], { cwd: root, encoding: 'utf8' });
}

test('the CLI exits non-zero with a usage message when args are missing (in-process main() rejects)', async () => {
  const root = initFixture();
  await assert.rejects(() => runCli(root, []), /Usage/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result (swarm-liveness status appended to the reply outbox)', () => {
  const root = initFixture();
  runCliSubprocess(root, ['SUP-1', 'status-swarm']);
  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].threadId, 'SUP-1');
  assert.match(lines[0].text, /dispatching/);
  assert.match(lines[0].text, /2/);
});
