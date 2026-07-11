const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('../out/tools/operator-decide');

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

test('the compiled CLI answers a swarm-liveness status query and appends it to the reply outbox', () => {
  const root = initFixture();
  execFileSync('node', [CLI_PATH, 'SUP-1', 'status-swarm'], { cwd: root, encoding: 'utf8' });
  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].threadId, 'SUP-1');
  assert.match(lines[0].text, /dispatching/);
  assert.match(lines[0].text, /2/);
});

test('the compiled CLI exits non-zero with a usage message when args are missing', () => {
  const root = initFixture();
  assert.throws(() => execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' }), /Usage/);
});
