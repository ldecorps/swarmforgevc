'use strict';

// BL-1609: step handlers for "A forwarding parcel is not completed with
// nothing sent". Drives the REAL done_with_current.sh (via
// done_with_current.bb -> done_with_current_task.bb /
// done_with_current_batch.bb) against a real git worktree + fixture
// mailbox - the same "shell out to the real guard" convention BL-1422's own
// acceptance handler uses, since the defect lives in the completion
// helper's own filesystem/git plumbing, not in anything a reimplementation
// could stand in for.
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

const FEATURE = 'BL-1609 A forwarding parcel is not completed with nothing sent';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const TICKET = 'BL-4242';
const COMMIT = '1234567890';
const BATCH_NAME = 'batch_20260916T170000Z';

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
  // Stub ready_for_next so a completion cannot rotate/dequeue live roles.
  for (const stub of ['ready_for_next_task.sh', 'ready_for_next_batch.sh']) {
    fs.writeFileSync(path.join(scriptsDir, stub), '#!/usr/bin/env zsh\necho "NO_TASK"\nexit 0\n', {
      mode: 0o755,
    });
  }
}

function mailboxDirs(wt, role, masterResident) {
  const base = masterResident
    ? path.join(wt, '.swarmforge', 'handoffs', role)
    : path.join(wt, '.swarmforge', 'handoffs');
  return {
    inProcess: path.join(base, 'inbox', 'in_process'),
    completed: path.join(base, 'inbox', 'completed'),
    outbox: path.join(base, 'outbox'),
    sent: path.join(base, 'sent'),
  };
}

