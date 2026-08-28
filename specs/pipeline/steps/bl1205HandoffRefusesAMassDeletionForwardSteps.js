'use strict';

// BL-1205: step handlers for "a git_handoff whose merge into the
// recipient's branch would mass-delete tracked files is refused before it
// is sent". Drives the REAL swarm_handoff.bb (and its real
// tree_collapse_guard_lib.bb call chain) against a real fixture git repo,
// same per-role-mailbox-subdirectory pattern as
// bl1213ParcelRollbackGuardSteps.js and bl760DuplicateChainGuardSteps.js -
// a single shared git repo playing the role of "the branch" (git
// operations always target ctx.root), each pipeline role given its own
// mailbox subdirectory.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const TASK_NAME = 'BL-1205-fixture';
const FEATURE_NAME = "a git_handoff whose merge into the recipient's branch would mass-delete tracked files is refused before it is sent";

// A real repo is large enough that neither the 5%-of-before nor the flat
// 100-path threshold collapses to a degenerate small-fixture edge case:
// "far more than the threshold" deletes ~95%, "fewer than the threshold"
// deletes 3.
const SEED_FILE_COUNT = 200;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function roleDir(ctx, role) {
  return role === 'coordinator' ? ctx.root : path.join(ctx.root, role);
}

// This ticket's own gate has nothing to do with a role's mailbox/worktree
// separation - it reads roles.tsv purely to resolve <role> -> <branch
// name> (the `session` column, this project's own branch==session
// convention). All git branches therefore live in the ONE shared repo at
// ctx.root; roleDir only matters for where swarm_handoff.bb looks for its
// OWN mailbox when invoked as a given role.
function writeRoles(ctx, extraRows) {
  const rows = [
    `coder\tcoder-wt\t${roleDir(ctx, 'coder')}\tsender-branch\tCoder\tclaude\ttask`,
    ...extraRows,
  ];
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  fs.mkdirSync(roleDir(ctx, 'coder'), { recursive: true });
}

function branchRoleRow(role, branch) {
  return `${role}\t${role}-wt\t.\t${branch}\t${role}\tclaude\tbatch`;
}

function seedFiles(ctx, count) {
  for (let i = 0; i < count; i += 1) {
    fs.writeFileSync(path.join(ctx.root, `f${i}.txt`), `f${i}\n`);
  }
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=bl1205@example.com', '-c', 'user.name=bl1205', 'commit', '-q', '-m', 'seed']);
}

function deleteFiles(ctx, count) {
  for (let i = 0; i < count; i += 1) {
    fs.rmSync(path.join(ctx.root, `f${i}.txt`), { force: true });
  }
}

function commit(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=bl1205@example.com', '-c', 'user.name=bl1205', 'commit', '-q', '-m', message]);
}

function runSwarmHandoff(ctx, draftContent, role) {
  const cwd = roleDir(ctx, role);
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: role },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

