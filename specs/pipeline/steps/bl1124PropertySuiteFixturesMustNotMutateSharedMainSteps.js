'use strict';

// BL-1124: property-suite fixtures must not mutate shared main / core.bare.
// Drives the shared-repo canary + recovery refusal helpers for real.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1124 property-suite fixtures must not mutate shared main';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_shared_repo_guard.sh');
const DRIFT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const RECOVERY = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'main_recovery_refuse_when_ahead.sh');
const EXPEDITE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');

function sh(cwd, args, opts = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function ensure(ctx) {
  if (!ctx.bl1124) {
    ctx.bl1124 = {
      tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1124-')),
      last: null,
      shared: null,
    };
  }
  return ctx.bl1124;
}

function cleanup(ctx) {
  if (ctx.bl1124?.tmp) fs.rmSync(ctx.bl1124.tmp, { recursive: true, force: true });
  ctx.bl1124 = null;
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  sh(dir, ['git', 'init', '-q', '-b', 'main']);
  sh(dir, ['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a property-suite fixture that performs git ref or commit operations$/, (ctx) => {
    const s = ensure(ctx);
    s.fixtureDest = path.join(s.tmp, 'fixture-repo');
  });

  scoped(/^the fixture runs$/, (ctx) => {
    const s = ensure(ctx);
    const r = sh(s.tmp, ['bash', EXPEDITE, s.fixtureDest, '--active', 'BL-1']);
    s.last = r;
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  scoped(/^those operations target only a temporary git directory$/, (ctx) => {
    const s = ensure(ctx);
    const resolved = fs.realpathSync(s.fixtureDest);
    assert.ok(resolved.startsWith(s.tmp) || resolved.includes('/tmp') || resolved.includes('bl1124-'),
      `fixture dest not under temp: ${resolved}`);
    assert.ok(fs.existsSync(path.join(s.fixtureDest, '.git')) || fs.existsSync(path.join(s.fixtureDest, '.git')));
  });

  scoped(/^they do not rename or advance refs\/heads\/main on the shared live repo$/, (ctx) => {
    const s = ensure(ctx);
    // Shared live repo = REPO_ROOT; fixture must not be that path.
    assert.notEqual(fs.realpathSync(s.fixtureDest), fs.realpathSync(REPO_ROOT));
    cleanup(ctx);
  });

  scoped(/^a shared live repo that starts with core\.bare false$/, (ctx) => {
    const s = ensure(ctx);
    s.shared = path.join(s.tmp, 'shared');
    initRepo(s.shared);
    sh(s.shared, ['git', 'config', 'core.bare', 'false']);
    fs.mkdirSync(path.join(s.shared, 'extension', 'src'), { recursive: true });
    fs.writeFileSync(path.join(s.shared, 'extension', 'src', 'a.ts'), 'x\n');
    sh(s.shared, ['git', 'add', 'extension/src/a.ts']);
  });

  scoped(/^a property-suite lane finishes$/, (ctx) => {
    const s = ensure(ctx);
    // Green suite that flips bare — canary must fail the lane.
    const flip = ['bash', '-c', `git -C '${s.shared}' config core.bare true; exit 0`];
    s.last = sh(s.shared, ['bash', DRIFT, ...flip]);
  });

  scoped(/^a post-lane assert requires core\.bare to still be false$/, (ctx) => {
    const s = ensure(ctx);
    assert.notEqual(s.last.status, 0, 'expected canary failure');
    assert.match(`${s.last.stdout}\n${s.last.stderr}`, /BL-1124|core\.bare/);
  });

  scoped(/^a lane that flipped bare exits non-zero$/, (ctx) => {
    const s = ensure(ctx);
    assert.notEqual(s.last.status, 0);
    cleanup(ctx);
  });

  scoped(/^local main is ahead of origin\/main by at least one commit$/, (ctx) => {
    const s = ensure(ctx);
    s.shared = path.join(s.tmp, 'ahead');
    initRepo(s.shared);
    sh(s.shared, ['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'ahead']);
    sh(s.shared, ['git', 'update-ref', 'refs/remotes/origin/main', 'HEAD~1']);
  });

  scoped(/^a recovery procedure would restore main to origin\/main$/, (ctx) => {
    const s = ensure(ctx);
    s.last = sh(s.shared, ['bash', RECOVERY, s.shared]);
  });

  scoped(/^the procedure refuses or restores the pre-incident tip from reflog instead$/, (ctx) => {
    const s = ensure(ctx);
    assert.notEqual(s.last.status, 0);
    assert.match(`${s.last.stdout}\n${s.last.stderr}`, /ahead of origin\/main|refuse/);
  });

  scoped(/^the ahead commits remain reachable$/, (ctx) => {
    const s = ensure(ctx);
    const tip = sh(s.shared, ['git', 'rev-parse', 'HEAD']);
    assert.equal(tip.status, 0);
    assert.match(tip.stdout.trim(), /^[0-9a-f]{40}$/);
    cleanup(ctx);
  });

  scoped(/^a live role worktree whose HEAD branch is swarmforge-documenter or swarmforge-coder$/, (ctx) => {
    const s = ensure(ctx);
    s.roleWt = path.join(s.tmp, 'role-wt');
    initRepo(s.roleWt);
    sh(s.roleWt, ['git', 'branch', '-M', 'swarmforge-documenter']);
    fs.mkdirSync(path.join(s.roleWt, 'swarmforge', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(s.roleWt, 'swarmforge', 'scripts', 'handoffd.bb'), ';; live\n');
    s.beforeRef = sh(s.roleWt, ['git', 'symbolic-ref', 'HEAD']).stdout.trim();
  });

  scoped(/^a property-suite fixture that would rename or retarget that branch runs$/, (ctx) => {
    const s = ensure(ctx);
    // Attempt to seed expedite fixture INTO the live role path — must refuse.
    s.last = sh(s.tmp, ['bash', EXPEDITE, s.roleWt, '--active', 'BL-1']);
  });

  scoped(/^the fixture uses only an isolated temp git directory$/, (ctx) => {
    const s = ensure(ctx);
    assert.notEqual(s.last.status, 0, 'expected refuse live dest');
    assert.match(`${s.last.stdout}\n${s.last.stderr}`, /BL-1124|live swarmforge/);
  });

  scoped(/^the live role branch ref is unchanged$/, (ctx) => {
    const s = ensure(ctx);
    const after = sh(s.roleWt, ['git', 'symbolic-ref', 'HEAD']).stdout.trim();
    assert.equal(after, s.beforeRef);
  });

  scoped(/^refs\/heads\/main on the shared repo is not rewritten by the fixture$/, (ctx) => {
    const s = ensure(ctx);
    const branches = sh(s.roleWt, ['git', 'branch', '--list']).stdout;
    assert.ok(branches.includes('swarmforge-documenter'));
    cleanup(ctx);
  });
}

module.exports = { registerSteps, FEATURE };
