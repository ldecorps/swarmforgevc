'use strict';

// BL-2091: step handler for "A hardener whose mutation run is under way
// gets a longer seat-stuck clock". Drives the REAL babysitter_check.sh
// (check 5b, check-seat-ticket-stuck) against a disposable fixture root -
// never a restatement of the threshold-picking logic. Copies
// bl1997RepeatNotesSeatStuckSteps.js's shape: a fixture root, a roles row,
// a held in_process handoff with a claim timestamp, and a real sweep.
//
// The role is bound by a LATER step than the progress-file step in both
// the Scenario and the Outline (Given the seat is the X / And the
// progress file was written <when> the claim / And the hold is <N>
// minutes old) - the claim timestamp (and so the progress file's own
// relative timestamp) is only known once "the hold is N minutes old"
// runs. The progress-file step therefore only records the intent
// (`progressWhen`); "the hold is N minutes old" writes the held handoff
// AND, if an intent was recorded, the progress file at claim +/- 1 minute.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { track } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');

const FEATURE = 'BL-2091 A hardener whose mutation run is under way gets a longer seat-stuck clock';

const TICKET = 'BL-9091';

// The ticket's own direction: "Validate <role>, <when> and <minutes>
// against explicit KNOWN_VALUES" - a typo'd placeholder fails loudly here
// rather than silently matching nothing (BL-1602).
const KNOWN_ROLES = { hardender: true, coder: true };
const KNOWN_WHENS = { after: true, before: true };
const KNOWN_MINUTES = { 91: true, 150: true, 60: true };

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('bl2091-');
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

