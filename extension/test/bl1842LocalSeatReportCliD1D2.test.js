'use strict';

// BL-1842 QA bounce (backlog/evidence/BL-1837-QA-20261001.md is BL-1837's;
// this ticket's own QA bounce is backlog/evidence/BL-1842-QA-20261001.md):
//
// D1 - local_seat_report_cli.bb's default-ollama-log picked the swarm log
// (.swarmforge/ollama/serve.log) by EXISTENCE alone whenever it existed,
// even when it was stale and the live server was actually writing the
// operator log (.swarmforge/ollama-serve-operator.log). Fixed to pick
// whichever of the two has the newer mtime.
//
// D2 - process-alive? matched `pgrep -f <worktree-path>` against every
// process's ARGV, so a live seat whose argv never names its worktree read
// as down, and any unrelated command line that happens to NAME the path
// (a human's own shell) read as alive. Fixed to resolve each process's
// CURRENT WORKING DIRECTORY (/proc/<pid>/cwd on Linux) instead.
//
// Both drive the REAL, shipped local_seat_report_cli.bb via execFileSync -
// never a reimplementation of its internal selection/matching logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REPORT_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_seat_report_cli.bb');

function runReport(root, seat, extraArgs = []) {
  return execFileSync('bb', [REPORT_CLI, root, '--seat', seat, ...extraArgs], { encoding: 'utf8' });
}

function touch(file, contents, mtimeMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  const t = new Date(mtimeMs);
  fs.utimesSync(file, t, t);
}

// ── D1: the NEWER-mtime log wins, not the swarm log by mere existence ──────

test('default-ollama-log: a stale swarm log loses to a newer operator log', () => {
  const root = mkTmpDir('bl1842-d1-');
  const swarmLog = path.join(root, '.swarmforge', 'ollama', 'serve.log');
  const operatorLog = path.join(root, '.swarmforge', 'ollama-serve-operator.log');
  const base = Date.parse('2026-09-30T00:00:00Z');

  // Stale swarm log: exists, but written hours before the live server
  // started - no load_tensors line at all (a prior, dead server's log).
  touch(swarmLog, 'old server startup, no load info\n', base);
  // Live operator log: written AFTER the swarm log, carries the real
  // serving facts.
  touch(
    operatorLog,
    'llama_context: n_ctx = 32768\n' +
      'load_tensors: offloaded 65/65 layers to GPU\n' +
      'llama_kv_cache:   type_k = q8_0\n',
    base + 3600000
  );

  const out = runReport(root, 'coder@iq3', ['--now-ms', String(base + 3600000 + 60000)]);
  assert.match(out, /Served: 65\/65 layers on GPU/, `expected the newer (operator) log's serving facts in:\n${out}`);
});

test('default-ollama-log: existence alone still decides when only one candidate exists', () => {
  const root = mkTmpDir('bl1842-d1-single-');
  const operatorLog = path.join(root, '.swarmforge', 'ollama-serve-operator.log');
  touch(operatorLog, 'load_tensors: offloaded 10/40 layers to GPU\n', Date.now());

  const out = runReport(root, 'coder@iq3');
  assert.match(out, /Served: 10\/40 layers on GPU/, `expected the only candidate log's facts in:\n${out}`);
});

// ── D2: process-alive? reads cwd, not argv ──────────────────────────────────

function spawnInCwd(cwd) {
  // A plain `sleep` with no argument naming cwd/worktree at all - the exact
  // shape QA's D2 observed (a live qwen pid whose argv never named its
  // worktree).
  const child = spawn('sleep', ['30'], { cwd, stdio: 'ignore', detached: true });
  child.unref();
  return child;
}

test('process-alive? (via State:): a live process whose cwd is the worktree reads alive even though its argv never names the path', async () => {
  const root = mkTmpDir('bl1842-d2-alive-');
  const worktree = path.join(root, '.worktrees', 'coder-iq3');
  fs.mkdirSync(worktree, { recursive: true });
  const child = spawnInCwd(worktree);
  try {
    // Give the child a moment to actually open that cwd before polling it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const out = runReport(root, 'coder@iq3');
    assert.match(out, /^State: idle/, `expected a live seat (cwd match) to read idle, not down:\n${out}`);
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
});

test('process-alive? (via State:): an unrelated process whose ARGV names the worktree path, but whose cwd is elsewhere, does not count as the seat', async () => {
  const root = mkTmpDir('bl1842-d2-decoy-');
  const worktree = path.join(root, '.worktrees', 'coder-iq3');
  const elsewhere = mkTmpDir('bl1842-d2-decoy-cwd-');
  fs.mkdirSync(worktree, { recursive: true });
  // Decoy: argv literally contains the worktree path (what pgrep -f alone
  // would have matched), but its cwd is NOT the worktree.
  const decoy = spawn('sleep', [`30 # ${worktree}`], { cwd: elsewhere, stdio: 'ignore', detached: true, shell: true });
  decoy.unref();
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const out = runReport(root, 'coder@iq3');
    assert.match(out, /^State: down/, `expected a decoy argv match with no real cwd match to read down:\n${out}`);
  } finally {
    try { process.kill(decoy.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
});
