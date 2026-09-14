'use strict';

// BL-1566: step handlers for "An Article 4.2 hold is a record QA resumes
// from". Drives the REAL machinery over a fixture root - qa_hold_cli.bb
// (open/status/close) and the two live callers, ready_for_next_task.bb and
// done_with_current_task.bb, invoked directly by their real repo path with
// SWARMFORGE_ROLE=QA (the ticket's own direction: "the two shell-outs run
// the real ready_for_next_task.bb and done_with_current_task.bb"). No
// worktree is created - a single git init root with a plain QA/
// subdirectory as its "worktree path" is enough, since every read this
// parcel wires (roles.tsv, backlog/, .swarmforge/qa-holds/) resolves via
// target-root (git-common-dir's parent), which is the SAME directory for
// every subdirectory of one plain repo - the same fixture shape
// bl983StageQueueSteps.js already uses for this reason.
//
// Fixture roots come from mkProcessTmpDir (BL-1385/BL-1390: no Vitest
// afterEach here, and a scenario's root is needed across multiple steps,
// so no single step can safely clean up early).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1566 An Article 4.2 hold is a record QA resumes from';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const QA_HOLD_CLI = path.join(SCRIPTS_DIR, 'qa_hold_cli.bb');
const READY_FOR_NEXT_TASK = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const DONE_WITH_CURRENT_TASK = path.join(SCRIPTS_DIR, 'done_with_current_task.bb');

const DEQUEUED_AT = '2020-01-01T00:00:00.000000000Z';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function makeFixture() {
  const root = mkProcessTmpDir('bl1566acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const qaDir = path.join(root, 'QA');
  const inProcess = path.join(qaDir, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const completed = path.join(qaDir, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const newDir = path.join(qaDir, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.mkdirSync(completed, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });

  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'standing-reds.tsv'), '');

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `QA\tQA\t${qaDir}\tswarmforge-QA\tQA\tclaude\ttask\n`
  );

  return { root, qaDir, inProcess, completed, newDir, holdReds: [], holdTask: null, holdCommit: null };
}

function ensureState(ctx) {
  if (!ctx.bl1566) ctx.bl1566 = makeFixture();
  return ctx.bl1566;
}

function qaEnv() {
  return { ...process.env, SWARMFORGE_ROLE: 'QA' };
}