function writeRolesTsv(root, role, worktree) {
  const session = `swarmforge-${role}`;
  const line = [role, role, worktree, session, role, 'claude', 'task'].join('\t');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${line}\n`);
}

function initGitWorktree(worktree) {
  execFileSync('git', ['-C', worktree, 'init', '-q']);
  execFileSync('git', ['-C', worktree, 'config', 'user.email', 'bl2091@example.com']);
  execFileSync('git', ['-C', worktree, 'config', 'user.name', 'BL-2091 fixture']);
  fs.writeFileSync(path.join(worktree, 'README.md'), 'fixture\n');
  execFileSync('git', ['-C', worktree, 'add', '-A']);
  execFileSync('git', ['-C', worktree, 'commit', '-q', '-m', 'init']);
}

// extension/src/mutation/mutationProgressFile.ts's defaultProgressFilePath -
// <worktree>/.swarmforge/mutation-progress/<name>.json. Written under the
// seat's own name, the shape a non-numbered seat's writer uses.
function mutationProgressPath(worktree, role) {
  return path.join(worktree, '.swarmforge', 'mutation-progress', `${role}.json`);
}

function writeMutationProgress(worktree, role, updatedAt) {
  const p = mutationProgressPath(worktree, role);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    tested: 10, total: 10, percent: 100, killed: 10, survived: 0, timedOut: 0,
    elapsed_s: 1, eta_s: null, updated_at: updatedAt.toISOString(), status: 'done', health: 'healthy',
  }));
}

function writeHeldHandoff(worktree, role, claimAt) {
  const dir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'bl2091-fixture.handoff');
  fs.writeFileSync(
    filePath,
    [
      'id: bl2091-fixture',
      'from: coordinator',
      `to: ${role}`,
      'type: git_handoff',
      `task: ${TICKET}`,
      `dequeued_at: ${claimAt.toISOString()}`,
      '',
    ].join('\n')
  );
  return filePath;
}

function ensureState(ctx) {
  if (!ctx.bl2091) {
    const root = mkFixtureRoot();
    track(root);
    ctx.bl2091 = { root, role: null, worktree: null, progressWhen: null, cliStdout: '' };
  }
  return ctx.bl2091;
}

function setupRole(ctx, role) {
  assert.ok(role in KNOWN_ROLES, `BL-2091: unrecognized role "${role}" - not in KNOWN_VALUES`);
  const st = ensureState(ctx);
  st.role = role;
  st.worktree = path.join(st.root, '.worktrees', role);
  fs.mkdirSync(st.worktree, { recursive: true });
  initGitWorktree(st.worktree);
  writeRolesTsv(st.root, role, st.worktree);
  return st;
}

function recordProgressWhen(ctx, when) {
  assert.ok(when in KNOWN_WHENS, `BL-2091: unrecognized "when" value "${when}" - not in KNOWN_VALUES`);
  const st = ensureState(ctx);
  st.progressWhen = when;
}

function setHoldAge(ctx, minutesStr) {
  const minutes = Number(minutesStr);
  assert.ok(minutes in KNOWN_MINUTES, `BL-2091: unrecognized minutes value "${minutesStr}" - not in KNOWN_VALUES`);
  const st = ensureState(ctx);
  assert.ok(st.role && st.worktree, 'BL-2091: "the seat is the <role>" must run before "the hold is N minutes old"');
  const claimAt = new Date(Date.now() - minutes * 60 * 1000);
  writeHeldHandoff(st.worktree, st.role, claimAt);
  if (st.progressWhen) {
    const offsetMs = (st.progressWhen === 'after' ? 1 : -1) * 60 * 1000;
    writeMutationProgress(st.worktree, st.role, new Date(claimAt.getTime() + offsetMs));
  }
  st.claimAt = claimAt;
}

function runSweep(ctx) {
  const st = ensureState(ctx);
  const meminfoPath = writeMeminfo(st.root);
  const result = spawnSync('bash', [CHECK_SH, st.root], {
    encoding: 'utf8',
    env: { ...process.env, BABYSITTER_MEMINFO_PATH: meminfoPath },
  });
  st.cliStdout = `${result.stdout || ''}${result.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ─────────────────────────────────────────────────────────
  scoped(/^a seat holding a ticket with no commit since its claim$/, (ctx) => {
    ensureState(ctx);
  });

  // ── Given: role (literal scenario 01, then the outline placeholder) ────
  scoped(/^the seat is the hardender$/, (ctx) => {
    setupRole(ctx, 'hardender');
  });
  scoped(/^the seat is the (.+?)$/, (ctx, role) => {
    setupRole(ctx, role);
  });

  // ── Given: progress-file intent ─────────────────────────────────────────
  scoped(/^the seat's mutation progress file was written after the claim$/, (ctx) => {
    recordProgressWhen(ctx, 'after');
  });
  scoped(/^the seat's mutation progress file was written (.+?) the claim$/, (ctx, when) => {
    recordProgressWhen(ctx, when);
  });

  // ── Given: hold age (writes the handoff and, if recorded, the progress file) ─
  scoped(/^the hold is 91 minutes old$/, (ctx) => {
    setHoldAge(ctx, '91');
  });
  scoped(/^the hold is (.+?) minutes old$/, (ctx, minutes) => {
    setHoldAge(ctx, minutes);
  });

  // ── When ─────────────────────────────────────────────────────────────────
  scoped(/^babysitter sweeps$/, (ctx) => {
    runSweep(ctx);
  });

  // ── Then ─────────────────────────────────────────────────────────────────
  scoped(/^it raises no seat-stuck CRIT for that seat$/, (ctx) => {
    const st = ensureState(ctx);
    const key = `seat-stuck-${st.role}`;
    if (st.cliStdout.includes(`CRIT [${key}]`)) {
      throw new Error(`expected no seat-stuck CRIT for ${st.role}; got:\n${st.cliStdout}`);
    }
  });

  scoped(/^it raises the seat-stuck CRIT for that seat, naming a (.+?)m threshold$/, (ctx, minutesStr) => {
    const minutes = Number(minutesStr);
    assert.ok(minutes in KNOWN_MINUTES, `BL-2091: unrecognized minutes value "${minutesStr}" - not in KNOWN_VALUES`);
    const st = ensureState(ctx);
    const key = `seat-stuck-${st.role}`;
    if (!st.cliStdout.includes(`CRIT [${key}]`)) {
      throw new Error(`expected a CRIT [${key}] finding; got:\n${st.cliStdout}`);
    }
    const thresholdText = `threshold ${minutes}m`;
    if (!st.cliStdout.includes(thresholdText)) {
      throw new Error(`expected the CRIT to name "${thresholdText}"; got:\n${st.cliStdout}`);
    }
  });
}

module.exports = { registerSteps };
