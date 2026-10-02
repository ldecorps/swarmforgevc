'use strict';

// BL-1834: a commit reachable from main or origin/main is never a role's
// work evidence for a Work note, however its subject reads. Drives the REAL
// done_with_current.sh (via done_with_current.bb -> done_with_current_task.bb)
// against a real git worktree + fixture mailbox - the same "shell out to the
// real guard" convention BL-1422's own acceptance handler
// (bl1422WorkNoteNotCompletedWithoutWorkSteps.js) uses, since the defect
// lives in the completion helper's own git-log plumbing, not in anything a
// reimplementation could stand in for.
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

const FEATURE = "BL-1834 a commit merged in from main is never a role's work evidence";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitUser(root, args) {
  return git(root, ['-c', 'user.email=test@test', '-c', 'user.name=test', ...args]);
}

// Every commit this fixture makes happens strictly after T (the Work note's
// dequeued_at) - T is set far enough in the past that "now" is unambiguous.
const DEQUEUED_AT = '2020-01-01T00:00:00.000000000Z';

function makeFixture() {
  const root = mkProcessTmpDir('bl1834acc-');
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

function writeWorkNote(state, ticket) {
  const body = `Work ${ticket}-some-slug: read file in backlog/active`;
  fs.writeFileSync(
    path.join(state.inProcess, '10_work.handoff'),
    `id: x\nfrom: coordinator\nto: taskrole\nrecipient: taskrole\npriority: 10\ntype: note\nmessage: ${body}\ndequeued_at: ${DEQUEUED_AT}\n\n${body}\n`
  );
}

function runDone(state) {
  try {
    const out = execFileSync('bash', [state.done], {
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
  if (!ctx.bl1834) ctx.bl1834 = makeFixture();
  return ctx.bl1834;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository whose main branch and role worktree share history$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^a Work note for BL-9001 created at T in the role's in_process$/, (ctx) => {
    const state = ensureState(ctx);
    writeWorkNote(state, 'BL-9001');
  });

  scoped(/^main gains a commit "([^"]+)" after T$/, (ctx, subject) => {
    const state = ensureState(ctx);
    gitUser(state.root, ['commit', '-q', '--allow-empty', '-m', subject]);
  });

  scoped(/^the role merges main with a (fast-forward|no-ff) merge$/, (ctx, kind) => {
    const state = ensureState(ctx);
    // The fixture worktree starts exactly at main's own tip (both branched
    // from the same init commit, nothing committed to taskrole yet), so a
    // true fast-forward is always possible here.
    if (kind === 'fast-forward') {
      git(state.taskWt, ['merge', '-q', '--ff-only', 'main']);
    } else {
      gitUser(state.taskWt, ['merge', '-q', '--no-ff', '-m', 'Merge main into taskrole.', 'main']);
    }
  });

  scoped(/^the role commits "([^"]+)" on its own branch after T$/, (ctx, subject) => {
    const state = ensureState(ctx);
    gitUser(state.taskWt, ['commit', '-q', '--allow-empty', '-m', subject]);
  });

  scoped(/^the role runs done_with_current\.sh$/, (ctx) => {
    const state = ensureState(ctx);
    state.result = runDone(state);
  });

  scoped(/^the completion is refused naming BL-9001$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /WORK_NOT_EVIDENCED/, `expected WORK_NOT_EVIDENCED: ${state.result.output}`);
    assert.match(state.result.output, /BL-9001/, `refusal must name BL-9001: ${state.result.output}`);
  });

  scoped(/^the Work note is still in in_process$/, (ctx) => {
    const state = ensureState(ctx);
    const p = path.join(state.inProcess, '10_work.handoff');
    assert.ok(fs.existsSync(p), 'expected the Work note to still be in in_process');
    assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /^completed_at:/m, 'completed_at must not be stamped');
  });

  scoped(/^the Work note is completed$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    assert.match(state.result.output, /COMPLETED:/, `expected COMPLETED: ${state.result.output}`);
    assert.ok(
      fs.existsSync(path.join(state.completed, '10_work.handoff')),
      'expected the Work note in completed/'
    );
  });
}

module.exports = { registerSteps };
