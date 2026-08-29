'use strict';

// BL-1256: shared runner for the real handoffd.bb reconcile-wiring fixture
// (test_handoffd_master_main_reconcile_wiring.sh) - a real git repo, real
// bare origin, and a real handoffd process, driving master-main-reconcile-
// sweep! the way the daemon actually calls it. Used by BOTH this ticket's
// own step handlers and BL-1248 scenario 05's re-pointed handler, so the
// runner itself lives in exactly one place - memoized once per ctx, same
// posture as the pre-existing local copy in
// bl1248MasterMainReconcileKillSwitchSteps.js this ticket replaces.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const WIRING_SCRIPT = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_handoffd_master_main_reconcile_wiring.sh'
);

function runWiringFixture() {
  const result = spawnSync('bash', [WIRING_SCRIPT], { encoding: 'utf8', timeout: 180000 });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureWiringResult(ctx) {
  ctx.reconcileWiring = ctx.reconcileWiring || {};
  if (!ctx.reconcileWiring.result) {
    ctx.reconcileWiring.result = runWiringFixture();
  }
  return ctx.reconcileWiring.result;
}

function requireWiringPass(ctx, description) {
  const { stdout } = ensureWiringResult(ctx);
  if (!stdout.includes(`PASS: ${description}`)) {
    throw new Error(`expected wiring fixture check to pass: "${description}"\n${stdout}`);
  }
}

module.exports = { ensureWiringResult, requireWiringPass };
