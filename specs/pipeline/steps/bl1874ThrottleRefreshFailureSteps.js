'use strict';

// BL-1874: step handlers for "A failed throttle refresh never leaves an
// older recommendation in force". Drives the REAL, compiled artifacts end
// to end, the same way BL-432's own steps do:
//   - "the coordinator decides whether to promote the next item" shells to
//     the REAL effective_backlog_depth_cli.bb, which itself shells to the
//     REAL compiled emit-throttle-recommendation.js.
//   - The refresh is made to fail not with chmod (the Engineering Rules
//     forbid failure simulation that way) but with a real mkdirSync failure (EEXIST/ENOTDIR, platform-dependent): a FILE
//     sits where the telemetry directory
//     (.swarmforge/telemetry/observatory-signals.json's own parent) must
//     be, so persistReworkSignal's own `fs.mkdirSync(dirname, {recursive})`
//     throws for real.
// BL-425: "the coordinator decides whether to promote the next item" and
// "the effective active-depth cap is the configured value" repeat BL-432's
// own step text word for word, so both are registered SCOPED to this
// feature (registry.defineScoped) - the scoped entry wins here, BL-432's
// own unscoped one is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1874 A failed throttle refresh never leaves an older recommendation in force';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { throttleRecommendationPath } = require(path.join(EXTENSION_DIR, 'out', 'tools', 'emit-throttle-recommendation'));

function mkTmp(prefix) {
  return trackedTmpRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// BL-1390: prove the fixture root is its OWN git repo before any mutating
// command touches it.
function assertOwnGitRoot(targetRepo) {
  const commonDir = execFileSync('git', ['-C', targetRepo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const resolved = path.resolve(targetRepo, commonDir);
  assert.ok(
    resolved.startsWith(path.join(targetRepo, '.git')),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function initFixtureRepo(targetRepo) {
  git(targetRepo, ['init', '-q', '-b', 'main']);
  assertOwnGitRoot(targetRepo);
  git(targetRepo, ['config', 'user.email', 't@t']);
  git(targetRepo, ['config', 'user.name', 't']);
  git(targetRepo, ['commit', '-q', '-m', 'init', '--allow-empty']);
}

function writeConfiguredCap(targetRepo, cap) {
  fs.mkdirSync(path.join(targetRepo, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

// "An earlier run" - a recommendation already on disk before THIS feature's
// own run happens, exactly the shape emit-throttle-recommendation.ts itself
// writes.
const EARLIER_UPDATED_AT = '2026-07-01T00:00:00.000Z';

function seedEarlierSevereRecommendation(ctx) {
  const recPath = throttleRecommendationPath(ctx.targetRepo);
  fs.mkdirSync(path.dirname(recPath), { recursive: true });
  fs.writeFileSync(
    recPath,
    JSON.stringify({
      recommendedCap: 0,
      severity: 'severe',
      reworkRate: 1,
      baselineRate: 0.1,
      standingRed: null,
      updated_at: EARLIER_UPDATED_AT,
      heldCap: null,
      episode: null,
      refreshFailureReason: null,
    })
  );
}

// Blocks persistReworkSignal's own write: a FILE where the telemetry
// directory must be makes its `fs.mkdirSync(dirname, {recursive: true})`
// throw for real (EEXIST/ENOTDIR depending on platform) - never a chmod, per the Engineering Rules.
function blockTelemetryWrite(ctx) {
  const swarmforgeDir = path.join(ctx.targetRepo, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  fs.writeFileSync(path.join(swarmforgeDir, 'telemetry'), 'blocking the telemetry directory\n');
}

function readRecommendation(ctx) {
  return JSON.parse(fs.readFileSync(throttleRecommendationPath(ctx.targetRepo), 'utf8'));
}

// The one place "the coordinator decides whether to promote" actually
// runs - the REAL bb CLI, which itself shells to the REAL node CLI.
function decidePromotion(ctx) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  ctx.effectiveCap = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(ctx.effectiveCap)) {
    throw new Error(`expected effective_backlog_depth_cli.bb to print an integer, got: ${JSON.stringify(out)}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a fixture project whose throttle recommendation from an earlier run reads severe with a cap of zero$/, (ctx) => {
    ctx.targetRepo = mkTmp('bl1874-throttle-refresh-failure-');
    fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
    initFixtureRepo(ctx.targetRepo);
    ctx.configuredCap = 3;
    writeConfiguredCap(ctx.targetRepo, ctx.configuredCap);
    seedEarlierSevereRecommendation(ctx);
  });

  // ── a-failed-refresh-publishes-no-rework-recommendation-01 ────────────
  registry.define(/^the rework signal cannot be written$/, (ctx) => {
    blockTelemetryWrite(ctx);
  });

  scoped(/^the coordinator decides whether to promote the next item$/, (ctx) => decidePromotion(ctx));

  scoped(/^the effective active-depth cap is the configured value$/, (ctx) => {
    assert.equal(ctx.effectiveCap, ctx.configuredCap);
  });

  registry.define(/^the throttle recommendation names the failed refresh as its reason$/, (ctx) => {
    const rec = readRecommendation(ctx);
    assert.equal(rec.recommendedCap, null, 'a failed refresh must not publish the earlier run\'s rework cap');
    assert.ok(
      typeof rec.refreshFailureReason === 'string' && rec.refreshFailureReason.length > 0,
      `expected a non-empty refreshFailureReason, got: ${JSON.stringify(rec.refreshFailureReason)}`
    );
  });

  // ── a-successful-refresh-replaces-the-earlier-recommendation-02 ───────
  registry.define(/^the rework signal can be written$/, () => {
    // No seam engaged - the telemetry directory is left writable.
  });

  registry.define(/^the throttle recommendation was written by this run$/, (ctx) => {
    const rec = readRecommendation(ctx);
    assert.notEqual(rec.updated_at, EARLIER_UPDATED_AT, 'expected this run to overwrite the earlier recommendation, not leave it standing');
    assert.equal(rec.refreshFailureReason, null, 'a successful refresh must not carry a failure reason');
  });
}

module.exports = { registerSteps };
