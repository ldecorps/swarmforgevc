'use strict';

// BL-995: step handlers for "a sanctioned detached job survives the orphan
// reaper". Every scenario runs REAL processes (argv renamed to match the
// reaper's job pattern, cwd inside the fixture root so job-in-scope?
// holds) against the REAL handoffd_supervisor.bb reap function, loaded
// with the fixture root as its project root (the bl977 stop-file load
// pattern), and the REAL detach_job.sh for the sanctioned path.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'A sanctioned detached job survives the orphan reaper';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SUPERVISOR = path.join(SCRIPTS_DIR, 'handoffd_supervisor.bb');
const DETACH = path.join(SCRIPTS_DIR, 'detach_job.sh');

// The marker makes every probe process uniquely findable and killable; the
// leading "npx vitest" is what matches the reaper's job pattern.
const MARKER = 'bl995-acc-marker';
const JOB_CMD = `exec -a "npx vitest ${MARKER}" sleep 120`;

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl995-'));
  ctx.root = root;
  git(root, ['init', '-q']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'stop'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${root}\tswarmforge-coder\tX\tclaude\ttask\n`);
}

function detach(ctx, { expiresMinutes, log }) {
  const res = spawnSync('bash', [DETACH, log, '--expires-minutes', String(expiresMinutes), '--', 'bash', '-c', JOB_CMD], {
    cwd: ctx.root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, SWARMFORGE_ROLE: 'coder' },
  });
  assert.equal(res.status, 0, `detach_job.sh failed: ${res.stdout}${res.stderr}`);
}

function rawOrphan(ctx) {
  const py = [
    'import os, sys',
    'if os.fork(): os._exit(0)',
    'os.setsid()',
    'if os.fork(): os._exit(0)',
    `os.chdir(${JSON.stringify(ctx.root)})`,
    `os.execvp("bash", ["bash", "-c", ${JSON.stringify(JOB_CMD)}])`,
  ].join('\n');
  const res = spawnSync('python3', ['-c', py], { cwd: ctx.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(res.status, 0, `raw orphan setup failed: ${res.stderr}`);
}

function markerPids(ctx) {
  const res = spawnSync('pgrep', ['-f', MARKER], { encoding: 'utf8' });
  return (res.stdout || '').split('\n').filter(Boolean);
}

function waitForMarker(ctx, present) {
  for (let i = 0; i < 40; i++) {
    const n = markerPids(ctx).length;
    if (present ? n > 0 : n === 0) return;
    execFileSync('sleep', ['0.25']);
  }
}

function sweep(ctx) {
  const expr = `
(binding [*command-line-args* [${JSON.stringify(ctx.root)}]]
  (load-file ${JSON.stringify(SUPERVISOR)}))
(handoffd-supervisor/reap-orphaned-job-processes!)
(println :done)`;
  const res = spawnSync('bb', ['-e', expr], { encoding: 'utf8', timeout: 90000 });
  assert.equal(res.status, 0, `reaper sweep failed: ${res.stderr}`);
}

function cleanup(ctx) {
  spawnSync('pkill', ['-f', MARKER], { encoding: 'utf8' });
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the orphan job reaper is running$/, (ctx) => {
    // Preflight: no stale marker processes from a previous aborted run may
    // pollute this scenario's counts.
    spawnSync('pkill', ['-f', MARKER], { encoding: 'utf8' });
    mkFixture(ctx);
  });

  scoped(/^a long job detached the sanctioned way and registered as deliberate$/, (ctx) => {
    ctx.log = path.join(ctx.root, 'job.log');
    detach(ctx, { expiresMinutes: 10, log: ctx.log });
    waitForMarker(ctx, true);
    assert.ok(markerPids(ctx).length > 0, 'the detached job must be running before the sweep');
    const reg = path.join(ctx.root, '.swarmforge', 'daemon', 'detached-jobs');
    assert.ok(fs.readdirSync(reg).some((f) => f.endsWith('.json')), 'the registration entry must exist');
  });
  scoped(/^a job process orphaned by a crash and never registered$/, (ctx) => {
    rawOrphan(ctx);
    waitForMarker(ctx, true);
    assert.ok(markerPids(ctx).length > 0, 'the orphan must be running before the sweep');
  });
  scoped(/^a registered job whose owner never collected it$/, (ctx) => {
    ctx.log = path.join(ctx.root, 'job.log');
    detach(ctx, { expiresMinutes: 0, log: ctx.log });
    waitForMarker(ctx, true);
  });
  scoped(/^its registration has aged past its limit$/, (ctx) => {
    // --expires-minutes 0 wrote an entry already past its limit; assert
    // the precondition rather than assuming it.
    const reg = path.join(ctx.root, '.swarmforge', 'daemon', 'detached-jobs');
    const entries = fs.readdirSync(reg).filter((f) => f.endsWith('.json'));
    assert.ok(entries.length > 0, 'the registration must exist');
    const entry = JSON.parse(fs.readFileSync(path.join(reg, entries[0]), 'utf8'));
    assert.ok(Date.now() >= entry.expires_at_ms, 'the entry must already be expired');
  });

  scoped(/^the reaper sweeps$/, (ctx) => {
    sweep(ctx);
  });

  scoped(/^the job is still running$/, (ctx) => {
    try {
      assert.ok(markerPids(ctx).length > 0, 'the registered detach must survive the sweep');
    } finally {
      cleanup(ctx);
    }
  });
  scoped(/^the job is killed$/, (ctx) => {
    try {
      waitForMarker(ctx, false);
      assert.equal(markerPids(ctx).length, 0, 'the job must be dead after the sweep');
    } finally {
      if (!ctx.keepForCollection) {
        cleanup(ctx);
      }
    }
  });

  scoped(/^a registered job is killed by the reaper$/, (ctx) => {
    ctx.log = path.join(ctx.root, 'job.log');
    detach(ctx, { expiresMinutes: 0, log: ctx.log });
    waitForMarker(ctx, true);
    sweep(ctx);
    waitForMarker(ctx, false);
    assert.equal(markerPids(ctx).length, 0, 'setup: the expired job must be dead');
  });
  scoped(/^the owning agent collects that run$/, (ctx) => {
    ctx.collected = fs.readFileSync(ctx.log, 'utf8');
  });
  scoped(/^the run's own log names the reaping as the cause$/, (ctx) => {
    try {
      assert.ok(
        /REAPED|KILLED by SIGTERM/.test(ctx.collected),
        `the log must name the reaping (invariant 3):\n${ctx.collected}`
      );
      assert.ok(
        ctx.collected.includes('handoffd'),
        `the log must point at the supervisor as the sender:\n${ctx.collected}`
      );
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