function runQaHoldCli(state, args) {
  const res = spawnSync('bb', [QA_HOLD_CLI, state.root, ...args], {
    cwd: state.root,
    encoding: 'utf8',
    timeout: 60000,
    env: qaEnv(),
  });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function runReadyForNext(state) {
  const res = spawnSync('bb', [READY_FOR_NEXT_TASK], {
    cwd: state.qaDir,
    encoding: 'utf8',
    timeout: 60000,
    env: qaEnv(),
  });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function runDoneWithCurrent(state) {
  const res = spawnSync('bb', [DONE_WITH_CURRENT_TASK], {
    cwd: state.qaDir,
    encoding: 'utf8',
    timeout: 60000,
    env: qaEnv(),
  });
  return { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function writeNote(state, name) {
  fs.writeFileSync(
    path.join(state.inProcess, name),
    `id: r1\nfrom: coordinator\nto: QA\nrecipient: QA\npriority: 10\ntype: note\nmessage: resume land\ndequeued_at: ${DEQUEUED_AT}\n\nresume land\n`
  );
}

function writeGitHandoff(state, task, commit) {
  fs.writeFileSync(
    path.join(state.inProcess, '00_handoff.handoff'),
    `id: g1\nfrom: hardender\nto: QA\nrecipient: QA\npriority: 50\ntype: git_handoff\nrole: hardender\ntask: ${task}\ncommit: ${commit}\ndequeued_at: ${DEQUEUED_AT}\n\nmerge_and_process hardender ${commit}\n`
  );
}

function appendRegisterRow(state, file, ticket) {
  fs.appendFileSync(
    path.join(state.root, 'backlog', 'standing-reds.tsv'),
    `property\t${file}\t${ticket}\t2026-09-14\t\n`
  );
}

function placeTicket(state, ticket, folder) {
  fs.mkdirSync(path.join(state.root, 'backlog', folder), { recursive: true });
  fs.writeFileSync(path.join(state.root, 'backlog', folder, `${ticket}-x.yaml`), `id: ${ticket}\n`);
}

// The two reds this feature's Background always opens the hold with, owned
// by an open ticket each (BL-9001 in paused/, BL-9002 in active/) - the
// exact shape scenario 02's Examples row 2 proves releases a hold.
function releaseHold(state) {
  const owners = ['BL-9001', 'BL-9002'];
  const folders = ['paused', 'active'];
  state.holdReds.forEach((red, i) => {
    appendRegisterRow(state, red, owners[i]);
    placeTicket(state, owners[i], folders[i]);
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture project root with an empty standing-red register, empty backlog folders and a QA mailbox$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^QA has opened a hold for task "([^"]+)" on commit "([^"]+)" naming the reds "([^"]+)"$/, (ctx, task, commit, redsText) => {
    const state = ensureState(ctx);
    const reds = redsText.split(',').map((s) => s.trim());
    state.holdTask = task;
    state.holdCommit = commit;
    state.holdReds = reds;
    const result = runQaHoldCli(state, ['open', '--task', task, '--commit', commit, '--red', reds.join(','), '--evidence', commit]);
    assert.equal(result.status, 0, `expected the hold to open cleanly: ${result.output}`);
  });

  // ── 01: an open hold reports each red, no release ────────────────────
  scoped(/^the hold status is read$/, (ctx) => {
    const state = ensureState(ctx);
    state.statusResult = runQaHoldCli(state, ['status']);
  });

  scoped(/^it prints a HOLD line for "([^"]+)" with owner "([^"]+)"$/, (ctx, red, owner) => {
    const state = ensureState(ctx);
    const expected = `HOLD ${state.holdTask} ${state.holdCommit} red=${red} owner=${owner}`;
    assert.match(state.statusResult.output, new RegExp(`^${expected}$`, 'm'), `expected line "${expected}" in:\n${state.statusResult.output}`);
  });

  scoped(/^it prints no RELEASED line$/, (ctx) => {
    const state = ensureState(ctx);
    assert.doesNotMatch(state.statusResult.output, /^RELEASED /m, `expected no RELEASED line in:\n${state.statusResult.output}`);
  });

  // ── 02: the register releases a hold only when every red is owned ────
  scoped(/^the register names "([^"]+)" as the owner of "([^"]+)"$/, (ctx, owner, file) => {
    const state = ensureState(ctx);
    if (owner === 'none') return;
    appendRegisterRow(state, file, owner);
  });

  scoped(/^the ticket "([^"]+)" sits in "([^"]+)"$/, (ctx, ticket, folder) => {
    const state = ensureState(ctx);
    if (ticket === 'none' || folder === 'none') return;
    placeTicket(state, ticket, folder);
  });

  scoped(/^it (prints|does not print) the line "([^"]+)"$/, (ctx, verb, line) => {
    const state = ensureState(ctx);
    if (verb === 'prints') {
      assert.match(state.statusResult.output, new RegExp(`^${line}$`, 'm'), `expected line "${line}" in:\n${state.statusResult.output}`);
    } else {
      assert.doesNotMatch(state.statusResult.output, new RegExp(`^${line}$`, 'm'), `expected NO line "${line}" in:\n${state.statusResult.output}`);
    }
  });

  // ── shared: a released hold ───────────────────────────────────────────
  scoped(/^the hold for "([^"]+)" is released$/, (ctx) => {
    const state = ensureState(ctx);
    releaseHold(state);
  });

  // ── 03: a released hold refuses to let QA complete a note ────────────
  scoped(/^QA's in_process holds a note$/, (ctx) => {
    const state = ensureState(ctx);
    writeNote(state, '10_resume.handoff');
  });

  scoped(/^done_with_current runs as QA$/, (ctx) => {
    const state = ensureState(ctx);
    state.doneResult = runDoneWithCurrent(state);
  });

  scoped(/^it exits non-zero$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.doneResult.status, 0, `expected a refusal: ${state.doneResult.output}`);
  });

  scoped(/^it prints "([^"]+)"$/, (ctx, text) => {
    const state = ensureState(ctx);
    assert.match(state.doneResult.output, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `expected "${text}" in:\n${state.doneResult.output}`);
  });

  scoped(/^the note is still in QA's in_process$/, (ctx) => {
    const state = ensureState(ctx);
    const p = path.join(state.inProcess, '10_resume.handoff');
    assert.ok(fs.existsSync(p), 'expected the note to still be in in_process');
    assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /^completed_at:/m, 'completed_at must not be stamped');
  });

  // ── 04: an unreleased hold never blocks completing the parcel QA parks ─
  scoped(/^QA's in_process holds a git_handoff for task "([^"]+)"$/, (ctx, task) => {
    const state = ensureState(ctx);
    writeGitHandoff(state, task, state.holdCommit || 'abcdef0123');
  });

  scoped(/^it exits zero$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.doneResult.status, 0, `expected completion: ${state.doneResult.output}`);
  });

  scoped(/^QA's in_process is empty$/, (ctx) => {
    const state = ensureState(ctx);
    const remaining = fs.readdirSync(state.inProcess).filter((f) => f.endsWith('.handoff'));
    assert.deepEqual(remaining, [], `expected in_process to be empty, got: ${JSON.stringify(remaining)}`);
  });

  // ── 05: every QA turn prints a released hold before anything else ────
  scoped(/^QA's mailbox is empty$/, (ctx) => {
    const state = ensureState(ctx);
    const inProc = fs.readdirSync(state.inProcess).filter((f) => f.endsWith('.handoff'));
    const queued = fs.readdirSync(state.newDir).filter((f) => f.endsWith('.handoff'));
    assert.deepEqual(inProc, [], `expected in_process empty, got: ${JSON.stringify(inProc)}`);
    assert.deepEqual(queued, [], `expected new/ empty, got: ${JSON.stringify(queued)}`);
  });

  scoped(/^ready_for_next runs as QA$/, (ctx) => {
    const state = ensureState(ctx);
    state.readyResult = runReadyForNext(state);
  });

  scoped(/^its first output line is "([^"]+)"$/, (ctx, line) => {
    const state = ensureState(ctx);
    const firstLine = state.readyResult.output.split('\n')[0];
    assert.equal(firstLine, line, `expected first line "${line}", got: ${JSON.stringify(state.readyResult.output)}`);
  });

  scoped(/^its output also reports NO_TASK$/, (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.readyResult.output, /NO_TASK/, `expected NO_TASK in:\n${state.readyResult.output}`);
  });

  // ── 06: closing the hold with an outcome ends the block ───────────────
  scoped(/^QA closes the hold with outcome "([^"]+)"$/, (ctx, outcome) => {
    const state = ensureState(ctx);
    const result = runQaHoldCli(state, ['close', '--task', state.holdTask, '--outcome', outcome]);
    assert.equal(result.status, 0, `expected the close to succeed: ${result.output}`);
    state.closeOutcome = outcome;
  });

  scoped(/^the hold record sits under the closed holds with outcome "([^"]+)"$/, (ctx, outcome) => {
    const state = ensureState(ctx);
    const closedFile = path.join(state.root, '.swarmforge', 'qa-holds', 'closed', `${state.holdTask}.json`);
    assert.ok(fs.existsSync(closedFile), `expected a closed hold record at ${closedFile}`);
    const record = JSON.parse(fs.readFileSync(closedFile, 'utf8'));
    assert.equal(record.outcome, outcome);
    const openFile = path.join(state.root, '.swarmforge', 'qa-holds', `${state.holdTask}.json`);
    assert.ok(!fs.existsSync(openFile), 'expected the open hold record to be gone');
  });
}

module.exports = { registerSteps };
