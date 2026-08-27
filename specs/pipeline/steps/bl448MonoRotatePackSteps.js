'use strict';

// BL-448: step handlers for "A mono-role rotating pack carries each parcel
// through the whole pipeline with one resident agent, dropping no gate".
// Drives the REAL test_rotation_sequential_pack.sh as a subprocess (mirrors
// coordinatorInfraTestConfigLeakSteps.js's own "shell out to the real shell
// test, assert on its PASS/FAIL output" pattern) - that shell test is itself
// the executable proof against swarmforge.sh's actual parse_config/
// is_sequential_dormant/write_roles_file, never a hand-rolled substitute or a
// re-parse of swarmforge.sh's own logic here. No real tmux session is ever
// launched by this test (see that script's own header for why).
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_rotation_sequential_pack.sh');

function runRotationTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function registerSteps(registry) {
  registry.define(/^the swarm is launched against a target with the mono-rotate pack$/, (ctx) => {
    // No fixture setup needed here - "When the swarm is up" below runs the
    // real parse_config/is_sequential_dormant proof directly.
    ctx.result = undefined;
  });

  registry.define(/^the swarm is up$/, (ctx) => {
    ctx.result = runRotationTest();
    if (ctx.result.status !== 0 || !ctx.result.stdout.includes('ALL PASS')) {
      throw new Error(`expected test_rotation_sequential_pack.sh to pass (exit 0, "ALL PASS"), got status=${ctx.result.status}: ${ctx.result.stdout}`);
    }
  });

  registry.define(/^a single resident pipeline agent covers all pipeline roles$/, (ctx) => {
    const required = [
      'PASS: 01: the first-declared pipeline role is resident (gets a real session)',
      'PASS: 01: every middle pipeline role is sequential-dormant (no session of its own)',
      'PASS: 01: every rotation-member role is still fully registered (its own worktree/roles.tsv entry), regardless of dormancy',
    ];
    for (const line of required) {
      if (!ctx.result.stdout.includes(line)) {
        throw new Error(`expected the rotation test output to include:\n${line}\ngot:\n${ctx.result.stdout}`);
      }
    }
  });

  registry.define(/^the coordinator is provisioned separately as reserved infrastructure$/, (ctx) => {
    const required = [
      'PASS: 01: the coordinator is never sequential-dormant - it stays reserved, separately-provisioned infrastructure',
      'PASS: 01: roles.tsv carries a full entry for every rotation-member role, exactly like a non-rotation pack',
    ];
    for (const line of required) {
      if (!ctx.result.stdout.includes(line)) {
        throw new Error(`expected the rotation test output to include:\n${line}\ngot:\n${ctx.result.stdout}`);
      }
    }
  });
}

module.exports = { registerSteps };