function makeFixture() {
  const root = mkProcessTmpDir('bl1609acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const architectWt = path.join(root, '.worktrees', 'architect');
  git(root, ['worktree', 'add', '-q', '-b', 'architect', architectWt]);
  const cleanerWt = path.join(root, '.worktrees', 'cleaner');
  git(root, ['worktree', 'add', '-q', '-b', 'cleaner', cleanerWt]);
  const masterWt = path.join(root, '.worktrees', 'master');
  git(root, ['worktree', 'add', '-q', '-b', 'master', masterWt]);

  for (const wt of [architectWt, cleanerWt, masterWt]) {
    installScripts(path.join(wt, 'swarmforge', 'scripts'));
  }

  // Background: architect (task, own worktree), cleaner (batch, own
  // worktree), specifier and coordinator (master-resident, ONE shared
  // checkout - BL-128's per-role mailbox subdirectory under it).
  const rolesLine =
    `architect\tarchitect\t${architectWt}\tswarmforge-architect\tArchitect\tclaude\ttask\n` +
    `cleaner\tcleaner\t${cleanerWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n` +
    `specifier\tmaster\t${masterWt}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
    `coordinator\tmaster\t${masterWt}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`;
  // handoff_lib.bb's target-root resolves to the repo ROOT shared by every
  // linked worktree (git rev-parse --git-common-dir's parent), not the
  // worktree itself, so roles.tsv must exist there too for load-role-info
  // (and the master-resident branch it drives) to resolve. Each worktree
  // also keeps its own copy for dispatch_lib.bb's project-root (which
  // prefers `git rev-parse --show-toplevel`'s own roles.tsv when present).
  for (const wt of [root, architectWt, cleanerWt, masterWt]) {
    fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesLine);
  }

  const dirsByRole = {
    architect: mailboxDirs(architectWt, 'architect', false),
    cleaner: mailboxDirs(cleanerWt, 'cleaner', false),
    specifier: mailboxDirs(masterWt, 'specifier', true),
    coordinator: mailboxDirs(masterWt, 'coordinator', true),
  };
  for (const dirs of Object.values(dirsByRole)) {
    fs.mkdirSync(dirs.inProcess, { recursive: true });
    fs.mkdirSync(dirs.completed, { recursive: true });
    fs.mkdirSync(dirs.outbox, { recursive: true });
    fs.mkdirSync(dirs.sent, { recursive: true });
  }

  const wtByRole = { architect: architectWt, cleaner: cleanerWt, specifier: masterWt, coordinator: masterWt };
  const doneShByRole = Object.fromEntries(
    Object.entries(wtByRole).map(([role, wt]) => [role, path.join(wt, 'swarmforge', 'scripts', 'done_with_current.sh')])
  );

  return { root, dirsByRole, wtByRole, doneShByRole };
}

function forwardingHandoffBody({ role, ticket, commit, dequeuedAt, nonForwarding, name }) {
  const marker = nonForwarding ? 'non-forwarding: true\n' : '';
  return (
    `id: ${name}\nfrom: coordinator\nto: ${role}\nrecipient: ${role}\npriority: 50\ntype: git_handoff\n` +
    `role: coordinator\ntask: ${ticket}-some-slug\ncommit: ${commit}\n${marker}` +
    `dequeued_at: ${dequeuedAt}\n\nmerge_and_process coordinator ${commit}\n`
  );
}

function queuedForwardBody({ role, ticket, createdAt, name }) {
  return (
    `id: ${name}\nfrom: ${role}\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: ${role}\n` +
    `task: ${ticket}-some-slug\ncommit: 9999999999\ncreated_at: ${createdAt}\n\n` +
    `merge_and_process ${role} 9999999999\n`
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
  if (!ctx.bl1609) ctx.bl1609 = { fx: makeFixture() };
  return ctx.bl1609;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture swarm root whose roles table declares architect as a task role with its own worktree, cleaner as a batch role with its own worktree, and specifier and coordinator as master-resident rows sharing one checkout$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  // ── Given the <role> holds <holding>, dequeued a minute ago ──────────────
  scoped(
    /^the (architect|specifier|cleaner) holds (a forwarding git_handoff for BL-4242 in in_process|a non-forwarding git_handoff for BL-4242 in in_process|a batch holding a forwarding git_handoff for BL-4242 and a non-forwarding twin of its commit), dequeued a minute ago$/,
    (ctx, role, holding) => {
      const state = ensureState(ctx);
      const dequeuedAt = isoSecondsAgo(60);
      state.role = role;
      const dirs = state.fx.dirsByRole[role];

      if (holding === 'a forwarding git_handoff for BL-4242 in in_process') {
        const name = 'x1';
        const filePath = path.join(dirs.inProcess, `50_${name}.handoff`);
        fs.writeFileSync(filePath, forwardingHandoffBody({ role, ticket: TICKET, commit: COMMIT, dequeuedAt, name }));
        state.itemPaths = [filePath];
        state.forwardingItemPath = filePath;
        state.isBatch = false;
      } else if (holding === 'a non-forwarding git_handoff for BL-4242 in in_process') {
        const name = 'x1';
        const filePath = path.join(dirs.inProcess, `50_${name}.handoff`);
        fs.writeFileSync(
          filePath,
          forwardingHandoffBody({ role, ticket: TICKET, commit: COMMIT, dequeuedAt, nonForwarding: true, name })
        );
        state.itemPaths = [filePath];
        state.forwardingItemPath = null;
        state.isBatch = false;
      } else {
        const batchDir = path.join(dirs.inProcess, BATCH_NAME);
        fs.mkdirSync(batchDir, { recursive: true });
        const fwdPath = path.join(batchDir, '50_fwd.handoff');
        const twinPath = path.join(batchDir, '00_twin.handoff');
        fs.writeFileSync(
          fwdPath,
          forwardingHandoffBody({ role, ticket: TICKET, commit: COMMIT, dequeuedAt, name: 'fwd' })
        );
        fs.writeFileSync(
          twinPath,
          forwardingHandoffBody({ role, ticket: TICKET, commit: COMMIT, dequeuedAt, nonForwarding: true, name: 'twin' })
        );
        state.itemPaths = [fwdPath, twinPath];
        state.forwardingItemPath = fwdPath;
        state.isBatch = true;
        state.batchDir = batchDir;
      }
    }
  );

  // ── And <evidence> ────────────────────────────────────────────────────────
  scoped(/^no git_handoff naming BL-4242 exists in its outbox or sent mailbox$/, () => {
    // Nothing to add - the fixture's outbox/sent start empty.
  });

  scoped(
    /^a git_handoff naming BL-4242 created after the dequeue sits in its (outbox|sent mailbox)$/,
    (ctx, mailbox) => {
      const state = ensureState(ctx);
      const dirKey = mailbox.startsWith('sent') ? 'sent' : 'outbox';
      const dirs = state.fx.dirsByRole[state.role];
      const createdAt = isoSecondsAgo(30);
      fs.writeFileSync(
        path.join(dirs[dirKey], '90_evidence.handoff'),
        queuedForwardBody({ role: state.role, ticket: TICKET, createdAt, name: 'evidence' })
      );
    }
  );

  // ── When the <role> runs done_with_current <invocation> ──────────────────
  scoped(/^the (architect|specifier|cleaner) runs done_with_current (with no reason|with the reason no-op evidence-only rebase)$/, (ctx, role, invocation) => {
    const state = ensureState(ctx);
    const wt = state.fx.wtByRole[role];
    const doneSh = state.fx.doneShByRole[role];
    const args = invocation === 'with no reason' ? [] : ['--no-op', 'evidence-only rebase'];
    state.result = runDone(doneSh, wt, role, args);
  });

  // ── Then the outcome is <outcome> ────────────────────────────────────────
  scoped(/^the outcome is refused naming BL-4242 and the two ways out, with nothing moved$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /BL-4242/, `refusal must name BL-4242: ${state.result.output}`);
    assert.match(state.result.output, /--no-op/, `refusal must mention --no-op: ${state.result.output}`);
    assert.match(state.result.output, /send the forward/i, `refusal must mention sending the forward: ${state.result.output}`);
    for (const p of state.itemPaths) {
      assert.ok(fs.existsSync(p), `expected ${p} to still be in place`);
      assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /^completed_at:/m, `completed_at must not be stamped on ${p}`);
    }
    if (state.isBatch) {
      assert.ok(fs.existsSync(state.batchDir), 'expected the batch directory to still exist');
    }
  });

  scoped(/^the outcome is completed with no completion reason recorded$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    assert.match(state.result.output, state.isBatch ? /COMPLETED_BATCH:/ : /COMPLETED:/, `expected completion: ${state.result.output}`);
    const dirs = state.fx.dirsByRole[state.role];
    if (state.forwardingItemPath) {
      const completedPath = state.isBatch
        ? path.join(dirs.completed, BATCH_NAME, path.basename(state.forwardingItemPath))
        : path.join(dirs.completed, path.basename(state.forwardingItemPath));
      assert.ok(fs.existsSync(completedPath), `expected ${completedPath} in completed/`);
      assert.doesNotMatch(fs.readFileSync(completedPath, 'utf8'), /^no_op_reason:/m, 'no_op_reason must not be stamped');
    } else {
      const completedPath = path.join(dirs.completed, path.basename(state.itemPaths[0]));
      assert.ok(fs.existsSync(completedPath), `expected ${completedPath} in completed/`);
    }
  });

  scoped(/^the outcome is completed recording the reason no-op evidence-only rebase$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    assert.match(state.result.output, state.isBatch ? /COMPLETED_BATCH:/ : /COMPLETED:/, `expected completion: ${state.result.output}`);
    const dirs = state.fx.dirsByRole[state.role];
    const completedPath = state.isBatch
      ? path.join(dirs.completed, BATCH_NAME, path.basename(state.forwardingItemPath))
      : path.join(dirs.completed, path.basename(state.forwardingItemPath));
    const text = fs.readFileSync(completedPath, 'utf8');
    assert.match(text, /^no_op_reason: evidence-only rebase$/m, `expected no_op_reason on the completed file: ${text}`);
    assert.match(text, /^no_op_at: /m, `expected no_op_at on the completed file: ${text}`);
  });
}

module.exports = { registerSteps };
