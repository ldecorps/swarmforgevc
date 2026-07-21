const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, buildStatusQuery, composeTicketApprovalOverride, appendToReplyOutbox, main } = require('../out/tools/operator-decide');

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
  return fs.realpathSync(mkTmpDir('sfvc-operator-decide-cli-'));
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

// ── appendToReplyOutbox (real fs) - BL-440 ────────────────────────────────
// The unit tests in operatorDecideStatus.test.js/operatorEventQueue.test.js
// prove a FAKE reply callback receives the right flag, and that the wire
// format round-trips through a hand-written outbox fixture - neither
// proves this REAL writer (the one production call site QA's two bounces
// were about) actually puts the field on disk. Drive it directly.

test('appendToReplyOutbox writes retractsPendingQuestion:true on disk when passed true', () => {
  const root = initFixture();
  appendToReplyOutbox(root, 'BL-100', "Answered coder's gate: y.", true);
  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].retractsPendingQuestion, true);
});

test('appendToReplyOutbox omits retractsPendingQuestion for an ordinary reply, never defaulting it to false', () => {
  const root = initFixture();
  appendToReplyOutbox(root, 'SUP-1', 'hello');
  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.ok(!('retractsPendingQuestion' in lines[0]));
});

test('appendToReplyOutbox omits retractsPendingQuestion when explicitly passed false, never writing the key false', () => {
  const root = initFixture();
  appendToReplyOutbox(root, 'SUP-1', 'hello', false);
  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.ok(!('retractsPendingQuestion' in lines[0]));
});

// ── composeTicketApprovalOverride (pure) - BL-416 ─────────────────────────
// The old role-gate-only fallback answered ANY ticket-topic reply with a
// GLOBAL, ticket-blind "Nothing to approve right now." whenever no role was
// live-gated on this exact ticket - false for a successful approve (BL-412)
// and for a genuine question on a still-pending ticket (BL-414).

test('a role live-gated on this exact ticket defers to the original role-gate decision, untouched', () => {
  assert.equal(composeTicketApprovalOverride({ action: 'answer', role: 'coder' }, 'approve', true, 'BL-416'), undefined);
  assert.equal(composeTicketApprovalOverride({ action: 'ask-which', roles: ['coder', 'architect'] }, 'none', false, 'BL-416'), undefined);
});

test('approving a genuinely-pending ticket confirms success by name, never the generic fallback', () => {
  const reply = composeTicketApprovalOverride({ action: 'nothing' }, 'approve', true, 'BL-416');
  assert.match(reply, /BL-416/);
  assert.match(reply, /approved/i);
  assert.doesNotMatch(reply, /nothing to approve/i);
});

test('a non-keyword reply on a still-pending ticket reflects still-awaiting-approval, never the generic fallback', () => {
  const reply = composeTicketApprovalOverride({ action: 'nothing' }, 'none', true, 'BL-416');
  assert.match(reply, /BL-416/);
  assert.match(reply, /awaiting approval/i);
  assert.doesNotMatch(reply, /nothing to approve/i);
});

test('a non-keyword reply on a ticket that is genuinely not pending defers - the generic fallback is acceptable', () => {
  assert.equal(composeTicketApprovalOverride({ action: 'nothing' }, 'none', false, 'BL-416'), undefined);
});

test('reject/amend replies are left to the existing role-gate/generic path - out of this ticket\'s scope', () => {
  assert.equal(composeTicketApprovalOverride({ action: 'nothing' }, 'reject', true, 'BL-416'), undefined);
  assert.equal(composeTicketApprovalOverride({ action: 'nothing' }, 'amend', true, 'BL-416'), undefined);
});

// ── runApprove wiring (real fs fixture, in-process main()) - BL-416 ───────
// No tmux socket in the fixture -> computeRoleGateStatesLive reports every
// role ungated -> selectGateDecisionForTicket always falls to 'nothing' for
// these tickets, exercising exactly the branch the old fallback got wrong.

function writeBacklogTicket(root, folder, fileName, content) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

test('approving a genuinely-pending ticket via the CLI confirms success by name in the reply outbox', async () => {
  const root = initFixture();
  writeBacklogTicket(root, 'active', 'BL-940-slug.yaml', 'id: BL-940\ntitle: t\nhuman_approval: pending\n');

  await runCli(root, ['BL-940', 'approve', 'approve']);

  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].threadId, 'BL-940');
  assert.match(lines[0].text, /BL-940/);
  assert.match(lines[0].text, /approved/i);
  assert.doesNotMatch(lines[0].text, /nothing to approve/i);
});

test('a free-text reply on a still-pending ticket via the CLI reflects still-awaiting-approval, not the generic fallback', async () => {
  const root = initFixture();
  writeBacklogTicket(root, 'active', 'BL-941-slug.yaml', 'id: BL-941\ntitle: t\nhuman_approval: pending\n');

  await runCli(root, ['BL-941', 'approve', 'where', 'is', 'the', 'summary?']);

  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /BL-941/);
  assert.match(lines[0].text, /awaiting approval/i);
  assert.doesNotMatch(lines[0].text, /nothing to approve/i);
});

test('a free-text reply on a ticket that is genuinely not pending via the CLI gets the generic fallback', async () => {
  const root = initFixture();
  writeBacklogTicket(root, 'active', 'BL-942-slug.yaml', 'id: BL-942\ntitle: t\nhuman_approval: approved\n');

  await runCli(root, ['BL-942', 'approve', 'unrelated', 'question']);

  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /nothing to approve/i);
});

test('the pending determination via the CLI is scoped to the replying topic\'s own ticket, not a global slot', async () => {
  const root = initFixture();
  writeBacklogTicket(root, 'active', 'BL-943-slug.yaml', 'id: BL-943\ntitle: t\nhuman_approval: pending\n');
  writeBacklogTicket(root, 'active', 'BL-944-slug.yaml', 'id: BL-944\ntitle: t\nhuman_approval: approved\n');

  await runCli(root, ['BL-943', 'approve', 'a question about this one']);
  await runCli(root, ['BL-944', 'approve', 'a question about this one']);

  const lines = replyOutboxLines(root);
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /awaiting approval/i);
  assert.match(lines[1].text, /nothing to approve/i);
});
