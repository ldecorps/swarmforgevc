'use strict';

// BL-1986: step handler for "a seat whose pane shows qwen's loop dialog is
// reported stuck at once" (check 5b widened by BL-1985; this slice supplies
// :loop-dialog? from the real pane text). Drives the REAL babysitter_check.sh
// end to end against a disposable fixture root with a REAL tmux server whose
// pane prints qwen's own loop-dialog text — never a hand-rolled fake tmux
// protocol responder, same idiom as bl807BabysitterStuckInProcessOwnerLivenessSteps.js.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { track } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');

const FEATURE = "BL-1986 A seat whose pane shows qwen's loop dialog is reported stuck at once";

const ROLE = 'coder';
const TICKET = 'BL-9001';
const SESSION = `swarmforge-${ROLE}`;

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('bl1986-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  // babysitter_check.bb's active-ticket-count glob throws on a missing dir
  // (unlike the try/caught mailbox globs) - keep it empty, but present.
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  return root;
}

function writeMeminfo(root) {
  const p = path.join(root, 'meminfo');
  fs.writeFileSync(p, 'MemAvailable:    8000000 kB\n');
  return p;
}

function writeRolesTsv(root, worktree) {
  const line = [ROLE, ROLE, worktree, SESSION, ROLE, 'claude', 'task'].join('\t');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${line}\n`);
}

// A claim a couple of minutes old, well under check 5b's own 60m dwell
// threshold - the scenario's own point is that the loop dialog raises the
// CRIT "at once", not after a long dwell.
function writeHeldHandoff(worktree) {
  const dir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'bl1986-fixture.handoff');
  const dequeuedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  fs.writeFileSync(
    filePath,
    [
      'id: bl1986-fixture',
      'from: coordinator',
      `to: ${ROLE}`,
      'type: git_handoff',
      `task: ${TICKET}`,
      `dequeued_at: ${dequeuedAt}`,
      '',
    ].join('\n')
  );
  return filePath;
}

// Starts a REAL tmux server with one pane that prints qwen's own
// loop-detection dialog text and holds - the real capture-pane output
// drives loop-dialog? exactly as the live swarm's pane would, never a
// hand-rolled busy/dialog flag. The pane's own process is renamed so a
// real `ps` snapshot finds a live "claude" process as a child of the
// pane's shell (mirrors startTmuxSession in bl807's own file).
function startTmuxSession(root, dialogOnPane) {
  const sockDir = mkSocketFixtureRoot('bl1986-sock-');
  const sock = path.join(sockDir, 'bl1986.sock');
  const scriptPath = path.join(sockDir, 'pane.sh');
  const dialogText = dialogOnPane
    ? 'A potential loop was detected.\n❯ 1. Keep loop detection enabled\n  2. Disable loop detection\n'
    : 'ready\n';
  fs.writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env bash',
      `exec -a "claude --remote-control fake" bash -c 'printf "${dialogText.replace(/\n/g, '\\n')}"; sleep 999' &`,
      'wait',
      '',
    ].join('\n')
  );
  fs.chmodSync(scriptPath, 0o755);
  execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', SESSION, 'bash', scriptPath]);
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  return { sock, sockDir };
}

function cleanup(ctx) {
  const st = ctx.bl1986;
  if (!st) return;
  if (st.sock) {
    try {
      execFileSync('tmux', ['-S', st.sock, 'kill-server'], { stdio: 'ignore' });
    } catch {
      /* server already gone - fine */
    }
  }
}

function runSweep(ctx) {
  const st = ctx.bl1986;
  const meminfoPath = writeMeminfo(st.root);
  const result = spawnSync('bash', [CHECK_SH, st.root], {
    encoding: 'utf8',
    env: { ...process.env, BABYSITTER_MEMINFO_PATH: meminfoPath },
  });
  st.cliStdout = `${result.stdout || ''}${result.stderr || ''}`;
}

function ensureState(ctx) {
  if (!ctx.bl1986) {
    const root = mkFixtureRoot();
    track(root);
    const worktree = path.join(root, '.worktrees', ROLE);
    fs.mkdirSync(worktree, { recursive: true });
    writeRolesTsv(root, worktree);
    writeHeldHandoff(worktree);
    ctx.bl1986 = { root, worktree, sock: null, sockDir: null, cliStdout: '' };
  }
  return ctx.bl1986;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a local-model seat holding a ticket with no commit since its claim$/, (ctx) => {
    ensureState(ctx);
  });

  // ── Given ───────────────────────────────────────────────────────────
  scoped(/^qwen's loop-detection dialog is on that seat's pane$/, (ctx) => {
    const st = ensureState(ctx);
    const { sock, sockDir } = startTmuxSession(st.root, true);
    st.sock = sock;
    st.sockDir = sockDir;
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^babysitter sweeps$/, (ctx) => {
    runSweep(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^it raises the seat-stuck CRIT for that seat, naming the loop dialog$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = `seat-stuck-${ROLE}`;
      if (!st.cliStdout.includes(`CRIT [${key}]`)) {
        throw new Error(`expected a CRIT [${key}] finding; got:\n${st.cliStdout}`);
      }
      if (!st.cliStdout.includes("qwen's loop dialog is on the pane")) {
        throw new Error(`expected the CRIT to name the loop dialog; got:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
