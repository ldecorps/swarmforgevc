'use strict';

// BL-1422: step handlers for "a Work dispatch cannot be completed without
// work or a stated reason". Drives the REAL done_with_current.sh (via
// done_with_current.bb -> done_with_current_task.bb) against a real git
// worktree + fixture mailbox - the same "shell out to the real guard"
// convention BL-1407's own acceptance handler and its sibling shell test
// (test_done_with_current_work_note_evidence.sh) use, since the defect
// lives in the completion helper's own filesystem/git plumbing, not in
// anything a reimplementation could stand in for.
//
// Fixture roots come from mkProcessTmpDir: the acceptance runner has no
// Vitest afterEach, and a scenario's root is needed across multiple steps,
// so no single step can safely clean up early (BL-1385/BL-1390) - no
// prefix-glob sweep anywhere.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1422 A Work dispatch cannot be completed without work or a stated reason';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

// A dequeued_at (and, for a sent-handoff's created_at, its own comparison
// point) far enough in the past that every commit THIS fixture makes "now"
// is unambiguously since it - each fixture gets its own fresh worktree
// (unlike the sibling shell test's single shared one), so there is no
// cross-scenario git-history contamination to guard against here.
const DEQUEUED_AT = '2020-01-01T00:00:00.000000000Z';

