'use strict';

// BL-714: step handlers driving the REAL guard modules directly - never a
// hand-rolled reimplementation of the tracked-cache scan or the raw-mkdtemp
// migration guard.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_TEST = path.join(REPO_ROOT, 'extension', 'test');
const { findRawMkdtempCallSites } = require(path.join(EXT_TEST, 'helpers', 'rawMkdtempGuard'));
const { scanUnexpected } = require(path.join(EXT_TEST, 'onboarderResidualAllowlist'));

// Every git-tracked path under node_modules matching a Vite/Vitest cache
// results file - not just the one blob this ticket found, so a future cache
// blob of the same shape would fail this scenario too, not just BL-714's.
function trackedViteVitestCacheFiles() {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '--', 'node_modules'], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1) {
      return [];
    }
    throw err;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.vite\/vitest\//.test(f) && f.endsWith('.json'));
}

function registerSteps(registry) {
  // ── harden-gate-01 ──────────────────────────────────────────────────
  registry.define(/^the repository index is inspected for vite\/vitest cache results under node_modules$/, (ctx) => {
    ctx.trackedCacheFiles = trackedViteVitestCacheFiles();
  });

  registry.define(/^no vitest results\.json under node_modules\/\.vite\/vitest is tracked$/, (ctx) => {
    if (ctx.trackedCacheFiles.length > 0) {
      throw new Error(`expected zero tracked vitest cache files, found:\n${ctx.trackedCacheFiles.join('\n')}`);
    }
  });

  registry.define(/^the facilitator residual scan does not fail solely because of a cache blob$/, () => {
    const unexpected = scanUnexpected();
    const fromCache = unexpected.filter((f) => f.startsWith('node_modules/'));
    if (fromCache.length > 0) {
      throw new Error(`facilitator residual scan still fails on a tracked cache blob: ${JSON.stringify(fromCache)}`);
    }
  });

  // ── harden-gate-02 ──────────────────────────────────────────────────
  registry.define(/^the raw-mkdtemp migration guard walks extension\/test$/, (ctx) => {
    ctx.mkdtempViolations = findRawMkdtempCallSites(EXT_TEST);
  });

  registry.define(/^(telegramCursorBridge(?:Expedite|Logs|Redeploy|Update)\.test\.js) has no raw mkdtemp call site$/, (ctx, filename) => {
    const hit = ctx.mkdtempViolations.find((v) => path.basename(v.file) === filename);
    if (hit) {
      throw new Error(`expected ${filename} to have no raw mkdtemp call site, found one at line ${hit.line}`);
    }
  });

  // ── harden-gate-03 ──────────────────────────────────────────────────
  registry.define(/^the tmpDirMigrationGuard suite runs$/, (ctx) => {
    ctx.migrationGuardViolations = findRawMkdtempCallSites(EXT_TEST);
  });

  registry.define(/^it reports zero unexpected raw mkdtemp call sites$/, (ctx) => {
    if (ctx.migrationGuardViolations.length > 0) {
      throw new Error(
        `expected zero raw mkdtemp call sites, found:\n${ctx.migrationGuardViolations.map((v) => `${v.file}:${v.line}`).join('\n')}`,
      );
    }
  });
}

module.exports = { registerSteps };
