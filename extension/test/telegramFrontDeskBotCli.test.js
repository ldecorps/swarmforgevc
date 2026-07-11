const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCliArgs, conciergeTickIntervalMs, readRoleTicket } = require('../out/tools/telegram-front-desk-bot');

// parseNextSseRecord's own tests live in telegramFrontDeskBotCore.test.js -
// its implementation moved there (the testable core); this file re-exports
// it only for backward compatibility, so testing it again here would just
// be the same assertions against the same function through a second import
// path.

// ── parseCliArgs (pure) ───────────────────────────────────────────────────

test('parseCliArgs returns both positional args when given', () => {
  assert.deepEqual(parseCliArgs(['http://127.0.0.1:9000', '/some/target']), {
    bridgeUrl: 'http://127.0.0.1:9000',
    targetPath: '/some/target',
  });
});

test('parseCliArgs returns null when no arguments are given', () => {
  assert.equal(parseCliArgs([]), null);
});

test('parseCliArgs returns null when only the bridge url is given', () => {
  assert.equal(parseCliArgs(['http://127.0.0.1:9000']), null);
});

// ── conciergeTickIntervalMs (pure, BL-300) ───────────────────────────────

test('conciergeTickIntervalMs defaults to 30000ms when the env var is unset', () => {
  assert.equal(conciergeTickIntervalMs(undefined), 30_000);
});

test('conciergeTickIntervalMs uses a valid positive override', () => {
  assert.equal(conciergeTickIntervalMs('5000'), 5000);
});

test('conciergeTickIntervalMs falls back to the default for a non-numeric value', () => {
  assert.equal(conciergeTickIntervalMs('not-a-number'), 30_000);
});

test('conciergeTickIntervalMs falls back to the default for a non-positive value', () => {
  assert.equal(conciergeTickIntervalMs('0'), 30_000);
  assert.equal(conciergeTickIntervalMs('-100'), 30_000);
});

// ── readRoleTicket (thin fs adapter, BL-301) ─────────────────────────────
// A real .swarmforge/roles.tsv + real handoff fixtures - mirrors
// liveHolder.test.js/ticketHoldingWindows.test.js's own fixture shape,
// since readRoleTicket composes parseRolesTsv + readRoleHoldingWindows +
// computeCurrentHolders, all themselves tested against real fs elsewhere.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-role-ticket-'));
}

function writeRolesTsv(targetPath, roles) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  const tsv = roles.map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.role, 'claude', 'task'].join('\t')).join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function writeHandoff(worktreePath, subdir, filename, headers) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

test('readRoleTicket maps a role to the ticket its currently-open (in_process) handoff names', () => {
  const target = mkTmp();
  const coderWorktree = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWorktree }]);
  writeHandoff(coderWorktree, 'in_process', '00_test.handoff', {
    task: 'BL-123-a-fine-feature',
    dequeued_at: '2026-07-09T08:00:00Z',
  });

  assert.deepEqual(readRoleTicket(target), { coder: 'BL-123' });
});

test('readRoleTicket omits a role with no currently-open window (only completed handoffs)', () => {
  const target = mkTmp();
  const coderWorktree = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWorktree }]);
  writeHandoff(coderWorktree, 'completed', '00_test.handoff', {
    task: 'BL-123-a-fine-feature',
    dequeued_at: '2026-07-09T08:00:00Z',
    completed_at: '2026-07-09T09:00:00Z',
  });

  assert.deepEqual(readRoleTicket(target), {});
});

test('readRoleTicket maps multiple roles to their own held tickets independently', () => {
  const target = mkTmp();
  const coderWorktree = mkTmp();
  const cleanerWorktree = mkTmp();
  writeRolesTsv(target, [
    { role: 'coder', worktreePath: coderWorktree },
    { role: 'cleaner', worktreePath: cleanerWorktree },
  ]);
  writeHandoff(coderWorktree, 'in_process', '00_test.handoff', { task: 'BL-1-x', dequeued_at: '2026-07-09T08:00:00Z' });
  writeHandoff(cleanerWorktree, 'in_process', '00_test.handoff', { task: 'BL-2-y', dequeued_at: '2026-07-09T08:00:00Z' });

  assert.deepEqual(readRoleTicket(target), { coder: 'BL-1', cleaner: 'BL-2' });
});

test('readRoleTicket returns an empty map when roles.tsv is missing (never a crash)', () => {
  const target = mkTmp();
  assert.deepEqual(readRoleTicket(target), {});
});

// ── subprocess: main() wiring (no real network - fails before any request) ──

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'telegram-front-desk-bot.js');

function runCli(args, env) {
  try {
    const out = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 5000 });
    return { exitCode: 0, stdout: out };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

test('no args: exits non-zero and prints usage to stderr', () => {
  const result = runCli([], {});
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: telegram-front-desk-bot\.js/);
});

test('a missing TELEGRAM_BOT_TOKEN exits non-zero with a clear message, never a raw network error', () => {
  const result = runCli(['http://127.0.0.1:1', '/tmp/nonexistent-target'], { TELEGRAM_BOT_TOKEN: '' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /TELEGRAM_BOT_TOKEN is not set/);
});

test('a missing BRIDGE_CONTROL_TOKEN exits non-zero with a clear message', () => {
  const result = runCli(['http://127.0.0.1:1', '/tmp/nonexistent-target'], {
    TELEGRAM_BOT_TOKEN: 'fake',
    TELEGRAM_CHAT_ID: 'fake',
    TELEGRAM_PRINCIPAL_USER_ID: '111',
    BRIDGE_TOKEN: 'fake',
    BRIDGE_CONTROL_TOKEN: '',
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /BRIDGE_CONTROL_TOKEN is not set/);
});