// BL-1205 D1 (architect bounce, 20260828): ctx.root is a real 200-file git
// repo created under os.tmpdir() - removed here, in a finally, at every
// scenario's terminal Then step (some scenarios' last step differs from
// others', so this is called from all four exit points below; idempotent
// via force:true, so a scenario that reaches more than one of them never
// double-fails on the second call). Matches engineering.prompt's BL-971
// guardrail: "removed in a finally, never only after the last assertion".
function cleanupFixtureState(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────

  scoped(/^a role is sending a git_handoff naming a commit on its own branch$/, (ctx) => {
    ctx.root = mkTmp('bl1205-tree-collapse-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    git(ctx.root, ['config', 'user.email', 'bl1205@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl1205']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeRoles(ctx, [branchRoleRow('cleaner', 'recipient-branch')]);
    seedFiles(ctx, SEED_FILE_COUNT);
    git(ctx.root, ['branch', 'recipient-branch']);
    git(ctx.root, ['checkout', '-q', '-b', 'sender-branch']);
    ctx.senderRole = 'coder';
    ctx.recipientRole = 'cleaner';
  });

  // ── Given ────────────────────────────────────────────────────────────

  scoped(/^merging the named commit into the recipient's branch would remove far more tracked paths than the threshold allows$/, (ctx) => {
    deleteFiles(ctx, Math.round(SEED_FILE_COUNT * 0.95));
    commit(ctx, 'mass delete');
    ctx.removedCount = Math.round(SEED_FILE_COUNT * 0.95);
    ctx.commitSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  scoped(/^merging the named commit into the recipient's branch would remove fewer tracked paths than the threshold allows$/, (ctx) => {
    deleteFiles(ctx, 3);
    commit(ctx, 'ordinary delete');
    ctx.commitSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  scoped(/^the recipient's branch cannot be read$/, (ctx) => {
    // Rebuild roles.tsv naming a branch that was never created.
    writeRoles(ctx, [branchRoleRow('cleaner', 'nonexistent-branch')]);
    fs.writeFileSync(path.join(ctx.root, 'g.txt'), 'g\n');
    commit(ctx, 'more work');
    ctx.commitSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  // ── When ─────────────────────────────────────────────────────────────

  scoped(/^the role sends the git_handoff$/, (ctx) => {
    const draft = `type: git_handoff\nto: ${ctx.recipientRole}\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${ctx.commitSha}\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  scoped(/^the role sends the git_handoff to (\S+)$/, (ctx, recipient) => {
    // Ensure a branch row exists for this recipient too (scenario 03
    // parameterises the recipient across every pipeline role).
    const branchName = `${recipient}-branch`;
    const rows = [branchRoleRow(recipient, branchName)];
    writeRoles(ctx, rows);
    if (!ctx.branchesCreated) ctx.branchesCreated = new Set();
    if (!ctx.branchesCreated.has(branchName)) {
      const currentBranch = gitOut(ctx.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      // Create the recipient branch pointing at the pre-mass-deletion tip
      // (the commit BEFORE the "far more than threshold" deletion), same
      // as the Background's own recipient-branch setup.
      const massDeleteCommit = gitOut(ctx.root, ['rev-parse', `${ctx.commitSha}^`]);
      git(ctx.root, ['branch', branchName, massDeleteCommit]);
      git(ctx.root, ['checkout', '-q', currentBranch]);
      ctx.branchesCreated.add(branchName);
    }
    const draft = `type: git_handoff\nto: ${recipient}\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${ctx.commitSha}\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  scoped(/^the role is sending a note rather than a git_handoff$/, () => {
    // No-op: the actual send happens in the "sends it" step below - this
    // Given just documents the scenario's own framing.
  });

  scoped(/^the role sends it$/, (ctx) => {
    const draft = `type: note\nto: ${ctx.recipientRole}\npriority: 00\nmessage: checking in\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  // ── Then ─────────────────────────────────────────────────────────────

  scoped(/^the send is refused$/, (ctx) => {
    try {
      const out = combinedOutput(ctx.result);
      if (ctx.result.status !== 2) {
        throw new Error(`expected the send to be refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/HANDOFF INVALID/.test(out)) {
        throw new Error(`expected a HANDOFF INVALID report, got: ${out}`);
      }
      if (!/BL-1205/.test(out)) {
        throw new Error(`expected the refusal to cite BL-1205, got: ${out}`);
      }
    } finally {
      // Scenario 03's outline ends here; scenario 01 continues to the
      // path-count assertion below, which needs no further fs access -
      // cleaning up now is safe either way (idempotent).
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^the refusal names how many tracked paths the merge would remove$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(String(ctx.removedCount))) {
      throw new Error(`expected the refusal to name the removed count ${ctx.removedCount}, got: ${out}`);
    }
  });

  scoped(/^the send succeeds$/, (ctx) => {
    try {
      const out = combinedOutput(ctx.result);
      if (ctx.result.status === 2) {
        throw new Error(`expected the send to succeed, but it was refused: ${out}`);
      }
    } finally {
      // Scenarios 02/05 end here; scenario 04 continues to the warning
      // assertion below, which needs no further fs access.
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^a warning names the branch that could not be read$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/TREE_COLLAPSE WARNING/.test(out) || !out.includes('nonexistent-branch')) {
      throw new Error(`expected a TREE_COLLAPSE warning naming nonexistent-branch, got: ${out}`);
    }
  });
}

module.exports = { registerSteps };
