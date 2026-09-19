'use strict';

// BL-1637: step handlers for "A seat's forward is filed where its
// completion gate looks"
// (specs/features/BL-1637-a-seats-forward-is-filed-where-its-completion-gate-looks.feature).
//
// Scenario 01 drives the REAL done_with_current.sh (-> done_with_current_task.bb
// -> forward_evidence_lib.bb) against a real git worktree + fixture mailbox,
// same posture as bl1609ForwardingParcelNotCompletedWithNothingSentSteps.js
// (this defect is the seat-aware extension of that exact gate). Scenarios
// 02 and 03 drive the real Babashka library functions directly via a real
// bb subprocess (SWARMFORGE_ROLE is process-env-scoped and cannot be
// overridden in-process, the same reason
// bl1360_ceremony_handoff_property_runner.bb spawns bb subprocesses for
// role-scoped checks) - never a reimplementation of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1637 A seat's forward is filed where its completion gate looks";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const TICKET = 'BL-5353';
const COMMIT = '1234567890';

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

// ── Scenario 01: the real done_with_current gate, coder@2 seat ──────────

function makeSeatFixture() {
  const root = mkProcessTmpDir('bl1637acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const coderWt = path.join(root, '.worktrees', 'coder');
  git(root, ['worktree', 'add', '-q', '-b', 'coder', coderWt]);
  const coder2Wt = path.join(root, '.worktrees', 'coder2');
  git(root, ['worktree', 'add', '-q', '-b', 'coder2', coder2Wt]);
  const cleanerWt = path.join(root, '.worktrees', 'cleaner');
  git(root, ['worktree', 'add', '-q', '-b', 'cleaner', cleanerWt]);

  for (const wt of [coderWt, coder2Wt, cleanerWt]) {
    installScripts(path.join(wt, 'swarmforge', 'scripts'));
  }

  const rolesLine =
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
    `coder@2\tcoder2\t${coder2Wt}\tswarmforge-coder2\tCoder@2\tclaude\ttask\n` +
    `cleaner\tcleaner\t${cleanerWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`;
  for (const wt of [root, coderWt, coder2Wt, cleanerWt]) {
    fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesLine);
  }

  const dirs = { coder: mailboxDirs(coderWt), coder2: mailboxDirs(coder2Wt), cleaner: mailboxDirs(cleanerWt) };
  for (const d of Object.values(dirs)) {
    fs.mkdirSync(d.inProcess, { recursive: true });
    fs.mkdirSync(d.completed, { recursive: true });
    fs.mkdirSync(d.outbox, { recursive: true });
    fs.mkdirSync(d.sent, { recursive: true });
  }
  return { root, coderWt, coder2Wt, cleanerWt, dirs, doneSh: path.join(coder2Wt, 'swarmforge', 'scripts', 'done_with_current.sh') };
}

function inProcessBody({ dequeuedAt }) {
  return (
    `id: x1\nfrom: coordinator\nto: coder\nrecipient: coder\npriority: 50\ntype: git_handoff\n` +
    `role: coordinator\ntask: ${TICKET}-some-slug\ncommit: ${COMMIT}\n` +
    `dequeued_at: ${dequeuedAt}\n\nmerge_and_process coordinator ${COMMIT}\n`
  );
}

function queuedForwardBody({ createdAt }) {
  return (
    `id: fwd1\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: coder\n` +
    `task: ${TICKET}-some-slug\ncommit: 9999999999\ncreated_at: ${createdAt}\n\n` +
    `merge_and_process coder 9999999999\n`
  );
}

