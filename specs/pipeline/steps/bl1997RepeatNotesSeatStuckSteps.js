'use strict';

// BL-1997: step handler for "A seat collecting REPEAT notes with no commit
// is reported stuck" (check 5b widened again, this slice wires BL-1996's
// counter in). Drives the REAL babysitter_check.sh end to end against a
// disposable fixture root with a REAL qwen session jsonl file under
// SWARMFORGE_QWEN_PROJECTS_DIR - never a hand-rolled restatement of the
// count or the stuck-decision logic. Copies bl1986LoopDialogSeatStuckSteps.
// js's fixture root / roles row / held handoff / sweep shape, replacing its
// tmux loop-dialog pane with a qwen chats/*.jsonl file of REPEAT notes.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { track } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');
const LOCAL_SEAT_REPORT_LIB = path.join(SCRIPTS, 'local_seat_report_lib.bb');

const FEATURE = 'BL-1997 A seat collecting REPEAT notes with no commit is reported stuck';

const ROLE = 'coder';
const TICKET = 'BL-9002';
const SESSION = `swarmforge-${ROLE}`;

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('bl1997-');
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

// A claim a few minutes old, well under check 5b's own dwell threshold -
// the scenario's own point is that ten REPEAT notes raise the CRIT on
// their own, regardless of dwell.
function writeHeldHandoff(worktree) {
  const dir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'bl1997-fixture.handoff');
  const claimAt = new Date(Date.now() - 2 * 60 * 1000);
  fs.writeFileSync(
    filePath,
    [
      'id: bl1997-fixture',
      'from: coordinator',
      `to: ${ROLE}`,
      'type: git_handoff',
      `task: ${TICKET}`,
      `dequeued_at: ${claimAt.toISOString()}`,
      '',
    ].join('\n')
  );
  return { filePath, claimAt };
}

function initGitWorktree(worktree) {
  execFileSync('git', ['-C', worktree, 'init', '-q']);
  execFileSync('git', ['-C', worktree, 'config', 'user.email', 'bl1997@example.com']);
  execFileSync('git', ['-C', worktree, 'config', 'user.name', 'BL-1997 fixture']);
  fs.writeFileSync(path.join(worktree, 'README.md'), 'fixture\n');
  execFileSync('git', ['-C', worktree, 'add', '-A']);
  execFileSync('git', ['-C', worktree, 'commit', '-q', '-m', 'init']);
}

// bb's qwen-cwd-key: every '/' and '.' in the absolute worktree path
// becomes '-' - computed via the real lib (never restated) so a drift in
// that scheme shows up here too.
function qwenCwdKey(worktree) {
  const res = spawnSync('bb', ['-e', `(load-file ${JSON.stringify(LOCAL_SEAT_REPORT_LIB)}) (print (local-seat-report-lib/qwen-cwd-key ${JSON.stringify(worktree)}))`], { encoding: 'utf8', timeout: 60000 });
  if (res.status !== 0) {
    throw new Error(`qwen-cwd-key lib call failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

function repeatNoteLine(n) {
  return `REPEAT: you have now made this exact read_file call ${n} times since your last edit`;
}

function toolResultLine(iso, output) {
  return JSON.stringify({
    type: 'tool_result',
    timestamp: iso,
    message: { parts: [{ functionResponse: { response: { output } } }] },
  });
}

// Writes a qwen session file carrying `count` REPEAT notes, all stamped
// after the claim, under <projectsDir>/<qwen-cwd-key worktree>/chats/ - the
// exact file layout current-session-repeat-notes reads (the newest *.jsonl
// file in that directory).
function writeQwenSession(projectsDir, worktree, claimAt, count) {
  const chatsDir = path.join(projectsDir, qwenCwdKey(worktree), 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  const afterClaim = new Date(claimAt.getTime() + 30 * 1000).toISOString();
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(toolResultLine(afterClaim, repeatNoteLine(i + 1)));
  }
  fs.writeFileSync(path.join(chatsDir, 'session1.jsonl'), lines.join('\n') + '\n');
}

function ensureState(ctx) {
  if (!ctx.bl1997) {
    const root = mkFixtureRoot();
    track(root);
    const worktree = path.join(root, '.worktrees', ROLE);
    fs.mkdirSync(worktree, { recursive: true });
    initGitWorktree(worktree);
    writeRolesTsv(root, worktree);
    const { claimAt } = writeHeldHandoff(worktree);
    const projectsDir = mkSocketFixtureRoot('bl1997-qwen-');
    ctx.bl1997 = { root, worktree, claimAt, projectsDir, cliStdout: '' };
  }
  return ctx.bl1997;
}

function runSweep(ctx) {
  const st = ctx.bl1997;
  const meminfoPath = writeMeminfo(st.root);
  const result = spawnSync('bash', [CHECK_SH, st.root], {
    encoding: 'utf8',
    env: { ...process.env, BABYSITTER_MEMINFO_PATH: meminfoPath, SWARMFORGE_QWEN_PROJECTS_DIR: st.projectsDir },
  });
  st.cliStdout = `${result.stdout || ''}${result.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a local-model seat holding a ticket with no commit since its claim$/, (ctx) => {
    ensureState(ctx);
  });

  // ── Given ───────────────────────────────────────────────────────────
  scoped(/^the seat's current session carries (\d+) REPEAT notes since the claim$/, (ctx, count) => {
    const st = ensureState(ctx);
    writeQwenSession(st.projectsDir, st.worktree, st.claimAt, Number(count));
  });

  scoped(/^the seat then commits for the ticket$/, (ctx) => {
    const st = ensureState(ctx);
    fs.writeFileSync(path.join(st.worktree, 'progress.txt'), 'done\n');
    execFileSync('git', ['-C', st.worktree, 'add', '-A']);
    execFileSync('git', ['-C', st.worktree, 'commit', '-q', '-m', `${TICKET}: fixture progress\n\nBy ${ROLE}.`]);
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^babysitter sweeps$/, (ctx) => {
    runSweep(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^it raises the seat-stuck CRIT for that seat, naming the REPEAT count$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = `seat-stuck-${ROLE}`;
      if (!st.cliStdout.includes(`CRIT [${key}]`)) {
        throw new Error(`expected a CRIT [${key}] finding; got:\n${st.cliStdout}`);
      }
      if (!st.cliStdout.includes('REPEAT notes since the claim')) {
        throw new Error(`expected the CRIT to name the REPEAT count; got:\n${st.cliStdout}`);
      }
    } finally {
      // no tmux/socket process to tear down for this slice - mkSocketFixtureRoot's
      // own exit-tracking (via fixtureReaper) handles the fixture directories.
    }
  });

  scoped(/^it raises no seat-stuck CRIT for that seat$/, (ctx) => {
    const st = ensureState(ctx);
    const key = `seat-stuck-${ROLE}`;
    if (st.cliStdout.includes(`CRIT [${key}]`)) {
      throw new Error(`expected no seat-stuck CRIT for ${ROLE}; got:\n${st.cliStdout}`);
    }
  });
}

module.exports = { registerSteps };
