'use strict';

// BL-218: step handlers for the mailbox-intake-idempotency feature. Drives
// the real ready_for_next_task.bb through its own CLI surface (a
// subprocess) - the "handoff protocol" allowlisted domain, same as
// backlogSteps.js drives backlogReader.js's module surface, just via a
// different real-executable boundary (bb scripts have no compiled JS
// output to require). Never a live swarm, never a live tmux session.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const READY_TASK = path.join(SWARMFORGE_SCRIPTS, 'ready_for_next_task.bb');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mailbox-intake-'));
    git(ctx.targetPath, ['init', '-q']);
    git(ctx.targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function writeRolesTsv(targetPath, role) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    `${role}\t${role}\t${targetPath}\tswarmforge-${role}\t${role}\tclaude\ttask\n`
  );
}

function stateDir(ctx, state) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', state);
}

function writeHandoff(dir, basename, recipient) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, basename),
    `id: ${basename}\nfrom: specifier\nto: ${recipient}\nrecipient: ${recipient}\npriority: 50\ntype: git_handoff\ntask: BL-218-test\ncommit: 0000000000\n\npayload\n`
  );
}

function registerSteps(registry) {
  registry.define(/^a role mailbox with new\/, in_process\/, completed\/, and abandoned\/$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    ctx.role = ctx.role || 'coder';
    writeRolesTsv(targetPath, ctx.role);
    for (const state of ['new', 'in_process', 'completed', 'abandoned']) {
      fs.mkdirSync(stateDir(ctx, state), { recursive: true });
    }
  });

  registry.define(/^a handoff whose id already exists in ([a-z]+)\/$/, (ctx, state) => {
    writeHandoff(stateDir(ctx, state), '50_stale.handoff', ctx.role || 'coder');
  });

  registry.define(/^a stale copy of it sits in new\/$/, (ctx) => {
    writeHandoff(stateDir(ctx, 'new'), '50_stale.handoff', ctx.role || 'coder');
  });

  registry.define(/^a handoff in new\/ whose id is in neither completed\/ nor abandoned\/$/, (ctx) => {
    writeHandoff(stateDir(ctx, 'new'), '50_fresh.handoff', ctx.role || 'coder');
  });

  // A master-resident role (coordinator) with NO roles.tsv row for it
  // forces load-role-info to return nil, so my-mailbox-base-dir falls back
  // to the pre-BL-128 flat worktree-root layout instead of the per-role
  // <worktree>/.swarmforge/handoffs/<role>/ nesting - the exact
  // post-merge/pre-migration window BL-218's root cause describes.
  registry.define(/^the base-dir fallback resolves the pre-BL-128 flat layout$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    ctx.role = 'coordinator';
    fs.rmSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), { force: true });
    for (const state of ['new', 'in_process', 'completed', 'abandoned']) {
      fs.mkdirSync(stateDir(ctx, state), { recursive: true });
    }
  });

  registry.define(/^that layout holds a completed handoff with a stale new\/ copy$/, (ctx) => {
    writeHandoff(stateDir(ctx, 'completed'), '50_flat-stale.handoff', ctx.role);
    writeHandoff(stateDir(ctx, 'new'), '50_flat-stale.handoff', ctx.role);
  });

  registry.define(/^the role runs its intake$/, (ctx) => {
    ctx.output = execFileSync('bb', [READY_TASK], {
      cwd: ctx.targetPath,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: ctx.role || 'coder' },
    });
  });

  registry.define(/^the stale copy is not promoted to in_process\/$/, (ctx) => {
    const inProcess = stateDir(ctx, 'in_process');
    const files = fs.existsSync(inProcess) ? fs.readdirSync(inProcess) : [];
    if (files.includes('50_stale.handoff')) {
      throw new Error(`expected the stale copy not to be promoted, found in_process/: ${files.join(', ')}`);
    }
  });

  registry.define(/^it is skipped with a logged "already-processed" line$/, (ctx) => {
    if (!/SKIPPED already-processed: 50_stale\.handoff/.test(ctx.output)) {
      throw new Error(`expected an "already-processed" skip line, got: ${ctx.output}`);
    }
  });

  registry.define(/^it is promoted to in_process\/ with a fresh dequeued_at$/, (ctx) => {
    const target = path.join(stateDir(ctx, 'in_process'), '50_fresh.handoff');
    if (!fs.existsSync(target)) {
      throw new Error(`expected 50_fresh.handoff to be promoted to in_process/, got: ${ctx.output}`);
    }
    if (!/^dequeued_at: /m.test(fs.readFileSync(target, 'utf8'))) {
      throw new Error('expected a fresh dequeued_at header on the promoted handoff');
    }
  });

  registry.define(/^the completed handoff is not re-promoted to in_process\/$/, (ctx) => {
    const inProcess = stateDir(ctx, 'in_process');
    const files = fs.existsSync(inProcess) ? fs.readdirSync(inProcess) : [];
    if (files.includes('50_flat-stale.handoff')) {
      throw new Error(`expected the flat-layout completed handoff not to be re-promoted, found in_process/: ${files.join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
