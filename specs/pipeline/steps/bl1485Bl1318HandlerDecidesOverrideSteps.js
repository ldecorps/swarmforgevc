'use strict';

// BL-1485: the BL-1318 acceptance handler (bl1318PackStaffingGateSteps.js)
// decides the operator override (PACK_STAFFING_SKIP_GATE) itself, never
// inheriting it from the pane. Every role pane exports the hatch
// (`.swarmforge/swarm.env`, since ~2026-09-04), which turned BL-1318's own
// refusal rows into OVERRIDE warnings inside the swarm. Scenario 01 drives
// the REAL specs/pipeline/scripts/run_acceptance.sh against BL-1318's REAL
// feature file under a controlled child environment - never a JS
// restatement of its cases. Scenario 02 greps the real step handlers under
// specs/pipeline/steps for the structural fix (BL-1408/BL-1398 posture),
// the same shape as BL-1445's shell-lane sibling.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL1318_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-1318-pack-launch-steward-staffing-gate.feature');
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');

const FEATURE = 'BL-1485 The BL-1318 acceptance handler decides the operator override itself';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Runs the REAL run_acceptance.sh against BL-1318's REAL feature, with
// PACK_STAFFING_SKIP_GATE either set to `value` or removed entirely from the
// child's env (never merely inherited from THIS process, which is itself
// run under whatever a role's own pane exports - the exact hazard this
// ticket guards against).
function runBl1318Feature(value) {
  const env = { ...process.env };
  if (value === undefined) {
    delete env.PACK_STAFFING_SKIP_GATE;
  } else {
    env.PACK_STAFFING_SKIP_GATE = value;
  }
  const r = spawnSync('bash', [RUN_ACCEPTANCE, BL1318_FEATURE], { encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function registerSteps(registry) {
  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(registry, /^the pane environment exports PACK_STAFFING_SKIP_GATE as (1|0|unset)$/, (ctx, value) => {
    ctx.paneValue = value === 'unset' ? undefined : value;
  });

  scoped(registry, /^the BL-1318 staffing-gate feature runs$/, (ctx) => {
    ctx.result = runBl1318Feature(ctx.paneValue);
  });

  scoped(registry, /^it passes every scenario$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected BL-1318's feature to pass under this pane export:\n${ctx.result.out}`);
    assert.match(
      ctx.result.out,
      /# pass 7/,
      `expected all seven scenario rows to pass regardless of the pane's own export:\n${ctx.result.out}`
    );
    assert.match(
      ctx.result.out,
      /# fail 0/,
      `expected no failing rows regardless of the pane's own export:\n${ctx.result.out}`
    );
  });

  // ── scenario 02 ─────────────────────────────────────────────────────
  // Structural, derived from the files (BL-1408/BL-1398 posture) - never a
  // hardcoded list. A file is a candidate when it both spawns swarmforge.sh
  // AND asserts on the staffing gate's own refusal/override text (the
  // literal phrase "pack staffing gate" appears in both the launcher's
  // refusal message and its override warning - BL-1445's own shell-lane
  // regex, reused here for the JS lane).
  scoped(registry, /^every step handler under specs\/pipeline\/steps that spawns swarmforge\.sh is inspected$/, (ctx) => {
    const files = fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js'));
    ctx.candidates = [];
    for (const f of files) {
      const abs = path.join(STEPS_DIR, f);
      const content = fs.readFileSync(abs, 'utf8');
      const spawnsSwarmforgeSh = /swarmforge\.sh/.test(content);
      if (!spawnsSwarmforgeSh) continue;
      const assertsOnGate = /pack staffing gate/i.test(content);
      if (!assertsOnGate) continue;
      ctx.candidates.push({ file: f, content });
    }
  });

  scoped(
    registry,
    /^each one that asserts on the staffing gate's refusal or override warning sets or removes PACK_STAFFING_SKIP_GATE explicitly in the environment it spawns$/,
    (ctx) => {
      assert.ok(ctx.candidates.length > 0, 'expected at least one step handler asserting on the staffing gate (bl1318PackStaffingGateSteps.js itself)');
      for (const { file, content } of ctx.candidates) {
        const decidesExplicitly =
          /delete\s+env(\.PACK_STAFFING_SKIP_GATE|\[['"]PACK_STAFFING_SKIP_GATE['"]\])/.test(content) ||
          /env(\.PACK_STAFFING_SKIP_GATE|\[['"]PACK_STAFFING_SKIP_GATE['"]\])\s*=/.test(content);
        assert.ok(
          decidesExplicitly,
          `${file} asserts on the staffing gate but never sets or removes PACK_STAFFING_SKIP_GATE itself in the env object it spawns - it would inherit the pane's own export`
        );
      }
    }
  );
}

module.exports = { registerSteps };
