'use strict';

// BL-1645: step handlers for "A completion gate's evidence window opens
// when the inbound was created, not when it was dequeued". Drives the
// REAL done_with_current.sh (-> done_with_current_task.bb) against two
// real git worktrees (coder, architect) sharing one fixture repo - the
// same "shell out to the real guard" convention BL-1422's and BL-1609's
// own acceptance handlers use, since the defect lives in the completion
// helper's own filesystem/git/date plumbing.
//
// Fixture roots come from mkProcessTmpDir (no Vitest afterEach here, and a
// scenario's root is needed across multiple steps - BL-1385/BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE =
  "BL-1645 A completion gate's evidence window opens when the inbound was created, not when it was dequeued";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// The feature's own abstract clock labels, mapped to real ISO instants -
// well before this parcel's real commits, so no ambient repo history ever
// collides with these fixture timestamps.
const T = {
  '09:00': '2020-06-01T09:00:00.000000000Z',
  '10:00': '2020-06-01T10:00:00.000000000Z',
  '11:00': '2020-06-01T11:00:00.000000000Z',
  '12:00': '2020-06-01T12:00:00.000000000Z',
};

function git(root, args, env) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

function commitAt(root, subject, iso) {
  git(root, ['commit', '-q', '--allow-empty', '-m', subject], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
}

function makeWorktreeRole(root, role) {
  const wt = path.join(root, '.worktrees', role);
  git(root, ['worktree', 'add', '-q', '-b', role, wt]);
  const scriptsDir = path.join(wt, 'swarmforge', 'scripts');
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
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), `${role}\t${role}\t${wt}\tswarmforge-${role}\t${role}\tclaude\ttask\n`);

  const inProcess = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const completed = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const sent = path.join(wt, '.swarmforge', 'handoffs', 'sent');
  const outbox = path.join(wt, '.swarmforge', 'handoffs', 'outbox');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.mkdirSync(completed, { recursive: true });
  fs.mkdirSync(sent, { recursive: true });
  fs.mkdirSync(outbox, { recursive: true });

  return { role, wt, inProcess, completed, sent, outbox, done: path.join(scriptsDir, 'done_with_current.sh') };
}

function makeFixture() {
  const root = mkProcessTmpDir('bl1645acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-4242-fixture.yaml'),
    'id: BL-4242\nassigned_to: coder\nstatus: todo\n'
  );
  git(root, ['add', '-A']);
  commitAt(root, 'init', T['09:00']);

  return {
    root,
    coder: makeWorktreeRole(root, 'coder'),
    architect: makeWorktreeRole(root, 'architect'),
  };
}

function writeWorkNote(state, name, ticket, createdAt, dequeuedAt) {
  const body = `Work ${ticket}: read file in backlog/active`;
  fs.writeFileSync(
    path.join(state.coder.inProcess, name),
    `id: x\nfrom: coordinator\nto: coder\nrecipient: coder\npriority: 10\ntype: note\nmessage: ${body}\ncreated_at: ${createdAt}\nenqueued_at: ${createdAt}\ndequeued_at: ${dequeuedAt}\n\n${body}\n`
  );
}

function writeForwardingHandoff(state, name, ticket, createdAt, dequeuedAt) {
  fs.writeFileSync(
    path.join(state.architect.inProcess, name),
    `id: x\nfrom: coder\nto: architect\nrecipient: architect\npriority: 50\ntype: git_handoff\nrole: coder\ntask: ${ticket}\ncommit: 1111111111\ncreated_at: ${createdAt}\ndequeued_at: ${dequeuedAt}\n\nmerge_and_process coder 1111111111\n`
  );
}

function writeSentHandoff(state, ticket, createdAt) {
  fs.writeFileSync(
    path.join(state.architect.sent, '50_sent.handoff'),
    `id: y\nfrom: architect\nto: hardender\npriority: 50\ntype: git_handoff\nrole: architect\ntask: ${ticket}\ncommit: 2222222222\ncreated_at: ${createdAt}\n\nmerge_and_process architect 2222222222\n`
  );
}