function runDone(state) {
  try {
    const out = execFileSync('bash', [state.doneSh], {
      cwd: state.coder2Wt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'coder@2' },
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureFixture(ctx) {
  if (!ctx.bl1637) ctx.bl1637 = {};
  if (!ctx.bl1637.fx) ctx.bl1637.fx = makeSeatFixture();
  return ctx.bl1637;
}

// ── Scenario 02/03: bb subprocess against the real library functions ────

function runBb(program, cwd, env) {
  return execFileSync('bb', ['-e', program], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture swarm root whose roles table declares coder as a task role with its own worktree and coder@2 as a second seat of that stage with its own worktree$/,
    (ctx) => {
      ensureFixture(ctx);
    }
  );

  scoped(/^coder@2 holds a git_handoff for a ticket, dequeued a minute ago$/, (ctx) => {
    const state = ensureFixture(ctx);
    const dequeuedAt = isoSecondsAgo(60);
    const filePath = path.join(state.fx.dirs.coder2.inProcess, '50_x1.handoff');
    fs.writeFileSync(filePath, inProcessBody({ dequeuedAt }));
    state.itemPath = filePath;
    state.dequeuedAt = dequeuedAt;
  });

  scoped(/^a git_handoff naming that ticket, sent by coder@2 (after the dequeue|before the dequeue|never), sits in (its own sent folder|the coder stage's sent folder|no folder at all)$/, (ctx, when, folder) => {
    const state = ensureFixture(ctx);
    if (folder === 'no folder at all') {
      return; // nothing written - the "never sent" row.
    }
    const createdAt = when === 'after the dequeue' ? isoSecondsAgo(30) : isoSecondsAgo(120);
    const dir = folder === 'its own sent folder' ? state.fx.dirs.coder2.sent : state.fx.dirs.coder.sent;
    fs.writeFileSync(path.join(dir, '90_evidence.handoff'), queuedForwardBody({ createdAt }));
  });

  scoped(/^coder@2 runs done_with_current with no flags$/, (ctx) => {
    const state = ensureFixture(ctx);
    state.result = runDone(state.fx);
  });

  scoped(/^the outcome is completed, the inbound in its completed folder$/, (ctx) => {
    const state = ensureFixture(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    const completedPath = path.join(state.fx.dirs.coder2.completed, path.basename(state.itemPath));
    assert.ok(fs.existsSync(completedPath), `expected ${completedPath} in completed/, got: ${state.result.output}`);
  });

  scoped(/^the outcome is refused as FORWARD_NOT_SENT$/, (ctx) => {
    const state = ensureFixture(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /FORWARD_NOT_SENT/, `expected FORWARD_NOT_SENT: ${state.result.output}`);
    assert.ok(fs.existsSync(state.itemPath), 'expected the inbound to still be in place');
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^a fixture swarm root whose roles table declares architect as a task role with no seat rows$/, (ctx) => {
    const root = mkProcessTmpDir('bl1637bare-');
    const architectWt = path.join(root, 'architect');
    const dirs = mailboxDirs(architectWt);
    fs.mkdirSync(dirs.outbox, { recursive: true });
    fs.mkdirSync(dirs.sent, { recursive: true });
    fs.mkdirSync(path.join(architectWt, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(architectWt, '.swarmforge', 'roles.tsv'),
      `architect\tarchitect\t${architectWt}\tswarmforge-architect\tArchitect\tclaude\ttask\n`
    );
    ctx.bl1637Bare = { architectWt };
  });

  scoped(/^the forward-evidence gate lists the folders it scans for architect$/, (ctx) => {
    const program =
      `(load-file "${path.join(REAL_SCRIPTS_DIR, 'forward_evidence_lib.bb')}")` +
      `(println (clojure.string/join "|" (map str (forward-evidence-lib/sent-dirs-for-seat))))`;
    const out = runBb(program, ctx.bl1637Bare.architectWt, { SWARMFORGE_ROLE: 'architect' });
    ctx.bl1637Bare.dirs = out.split('|');
  });

  scoped(/^it lists architect's own sent and outbox folders and nothing else$/, (ctx) => {
    const { architectWt, dirs } = ctx.bl1637Bare;
    assert.equal(dirs.length, 2, `expected exactly 2 dirs, got: ${JSON.stringify(dirs)}`);
    assert.ok(dirs.some((d) => d.endsWith(path.join('handoffs', 'sent'))), `expected architect's own sent dir, got: ${JSON.stringify(dirs)}`);
    assert.ok(dirs.some((d) => d.endsWith(path.join('handoffs', 'outbox'))), `expected architect's own outbox dir, got: ${JSON.stringify(dirs)}`);
    assert.ok(dirs.every((d) => d.startsWith(architectWt)), `expected every dir under architect's own worktree, got: ${JSON.stringify(dirs)}`);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  scoped(/^coder@2's outbox holds a git_handoff addressed to the cleaner$/, (ctx) => {
    const root = mkProcessTmpDir('bl1637daemon-');
    const coderWt = path.join(root, 'coder');
    const coder2Wt = path.join(root, 'coder2');
    const cleanerWt = path.join(root, 'cleaner');
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    for (const wt of [coderWt, coder2Wt, cleanerWt]) {
      fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
    }
    fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'sent'), { recursive: true });
    fs.mkdirSync(path.join(coder2Wt, '.swarmforge', 'handoffs', 'outbox'), { recursive: true });
    fs.mkdirSync(path.join(coder2Wt, '.swarmforge', 'handoffs', 'sent'), { recursive: true });
    const rolesLine =
      `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `coder@2\tcoder2\t${coder2Wt}\tswarmforge-coder2\tCoder@2\tclaude\ttask\n` +
      `cleaner\tcleaner\t${cleanerWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`;
    for (const wt of [root, coderWt, coder2Wt, cleanerWt]) {
      fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesLine);
    }
    const outboxFile = path.join(coder2Wt, '.swarmforge', 'handoffs', 'outbox', '50_fwd.handoff');
    fs.writeFileSync(
      outboxFile,
      `id: fwd1\nfrom: coder\nfrom_seat: coder@2\nto: cleaner\npriority: 50\ntype: git_handoff\n` +
        `role: coder\ntask: ${TICKET}-some-slug\ncommit: 9999999999\ncreated_at: ${isoSecondsAgo(5)}\n\n` +
        `merge_and_process coder 9999999999\n`
    );
    ctx.bl1637Daemon = { root, coderWt, coder2Wt, cleanerWt, outboxFile };
  });

  scoped(/^the daemon's delivery pass runs on that fixture$/, (ctx) => {
    // Drives the REAL filing decision (handoff-lib/seat-filing-role-info)
    // and the REAL move (handoff-inject-lib's own sent-dir/move-with-
    // collision - identical functions handoffd.bb's own two sites use) -
    // never a reimplementation of either. The recipient-notification half
    // of a real delivery pass (tmux wake) is orthogonal to BL-1637's own
    // fix (which file gets filed where) and is not this scenario's
    // concern - real-tmux notification is covered elsewhere.
    const { coder2Wt, outboxFile } = ctx.bl1637Daemon;
    const program =
      `(require '[babashka.fs :as fs])` +
      `(load-file "${path.join(REAL_SCRIPTS_DIR, 'handoff_inject_lib.bb')}")` +
      `(let [content (slurp "${outboxFile}")` +
      `      {:keys [headers]} (handoff-lib/parse-envelope content)` +
      `      roles (handoff-inject-lib/load-roles (fs/path "${coder2Wt}" ".swarmforge" "roles.tsv"))` +
      `      target-dir (handoff-inject-lib/sent-dir (handoff-lib/seat-filing-role-info headers roles))]` +
      `  (handoff-inject-lib/move-with-collision "${outboxFile}" target-dir))`;
    runBb(program, coder2Wt, {});
  });

  scoped(/^the file is in coder@2's sent folder$/, (ctx) => {
    const { coder2Wt, outboxFile } = ctx.bl1637Daemon;
    const target = path.join(coder2Wt, '.swarmforge', 'handoffs', 'sent', path.basename(outboxFile));
    assert.ok(fs.existsSync(target), `expected ${target} to exist`);
    ctx.bl1637Daemon.filedPath = target;
    assert.ok(!fs.existsSync(outboxFile), 'expected the outbox copy to be gone (moved, not copied)');
  });

  scoped(/^its from header still names coder$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl1637Daemon.filedPath, 'utf8');
    assert.match(text, /^from: coder$/m, `expected from: coder, got:\n${text}`);
  });

  scoped(/^its seat header names coder@2$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl1637Daemon.filedPath, 'utf8');
    assert.match(text, /^from_seat: coder@2$/m, `expected from_seat: coder@2, got:\n${text}`);
  });
}

module.exports = { registerSteps };
