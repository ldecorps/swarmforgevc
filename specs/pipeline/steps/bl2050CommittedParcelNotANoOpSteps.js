'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-2050-a-parcel-that-committed-work-is-forwarded-never-completed-as-a-no-op.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Drives the REAL done_with_current.sh (-> done_with_current.bb ->
// done_with_current_task.bb) against a real git worktree + fixture
// mailbox - the same "shell out to the real guard" convention BL-1609's
// own acceptance handler uses, since BL-2050's defect lives in the
// completion helper's own filesystem/git plumbing. Fixture shape copied
// from bl1609ForwardingParcelNotCompletedWithNothingSentSteps.js (per this
// ticket's own instruction: copy the helpers it needs, never import
// across handler files) and trimmed to the two roles this feature's
// Background names: coder and QA, each a task role with its own worktree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-2050 A parcel that committed work is forwarded, never completed as a no-op";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const TICKET = 'BL-4242';
const REASON = 'work done, handoff written';

const KNOWN_ROLES = new Set(['coder', 'QA']);
const KNOWN_COMMITS = new Set(['a commit whose subject leads with BL-4242', 'no commit naming BL-4242']);
const KNOWN_OUTCOMES = new Set([
  'refused naming that commit and the git_handoff to send, with nothing moved',
  'completed recording the reason work done, handoff written',
]);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d+Z$/, '.000000000Z');
}

function installScripts(scriptsDir) {
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    const full = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.statSync(full).isFile() && (name.endsWith('.bb') || name.endsWith('.sh'))) {
      fs.copyFileSync(full, path.join(scriptsDir, name));
      fs.chmodSync(path.join(scriptsDir, name), 0o755);
    }
  }
  // Stub ready_for_next so completion cannot rotate/dequeue live roles.
  for (const stub of ['ready_for_next_task.sh', 'ready_for_next_batch.sh']) {
    fs.writeFileSync(path.join(scriptsDir, stub), '#!/usr/bin/env zsh\necho "NO_TASK"\nexit 0\n', {
      mode: 0o755,
    });
  }
}

function mailboxDirs(wt) {
  const base = path.join(wt, '.swarmforge', 'handoffs');
  return {
    inProcess: path.join(base, 'inbox', 'in_process'),
    completed: path.join(base, 'inbox', 'completed'),
    outbox: path.join(base, 'outbox'),
    sent: path.join(base, 'sent'),
  };
}

// Background: coder and QA, each a task role with its own worktree - two
// independent branches off one shared "main", exactly what
// landed_ticket_lib.bb's declaration-refs needs to resolve and exclude.
function buildFixture() {
  const root = mkProcessTmpDir('bl2050acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const wtByRole = {};
  for (const role of KNOWN_ROLES) {
    const wt = path.join(root, '.worktrees', role);
    git(root, ['worktree', 'add', '-q', '-b', role, wt]);
    installScripts(path.join(wt, 'swarmforge', 'scripts'));
    wtByRole[role] = wt;
  }

  const rolesLine = [...KNOWN_ROLES]
    .map((role) => `${role}\t${role}\t${wtByRole[role]}\tswarmforge-${role}\t${role}\tclaude\ttask\n`)
    .join('');
  for (const wt of [root, ...Object.values(wtByRole)]) {
    fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesLine);
  }

  const dirsByRole = {};
  for (const role of KNOWN_ROLES) {
    const dirs = mailboxDirs(wtByRole[role]);
    dirsByRole[role] = dirs;
    fs.mkdirSync(dirs.inProcess, { recursive: true });
    fs.mkdirSync(dirs.completed, { recursive: true });
    fs.mkdirSync(dirs.outbox, { recursive: true });
    fs.mkdirSync(dirs.sent, { recursive: true });
  }

  const doneShByRole = Object.fromEntries(
    [...KNOWN_ROLES].map((role) => [role, path.join(wtByRole[role], 'swarmforge', 'scripts', 'done_with_current.sh')])
  );

  return { root, dirsByRole, wtByRole, doneShByRole };
}

function forwardingHandoffBody({ role, ticket, dequeuedAt }) {
  return (
    `id: x1\nfrom: coordinator\nto: ${role}\nrecipient: ${role}\npriority: 50\ntype: git_handoff\n` +
    `role: coordinator\ntask: ${ticket}-some-slug\ncommit: 1234567890\n` +
    `dequeued_at: ${dequeuedAt}\n\nmerge_and_process coordinator 1234567890\n`
  );
}