function runDone(roleState, extraArgs) {
  try {
    const out = execFileSync('bash', [roleState.done, ...(extraArgs || [])], {
      cwd: roleState.wt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: roleState.role },
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureState(ctx) {
  if (!ctx.bl1645) ctx.bl1645 = makeFixture();
  return ctx.bl1645;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with a coder worktree and mailbox, an architect worktree and mailbox, and a fixture ticket BL-4242 active on main and assigned to coder$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  // ── Given: the inbound itself ────────────────────────────────────────
  scoped(/^a Work note for BL-4242 created at (\d\d:\d\d) and dequeued at (\d\d:\d\d)$/, (ctx, createdLabel, dequeuedLabel) => {
    const state = ensureState(ctx);
    writeWorkNote(state, '10_work.handoff', 'BL-4242', T[createdLabel], T[dequeuedLabel]);
    state.activeRole = 'coder';
    state.expectedFile = '10_work.handoff';
  });

  scoped(
    /^a forwarding git_handoff for BL-4242(?: to the architect)? created at (\d\d:\d\d) and dequeued at (\d\d:\d\d)$/,
    (ctx, createdLabel, dequeuedLabel) => {
      const state = ensureState(ctx);
      writeForwardingHandoff(state, '50_fwd.handoff', 'BL-4242', T[createdLabel], T[dequeuedLabel]);
      state.activeRole = 'architect';
      state.expectedFile = '50_fwd.handoff';
    }
  );

  // ── Given: evidence ───────────────────────────────────────────────────
  scoped(/^a commit whose subject leads with BL-4242 on the coder's branch at (\d\d:\d\d)$/, (ctx, atLabel) => {
    const state = ensureState(ctx);
    commitAt(state.coder.wt, 'BL-4242: did the work', T[atLabel]);
  });

  scoped(/^a git_handoff naming BL-4242 created at (\d\d:\d\d) sits in the architect's sent mailbox$/, (ctx, atLabel) => {
    const state = ensureState(ctx);
    writeSentHandoff(state, 'BL-4242', T[atLabel]);
  });

  scoped(/^a git_handoff naming BL-4242 in the architect's sent mailbox at (\d\d:\d\d)$/, (ctx, atLabel) => {
    const state = ensureState(ctx);
    writeSentHandoff(state, 'BL-4242', T[atLabel]);
  });

  scoped(/^no commit or git_handoff naming BL-4242 since \d\d:\d\d$/, () => {
    // The fixture already carries no evidence - nothing to add.
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the (coder|architect) runs done_with_current with no reason$/, (ctx, role) => {
    const state = ensureState(ctx);
    state.activeRole = role;
    state.result = runDone(state[role]);
  });

  scoped(/^the coder runs done_with_current with the reason not promoted yet$/, (ctx) => {
    const state = ensureState(ctx);
    state.activeRole = 'coder';
    state.result = runDone(state.coder, ['--no-work', 'not promoted yet']);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the note is completed with no no_work_reason header on the completed file$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion: ${state.result.output}`);
    const text = fs.readFileSync(path.join(state.coder.completed, '10_work.handoff'), 'utf8');
    assert.doesNotMatch(text, /^no_work_reason:/m, `expected no no_work_reason header: ${text}`);
  });

  scoped(/^the parcel is completed with no no_op_reason header on the completed file$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion: ${state.result.output}`);
    const text = fs.readFileSync(path.join(state.architect.completed, '50_fwd.handoff'), 'utf8');
    assert.doesNotMatch(text, /^no_op_reason:/m, `expected no no_op_reason header: ${text}`);
  });

  scoped(/^the completion is refused naming BL-4242 with nothing moved$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /BL-4242/, `expected BL-4242 named: ${state.result.output}`);
    const roleState = state[state.activeRole];
    assert.ok(
      fs.existsSync(path.join(roleState.inProcess, state.expectedFile)),
      'expected the inbound to still be in in_process'
    );
    assert.equal(fs.readdirSync(roleState.completed).length, 0, 'expected nothing moved to completed/');
  });

  scoped(/^the completion is refused naming BL-4242 as active on main with nothing moved$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /WORK_ACTIVE_ON_MAIN/, `expected WORK_ACTIVE_ON_MAIN: ${state.result.output}`);
    assert.match(state.result.output, /BL-4242/, `expected BL-4242 named: ${state.result.output}`);
    assert.ok(
      fs.existsSync(path.join(state.coder.inProcess, '10_work.handoff')),
      'expected the Work note to still be in in_process'
    );
    assert.equal(fs.readdirSync(state.coder.completed).length, 0, 'expected nothing moved to completed/');
  });

  // ── Scenario 05: static wiring check ──────────────────────────────────
  scoped(/^done_with_current_task\.bb, done_with_current_batch\.bb and forward_evidence_lib\.bb are inspected$/, (ctx) => {
    ctx.bl1645Sources = {
      task: fs.readFileSync(path.join(REAL_SCRIPTS_DIR, 'done_with_current_task.bb'), 'utf8'),
      batch: fs.readFileSync(path.join(REAL_SCRIPTS_DIR, 'done_with_current_batch.bb'), 'utf8'),
      lib: fs.readFileSync(path.join(REAL_SCRIPTS_DIR, 'forward_evidence_lib.bb'), 'utf8'),
    };
  });

  scoped(/^each gate call site takes its since bound from the same reader$/, (ctx) => {
    const { task, batch } = ctx.bl1645Sources;
    const taskCallSites = (task.match(/\(forward-evidence-lib\/inbound-window-start /g) || []).length;
    const batchCallSites = (batch.match(/\(forward-evidence-lib\/inbound-window-start /g) || []).length;
    assert.equal(
      taskCallSites,
      2,
      `expected 2 call sites (Work-note gate + forward gate) in done_with_current_task.bb, got ${taskCallSites}`
    );
    assert.equal(batchCallSites, 1, `expected 1 call site in done_with_current_batch.bb, got ${batchCallSites}`);
  });

  scoped(/^that reader prefers created_at, then enqueued_at, then dequeued_at$/, (ctx) => {
    const { lib } = ctx.bl1645Sources;
    const fnMatch = lib.match(/\(defn inbound-window-start[\s\S]*?\n\n/);
    assert.ok(fnMatch, 'expected to find inbound-window-start in forward_evidence_lib.bb');
    const body = fnMatch[0];
    const createdIdx = body.indexOf('"created_at"');
    const enqueuedIdx = body.indexOf('"enqueued_at"');
    const dequeuedIdx = body.indexOf('"dequeued_at"');
    assert.ok(
      createdIdx >= 0 && enqueuedIdx > createdIdx && dequeuedIdx > enqueuedIdx,
      `expected created_at before enqueued_at before dequeued_at in: ${body}`
    );
  });
}

module.exports = { registerSteps };
