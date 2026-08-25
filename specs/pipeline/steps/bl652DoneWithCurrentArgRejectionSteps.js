'use strict';

// BL-652: done_with_current.sh must refuse ANY argument with zero completion
// side effects. Drives the real scripts via a fixture copy so argumentless
// completion cannot rotate live roles (ready_* stubbed to print NO_TASK).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FEATURE =
  'done_with_current.sh rejects arguments instead of completing silently';
const REPO = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS = path.join(REPO, 'swarmforge', 'scripts');

function ensure(ctx) {
  if (!ctx.bl652) ctx.bl652 = {};
  return ctx.bl652;
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function writeHandoff(filePath, id, recipient) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `id: ${id}\nfrom: specifier\nto: ${recipient}\nrecipient: ${recipient}\npriority: 50\ntype: note\nmessage: body\ndequeued_at: 2026-08-25T00:00:00Z\n\nbody\n`
  );
}

function installScripts(wt) {
  const dest = path.join(wt, 'swarmforge', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS)) {
    if (name.endsWith('.bb') || name.endsWith('.sh')) {
      fs.copyFileSync(path.join(REAL_SCRIPTS, name), path.join(dest, name));
    }
  }
  for (const stub of ['ready_for_next_batch.sh', 'ready_for_next_task.sh']) {
    fs.writeFileSync(path.join(dest, stub), '#!/usr/bin/env zsh\necho "NO_TASK"\nexit 0\n');
  }
  for (const name of fs.readdirSync(dest)) {
    if (name.endsWith('.sh')) fs.chmodSync(path.join(dest, name), 0o755);
  }
}

function mkFixture(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl652-aps-'));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const role = mode === 'batch' ? 'batchrole' : 'taskrole';
  const wt = path.join(root, '.worktrees', role);
  git(root, ['worktree', 'add', '-q', '-b', role, wt]);
  installScripts(wt);
  const roles =
    `batchrole\tbatchrole\t${path.join(root, '.worktrees', 'batchrole')}\tswarmforge-batchrole\tBatchrole\tclaude\tbatch\n` +
    `taskrole\ttaskrole\t${path.join(root, '.worktrees', 'taskrole')}\tswarmforge-taskrole\tTaskrole\tclaude\ttask\n`;
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), roles);
  fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), roles);
  const ip = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const completed = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completed, { recursive: true });
  let handoffs = [];
  if (mode === 'batch') {
    const batch = path.join(ip, 'batch_20260825T000000Z');
    fs.mkdirSync(batch, { recursive: true });
    const a = path.join(batch, '50_a.handoff');
    const b = path.join(batch, '50_b.handoff');
    writeHandoff(a, 'a', role);
    writeHandoff(b, 'b', role);
    handoffs = [a, b];
  } else {
    fs.mkdirSync(ip, { recursive: true });
    const t = path.join(ip, '50_t.handoff');
    writeHandoff(t, 't', role);
    handoffs = [t];
  }
  return {
    root,
    wt,
    role,
    ip,
    completed,
    handoffs,
    doneSh: path.join(wt, 'swarmforge', 'scripts', 'done_with_current.sh'),
  };
}

function runDone(fx, args = []) {
  return spawnSync(fx.doneSh, args, {
    cwd: fx.wt,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: fx.role },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role in batch receive mode with 2 handoffs in an in_process batch$/, (ctx) => {
    ensure(ctx).fx = mkFixture('batch');
  });

  scoped(/^a role in task receive mode with 1 handoff in in_process$/, (ctx) => {
    ensure(ctx).fx = mkFixture('task');
  });

  scoped(/^done_with_current\.sh is invoked with argument "(.+)"$/, (ctx, argument) => {
    const st = ensure(ctx);
    const r = runDone(st.fx, [argument]);
    st.exit = r.status;
    st.out = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^done_with_current\.sh is invoked with no arguments$/, (ctx) => {
    const st = ensure(ctx);
    const r = runDone(st.fx, []);
    st.exit = r.status;
    st.out = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the exit code is non-zero$/, (ctx) => {
    assert.notEqual(ensure(ctx).exit, 0, ensure(ctx).out);
  });

  scoped(/^usage text stating the no-argument contract is printed$/, (ctx) => {
    assert.match(ensure(ctx).out, /no argument/i);
  });

  scoped(/^both handoffs remain in the in_process batch$/, (ctx) => {
    const st = ensure(ctx);
    for (const h of st.fx.handoffs) {
      assert.equal(fs.existsSync(h), true, h);
    }
  });

  scoped(/^the handoff remains in in_process$/, (ctx) => {
    assert.equal(fs.existsSync(ensure(ctx).fx.handoffs[0]), true);
  });

  scoped(/^no completed batch directory is created$/, (ctx) => {
    const entries = fs.readdirSync(ensure(ctx).fx.completed);
    assert.equal(entries.length, 0, entries.join(','));
  });

  scoped(/^no completed_at header is stamped on either handoff$/, (ctx) => {
    for (const h of ensure(ctx).fx.handoffs) {
      assert.doesNotMatch(fs.readFileSync(h, 'utf8'), /^completed_at:/m);
    }
  });

  scoped(/^ready_for_next is not chained$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).out, /NO_TASK|COMPLETED_BATCH:/);
  });

  scoped(/^the batch is archived to completed$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.out, /COMPLETED_BATCH:/);
    assert.equal(
      fs.existsSync(path.join(st.fx.completed, 'batch_20260825T000000Z')),
      true
    );
  });

  scoped(/^a completed_at header is stamped on both handoffs$/, (ctx) => {
    const batch = path.join(ensure(ctx).fx.completed, 'batch_20260825T000000Z');
    for (const name of ['50_a.handoff', '50_b.handoff']) {
      assert.match(fs.readFileSync(path.join(batch, name), 'utf8'), /^completed_at:/m);
    }
  });
}

module.exports = { registerSteps };