function makeFixture() {
  const root = mkProcessTmpDir('bl1422acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const taskWt = path.join(root, '.worktrees', 'taskrole');
  git(root, ['worktree', 'add', '-q', '-b', 'taskrole', taskWt]);

  const scriptsDir = path.join(taskWt, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    const full = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.statSync(full).isFile() && (name.endsWith('.bb') || name.endsWith('.sh'))) {
      fs.copyFileSync(full, path.join(scriptsDir, name));
      fs.chmodSync(path.join(scriptsDir, name), 0o755);
    }
  }
  // Stub ready_for_next so a completion cannot rotate/dequeue live roles.
  fs.writeFileSync(
    path.join(scriptsDir, 'ready_for_next_task.sh'),
    '#!/usr/bin/env zsh\necho "NO_TASK"\nexit 0\n',
    { mode: 0o755 }
  );

  const rolesLine = `taskrole\ttaskrole\t${taskWt}\tswarmforge-taskrole\tTaskrole\tclaude\ttask\n`;
  fs.mkdirSync(path.join(taskWt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(taskWt, '.swarmforge', 'roles.tsv'), rolesLine);

  const inProcess = path.join(taskWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const completed = path.join(taskWt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const sent = path.join(taskWt, '.swarmforge', 'handoffs', 'sent');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.mkdirSync(completed, { recursive: true });
  fs.mkdirSync(sent, { recursive: true });

  return {
    root,
    taskWt,
    inProcess,
    completed,
    sent,
    done: path.join(scriptsDir, 'done_with_current.sh'),
  };
}

function writeWorkNote(state, ticket, dir) {
  const target = dir || state.inProcess;
  const body = `Work ${ticket}-some-slug: read file in backlog/active`;
  fs.writeFileSync(
    path.join(target, '10_work.handoff'),
    `id: x\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 10\ntype: note\nmessage: ${body}\ndequeued_at: ${DEQUEUED_AT}\n\n${body}\n`
  );
}

function writeChaseNote(state, n, dir) {
  const target = dir || state.inProcess;
  const sha = `sha${String(n).padStart(7, '0')}`;
  const body = `branch behind ${sha}: dirty worktree - merge up`;
  const name = `10_chase_${String(n).padStart(3, '0')}.handoff`;
  fs.writeFileSync(
    path.join(target, name),
    `id: x${n}\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 10\ntype: note\nmessage: ${body}\ndequeued_at: ${DEQUEUED_AT}\n\n${body}\n`
  );
}

function writeGitHandoffItem(state) {
  fs.writeFileSync(
    path.join(state.inProcess, '00_handoff.handoff'),
    `id: x\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 00\ntype: git_handoff\nrole: coordinator\ntask: BL-9001-some-slug\ncommit: 0000000000\ndequeued_at: ${DEQUEUED_AT}\n\nmerge_and_process coordinator 0000000000\n`
  );
}

function writeSentHandoffFor(state, ticket) {
  fs.writeFileSync(
    path.join(state.sent, '50_sent.handoff'),
    `id: y\nfrom: taskrole\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: taskrole\ntask: ${ticket}-some-slug\ncommit: 1111111111\ncreated_at: 2026-09-05T00:00:00.000000000Z\n\nmerge_and_process taskrole 1111111111\n`
  );
}

function runDone(state, extraArgs) {
  try {
    const out = execFileSync('bash', [state.done, ...(extraArgs || [])], {
      cwd: state.taskWt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'taskrole' },
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureState(ctx) {
  if (!ctx.bl1422) ctx.bl1422 = makeFixture();
  return ctx.bl1422;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture role mailbox and worktree with a Work note for BL-9001 in in_process$/, (ctx) => {
    const state = ensureState(ctx);
    writeWorkNote(state, 'BL-9001');
  });

  // ── 01: refused with no evidence ─────────────────────────────────────────
  scoped(/^no commit naming BL-9001 on the role's branch since the dequeue and no git_handoff for BL-9001 sent$/, () => {
    // The Background fixture already carries neither - nothing to add.
  });

  // ── 02: evidence since the dequeue ───────────────────────────────────────
  scoped(/^a commit naming BL-9001 on the role's branch since the dequeue$/, (ctx) => {
    const state = ensureState(ctx);
    git(state.taskWt, ['commit', '-q', '--allow-empty', '-m', 'BL-9001: did the work']);
  });

  scoped(/^a git_handoff naming BL-9001 sent from the role since the dequeue$/, (ctx) => {
    const state = ensureState(ctx);
    writeSentHandoffFor(state, 'BL-9001');
  });

  // ── 03: no work, --no-work reason ────────────────────────────────────────
  scoped(/^no work since the dequeue$/, () => {
    // The Background fixture already carries no evidence - nothing to add.
  });

  // ── shared When: a plain done_with_current.sh call ───────────────────────
  scoped(/^the role runs done_with_current\.sh$/, (ctx) => {
    const state = ensureState(ctx);
    state.result = runDone(state);
  });

  scoped(/^the role runs done_with_current\.sh with --no-work and a reason$/, (ctx) => {
    const state = ensureState(ctx);
    state.result = runDone(state, ['--no-work', 'waiting on BL-9000']);
  });

  // ── 01: refusal assertions ────────────────────────────────────────────────
  scoped(/^the completion is refused naming BL-9001 and the two ways to proceed$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /BL-9001/, `refusal must name BL-9001: ${state.result.output}`);
    assert.match(state.result.output, /--no-work/, `refusal must mention --no-work: ${state.result.output}`);
    assert.match(
      state.result.output,
      /(do the work|send the parcel)/i,
      `refusal must mention doing the work / sending the parcel: ${state.result.output}`
    );
  });

  scoped(/^the Work note is still in in_process$/, (ctx) => {
    const state = ensureState(ctx);
    const p = path.join(state.inProcess, '10_work.handoff');
    assert.ok(fs.existsSync(p), 'expected the Work note to still be in in_process');
    assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /^completed_at:/m, 'completed_at must not be stamped');
  });

  // ── 02/03: completion assertions ─────────────────────────────────────────
  scoped(/^the Work note is completed$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    assert.match(state.result.output, /COMPLETED:/, `expected COMPLETED: ${state.result.output}`);
    assert.ok(
      fs.existsSync(path.join(state.completed, '10_work.handoff')),
      'expected the Work note in completed/'
    );
  });

  scoped(/^the completed file carries the reason under no_work_reason$/, (ctx) => {
    const state = ensureState(ctx);
    const text = fs.readFileSync(path.join(state.completed, '10_work.handoff'), 'utf8');
    assert.match(text, /^no_work_reason: waiting on BL-9000$/m, `expected no_work_reason on the completed file: ${text}`);
    assert.match(text, /^no_work_at: /m, `expected no_work_at on the completed file: ${text}`);
  });

  // ── 04: other items ───────────────────────────────────────────────────────
  scoped(/^the in_process item is a "branch behind <sha>: dirty worktree" note instead of the Work note$/, (ctx) => {
    const state = ensureState(ctx);
    fs.rmSync(path.join(state.inProcess, '10_work.handoff'), { force: true });
    writeChaseNote(state, 1);
    state.expectedCompletedName = '10_chase_001.handoff';
  });

  scoped(/^the in_process item is a git_handoff carrying a task instead of the Work note$/, (ctx) => {
    const state = ensureState(ctx);
    fs.rmSync(path.join(state.inProcess, '10_work.handoff'), { force: true });
    writeGitHandoffItem(state);
    state.expectedCompletedName = '00_handoff.handoff';
  });

  scoped(/^the item is completed$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    assert.match(state.result.output, /COMPLETED:/, `expected COMPLETED: ${state.result.output}`);
    assert.ok(
      fs.existsSync(path.join(state.completed, state.expectedCompletedName)),
      `expected ${state.expectedCompletedName} in completed/`
    );
  });

  // ── 05: burst stops at the first Work note ───────────────────────────────
  scoped(/^a queue of 28 chase notes with a Work note for BL-9001 among them$/, (ctx) => {
    const state = ensureState(ctx);
    fs.rmSync(path.join(state.inProcess, '10_work.handoff'), { force: true });
    const queueDir = fs.mkdtempSync(path.join(state.root, 'queue-'));
    for (let i = 1; i <= 28; i += 1) writeChaseNote(state, i, queueDir);
    writeWorkNote(state, 'BL-9001', queueDir);
    state.queue = fs
      .readdirSync(queueDir)
      .sort()
      .map((name) => path.join(queueDir, name));
  });

  scoped(/^the role runs done_with_current\.sh repeatedly with no work in between$/, (ctx) => {
    const state = ensureState(ctx);
    let completedCount = 0;
    let stoppedResult = null;
    for (const queued of state.queue) {
      fs.copyFileSync(queued, path.join(state.inProcess, path.basename(queued)));
      const result = runDone(state);
      if (result.status !== 0) {
        stoppedResult = result;
        break;
      }
      completedCount += 1;
    }
    state.burstCompletedCount = completedCount;
    state.result = stoppedResult;
  });

  scoped(/^every chase note before the Work note is completed$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.burstCompletedCount, 28, `expected 28 completions before the stop, got ${state.burstCompletedCount}`);
    const completedFiles = fs.readdirSync(state.completed);
    assert.equal(completedFiles.length, 28, `expected exactly 28 completed files, got: ${JSON.stringify(completedFiles)}`);
  });

  scoped(/^the burst stops at the Work note with the refusal$/, (ctx) => {
    const state = ensureState(ctx);
    assert.ok(state.result, 'expected the burst to have stopped with a result');
    assert.notEqual(state.result.status, 0, `expected a refusal to stop the burst: ${state.result.output}`);
    assert.match(state.result.output, /WORK_NOT_EVIDENCED/, `expected WORK_NOT_EVIDENCED: ${state.result.output}`);
    assert.ok(
      fs.existsSync(path.join(state.inProcess, '10_work.handoff')),
      'expected the Work note to still be in in_process after the burst stops'
    );
  });
}

module.exports = { registerSteps };