function runDone(doneSh, wt, role, extraArgs) {
  try {
    const out = execFileSync('bash', [doneSh, ...(extraArgs || [])], {
      cwd: wt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: role },
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureState(ctx) {
  if (!ctx.bl2050) ctx.bl2050 = { fx: buildFixture() };
  return ctx.bl2050;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp("^a fixture swarm root whose roles table declares coder and QA as task roles with their own worktrees$"), (ctx) => {
    ensureState(ctx);
  });

  scoped(new RegExp("^the (.+?) holds a forwarding git_handoff for BL-4242 in in_process, queued a minute ago, with no git_handoff naming BL-4242 in its outbox or sent mailbox$"), (ctx, role) => {
    assert.ok(KNOWN_ROLES.has(role), `unknown role: ${role}`);
    const state = ensureState(ctx);
    state.role = role;
    const dequeuedAt = isoSecondsAgo(60);
    const dirs = state.fx.dirsByRole[role];
    const filePath = path.join(dirs.inProcess, '50_x1.handoff');
    fs.writeFileSync(filePath, forwardingHandoffBody({ role, ticket: TICKET, dequeuedAt }));
    state.itemPath = filePath;
    // Outbox/sent start empty - "no git_handoff naming BL-4242" holds by construction.
  });

  scoped(new RegExp("^(.+?) on the (.+?)'s branch since that parcel was queued$"), (ctx, commits, role) => {
    assert.ok(KNOWN_COMMITS.has(commits), `unknown commits value: ${commits}`);
    assert.ok(KNOWN_ROLES.has(role), `unknown role: ${role}`);
    const state = ensureState(ctx);
    if (commits === 'no commit naming BL-4242') {
      // Nothing to add - the role's branch holds only its fixture-time commit.
      return;
    }
    const wt = state.fx.wtByRole[role];
    git(wt, ['commit', '-q', '--allow-empty', '-m', 'BL-4242: fix']);
    state.committedSha = git(wt, ['rev-parse', '--short=10', 'HEAD']);
  });

  scoped(new RegExp("^the (.+?) runs done_with_current with the reason work done, handoff written$"), (ctx, role) => {
    assert.ok(KNOWN_ROLES.has(role), `unknown role: ${role}`);
    const state = ensureState(ctx);
    state.result = runDone(state.fx.doneShByRole[role], state.fx.wtByRole[role], role, ['--no-op', REASON]);
  });

  scoped(new RegExp("^the outcome is (.+?)$"), (ctx, outcome) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome: ${outcome}`);
    const state = ensureState(ctx);
    if (outcome === 'refused naming that commit and the git_handoff to send, with nothing moved') {
      assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
      assert.match(state.result.output, /NOT_A_NO_OP/, `expected NOT_A_NO_OP: ${state.result.output}`);
      assert.ok(
        state.result.output.includes(state.committedSha),
        `refusal must name the commit ${state.committedSha}: ${state.result.output}`
      );
      assert.match(state.result.output, /send a git_handoff/i, `refusal must say to send a git_handoff: ${state.result.output}`);
      assert.ok(fs.existsSync(state.itemPath), `expected ${state.itemPath} to still be in place`);
      assert.doesNotMatch(fs.readFileSync(state.itemPath, 'utf8'), /^completed_at:/m, 'completed_at must not be stamped');
      return;
    }
    // 'completed recording the reason work done, handoff written'
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    assert.match(state.result.output, /COMPLETED:/, `expected completion: ${state.result.output}`);
    const dirs = state.fx.dirsByRole[state.role];
    const completedPath = path.join(dirs.completed, path.basename(state.itemPath));
    const text = fs.readFileSync(completedPath, 'utf8');
    assert.match(text, new RegExp(`^no_op_reason: ${REASON}$`, 'm'), `expected no_op_reason on the completed file: ${text}`);
  });

  scoped(new RegExp("^the coder holds a forwarding git_handoff for BL-4242 in in_process, queued a minute ago, with no git_handoff naming BL-4242 in its outbox or sent mailbox$"), (ctx) => {
    const state = ensureState(ctx);
    state.role = 'coder';
    const dequeuedAt = isoSecondsAgo(60);
    const dirs = state.fx.dirsByRole.coder;
    const filePath = path.join(dirs.inProcess, '50_x1.handoff');
    fs.writeFileSync(filePath, forwardingHandoffBody({ role: 'coder', ticket: TICKET, dequeuedAt }));
    state.itemPath = filePath;
  });

  scoped(new RegExp("^a commit whose subject leads with BL-4242 on the coder's branch since that parcel was queued$"), (ctx) => {
    const state = ensureState(ctx);
    const wt = state.fx.wtByRole.coder;
    git(wt, ['commit', '-q', '--allow-empty', '-m', 'BL-4242: fix']);
    state.committedSha = git(wt, ['rev-parse', '--short=10', 'HEAD']);
  });

  scoped(new RegExp("^the coder runs done_with_current with no reason$"), (ctx) => {
    const state = ensureState(ctx);
    state.result = runDone(state.fx.doneShByRole.coder, state.fx.wtByRole.coder, 'coder', []);
  });

  scoped(new RegExp("^it is refused naming that commit$"), (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /NOT_A_NO_OP/, `expected NOT_A_NO_OP: ${state.result.output}`);
    assert.ok(
      state.result.output.includes(state.committedSha),
      `refusal must name the commit ${state.committedSha}: ${state.result.output}`
    );
  });

  scoped(new RegExp("^the refusal does not mention --no-op$"), (ctx) => {
    const state = ensureState(ctx);
    assert.doesNotMatch(state.result.output, /--no-op/, `refusal must not mention --no-op: ${state.result.output}`);
  });

}

module.exports = { registerSteps };
