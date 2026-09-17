'use strict';

// BL-1612: step handlers for "The send-time gates see a batch role's
// received parcel". Scenario 01 drives the two REAL reader functions
// in-process on a fixture mailbox (review-forward-evidence-gate-lib's
// public received-commit-for-task, and parcel-rollback-guard-lib's private
// received-parcel-commit-for-task via Clojure's `@#'ns/name` deref-of-var -
// a private var is still resolvable that way, the standard technique for
// testing a `defn-` from outside its namespace, never a second public
// wrapper grown just for this test). Scenario 02 drives the REAL
// swarm_handoff.bb end to end, same fixture pattern as
// bl1213ParcelRollbackGuardSteps.js (a single shared git repo playing "the
// branch", each pipeline role given its own mailbox subdirectory).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const REVIEW_LIB = path.join(SCRIPTS_DIR, 'review_forward_evidence_gate_lib.bb');
const ROLLBACK_LIB = path.join(SCRIPTS_DIR, 'parcel_rollback_guard_lib.bb');

const TASK_NAME = 'BL-4242-fixture';
const FEATURE = "BL-1612 The send-time gates see a batch role's received parcel";

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function roleDir(ctx, role) {
  return path.join(ctx.root, '.worktrees', role);
}

function writeRoles(ctx) {
  const rows = [
    `architect\tarchitect-wt\t${roleDir(ctx, 'architect')}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `cleaner\tcleaner-wt\t${roleDir(ctx, 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
  ];
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  for (const role of ['architect', 'cleaner']) {
    fs.mkdirSync(path.join(roleDir(ctx, role), '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  }
}

function inProcessDir(ctx, role) {
  return path.join(roleDir(ctx, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function writeHandoff(dir, name, commit) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    `id: x\nfrom: coder\nto: role\npriority: 50\ntype: git_handoff\nrole: coder\n` +
      `task: ${TASK_NAME}\ncommit: ${commit}\ncreated_at: 2026-09-16T00:00:00Z\n\nbody\n`
  );
}

function bbEval(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function writeFile(ctx, name, content) {
  fs.writeFileSync(path.join(ctx.root, name), content);
}

function commit(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a fixture swarm root whose roles table declares architect as a task role and cleaner as a batch role, each with its own worktree and mailbox$/,
    (ctx) => {
      ctx.root = mkTmp('bl1612-send-gates-');
      git(ctx.root, ['init', '-q', '-b', 'main', '.']);
      git(ctx.root, ['config', 'user.email', 't@t']);
      git(ctx.root, ['config', 'user.name', 't']);
      git(ctx.root, ['config', 'commit.gpgsign', 'false']);
      git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
      writeRoles(ctx);
    }
  );

  // ── Scenario Outline 01: reader in isolation ────────────────────────────
  scoped(
    /^the (architect|cleaner)'s in_process box holds (a batch directory with a git_handoff for the task at commit abc1234567|an emptied batch directory|a git_handoff for the task at commit abc1234567 at the top level|nothing)$/,
    (ctx, role, holding) => {
      ctx.role = role;
      const base = inProcessDir(ctx, role);
      if (holding === 'a batch directory with a git_handoff for the task at commit abc1234567') {
        writeHandoff(path.join(base, 'batch_20260916T170000Z'), '50_a.handoff', 'abc1234567');
      } else if (holding === 'an emptied batch directory') {
        fs.mkdirSync(path.join(base, 'batch_20260916T170000Z'), { recursive: true });
      } else if (holding === 'a git_handoff for the task at commit abc1234567 at the top level') {
        writeHandoff(base, '50_a.handoff', 'abc1234567');
      } else {
        fs.mkdirSync(base, { recursive: true });
      }
    }
  );

  scoped(/^(the review-forward reader|the rollback reader) resolves the received commit for that task$/, (ctx, reader) => {
    if (reader === 'the review-forward reader') {
      ctx.result = bbEval(
        `(load-file "${REVIEW_LIB}") (println (or (review-forward-evidence-gate-lib/received-commit-for-task "${ctx.root}" "${ctx.role}" "${TASK_NAME}") "nothing"))`
      );
    } else {
      ctx.result = bbEval(
        `(load-file "${ROLLBACK_LIB}") (println (or (@#'parcel-rollback-guard-lib/received-parcel-commit-for-task "${ctx.root}" "${ctx.role}" "${TASK_NAME}") "nothing"))`
      );
    }
  });

  scoped(/^it returns (abc1234567|nothing)$/, (ctx, expected) => {
    if (ctx.result !== expected) {
      throw new Error(`expected "${expected}", got "${ctx.result}"`);
    }
  });

  // ── Scenario 02: real sender, rollback gate refuses a batch role ────────
  scoped(
    /^the cleaner holds a batch with a git_handoff for BL-4242 whose commit is on the fixture's architect branch$/,
    (ctx) => {
      // BASE: file.txt at its pre-parcel content, on `main`.
      writeFile(ctx, 'file.txt', 'pre-parcel content\n');
      commit(ctx, 'seed file');
      const baseSha = gitOut(ctx.root, ['rev-parse', 'HEAD']);

      // The architect's own line: one commit past BASE, landing the parcel.
      git(ctx.root, ['checkout', '-q', '-b', 'architect-line', baseSha]);
      writeFile(ctx, 'file.txt', 'parcel content\n');
      commit(ctx, 'BL-4242: parcel change');
      ctx.architectShortSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);

      // The cleaner's own line: diverges from the SAME base, never merges
      // the architect's change - file.txt stays at its pre-parcel content.
      git(ctx.root, ['checkout', '-q', '-b', 'cleaner-line', baseSha]);
      writeFile(ctx, 'other.txt', "cleaner's own unrelated work\n");
      commit(ctx, "cleaner's own work, never touching file.txt");

      writeHandoff(
        path.join(inProcessDir(ctx, 'cleaner'), 'batch_20260916T170000Z'),
        '50_received.handoff',
        ctx.architectShortSha
      );
    }
  );

  scoped(/^the cleaner's forwarded commit does not descend from that received commit$/, (ctx) => {
    const isAncestor = spawnSync(
      'git',
      ['-C', ctx.root, 'merge-base', '--is-ancestor', ctx.architectShortSha, 'HEAD'],
      { encoding: 'utf8' }
    );
    if (isAncestor.status === 0) {
      throw new Error('fixture error: the cleaner-line tip descends from the architect commit');
    }
  });

  scoped(/^the cleaner sends a git_handoff for BL-4242$/, (ctx) => {
    const tipSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    const draftPath = path.join(ctx.root, 'draft.txt');
    fs.writeFileSync(draftPath, `type: git_handoff\nto: architect\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${tipSha}\n`);
    const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
      cwd: roleDir(ctx, 'cleaner'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SWARMFORGE_ROLE: 'cleaner' },
    });
    ctx.result2 = { status: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
  });

  scoped(/^the send is refused by the parcel-rollback gate naming the received commit$/, (ctx) => {
    const out = ctx.result2.output;
    if (ctx.result2.status === 0) {
      throw new Error(`expected the send to be refused, got exit 0: ${out}`);
    }
    if (!/no revert of that commit explains the rollback/.test(out)) {
      throw new Error(`expected the parcel-rollback gate's own refusal, got: ${out}`);
    }
    if (!out.includes(ctx.architectShortSha)) {
      throw new Error(`expected the refusal to name the received commit ${ctx.architectShortSha}, got: ${out}`);
    }
  });
}

module.exports = { registerSteps };
