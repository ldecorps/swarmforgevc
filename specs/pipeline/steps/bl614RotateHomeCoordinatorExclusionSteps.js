'use strict';

// BL-614: step handlers for "mono-router rotate-home never fires for the
// coordinator". Reuses the BL-550 shell harness (test_ready_for_next_rotate_home.sh),
// which carries the coordinator scenarios as its own PASS: 08 / PASS: 09 checks.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_ready_for_next_rotate_home.sh');
const FEATURE = 'mono-router rotate-home never fires for the coordinator';

function runRotateHomeTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl614?.result) {
    ctx.bl614 = { ...(ctx.bl614 || {}), result: runRotateHomeTest() };
  }
  if (ctx.bl614.result.status !== 0) {
    throw new Error(`rotate-home test failed:\n${ctx.bl614.result.stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^the active pack is a mono-router \(config rotation router\)$/, (ctx) => {
    ctx.bl614 = {};
  }, FEATURE);

  registry.defineScoped(/^the home role is coder$/, (ctx) => {
    ctx.bl614 = { ...(ctx.bl614 || {}), homeRole: 'coder' };
  }, FEATURE);

  registry.defineScoped(/^the calling role is "coordinator"$/, (ctx) => {
    ctx.bl614 = { ...(ctx.bl614 || {}), role: 'coordinator' };
  }, FEATURE);

  registry.defineScoped(/^the coordinator's inbox is empty \(no new, no in_process\)$/, (ctx) => {
    ctx.bl614 = { ...(ctx.bl614 || {}), scenario: 'empty' };
  }, FEATURE);

  registry.defineScoped(/^the coordinator's inbox\/in_process holds only \.claim-progress\.json sidecars with no matching handoff file$/, (ctx) => {
    ctx.bl614 = { ...(ctx.bl614 || {}), scenario: 'orphan-sidecar' };
  }, FEATURE);

  registry.defineScoped(/^the coordinator calls ready_for_next\.sh$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^ready_for_next\.sh prints NO_TASK$/, (ctx) => {
    ensureResult(ctx);
    const marker = ctx.bl614.scenario === 'orphan-sidecar' ? 'PASS: 09:' : 'PASS: 08:';
    if (!ctx.bl614.result.stdout.includes(marker)) {
      throw new Error(`expected NO_TASK for coordinator (${marker}):\n${ctx.bl614.result.stdout}`);
    }
  }, FEATURE);

  registry.defineScoped(/^rotate_to_role\.sh is not invoked$/, (ctx) => {
    ensureResult(ctx);
    const marker = ctx.bl614.scenario === 'orphan-sidecar' ? 'PASS: 09:' : 'PASS: 08:';
    if (!ctx.bl614.result.stdout.includes(marker)) {
      throw new Error(`expected rotate_to_role.sh not invoked (${marker}):\n${ctx.bl614.result.stdout}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
