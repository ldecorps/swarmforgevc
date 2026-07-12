'use strict';

// BL-315: step handlers for "The coordinator-provisioned-infrastructure
// test is isolated from the caller's own SWARMFORGE_CONFIG". Drives the
// REAL test_coordinator_provisioned_infrastructure.sh as a subprocess
// under a controlled environment - this ticket is specifically about that
// TEST FILE's own environment isolation (not swarmforge.sh's behavior),
// so the acceptance check is exactly what a human running the suite from
// a shell with/without SWARMFORGE_CONFIG set would see.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_coordinator_provisioned_infrastructure.sh');
// A real, tracked pack conf - stands in for "a real pack conf" the
// ticket's own scenario names; its content is irrelevant here (this
// ticket only cares whether the test script itself unsets/ignores an
// inherited SWARMFORGE_CONFIG, not what that conf declares).
const REAL_PACK_CONF = path.join(REPO_ROOT, 'swarmforge', 'packs', 'two-pack.conf');

function runTestScript(swarmforgeConfig) {
  const env = { ...process.env };
  delete env.SWARMFORGE_CONFIG;
  if (swarmforgeConfig) {
    env.SWARMFORGE_CONFIG = swarmforgeConfig;
  }
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', env });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function registerSteps(registry) {
  registry.define(/^the caller's shell has no SWARMFORGE_CONFIG set$/, (ctx) => {
    ctx.swarmforgeConfig = undefined;
  });

  registry.define(/^the caller's shell has SWARMFORGE_CONFIG pointed at a real pack conf$/, (ctx) => {
    ctx.swarmforgeConfig = REAL_PACK_CONF;
  });

  registry.define(/^test_coordinator_provisioned_infrastructure\.sh runs$/, (ctx) => {
    ctx.result = runTestScript(ctx.swarmforgeConfig);
  });

  registry.define(/^it passes$/, (ctx) => {
    if (ctx.result.status !== 0 || !ctx.result.stdout.includes('ALL PASS')) {
      throw new Error(`expected the test script to pass (exit 0, "ALL PASS"), got status=${ctx.result.status}: ${ctx.result.stdout}`);
    }
  });
}

module.exports = { registerSteps };
