'use strict';

// BL-1486: every step handler that drives the launcher's parse_config on a
// fixture root decides the BL-1318 staffing-gate hatch (PACK_STAFFING_SKIP_GATE)
// itself, never inheriting it from the pane - the acceptance-lane sibling of
// BL-1457 (property files) and BL-1445 (shell wiring). Scenario 01 drives the
// REAL specs/pipeline/scripts/run_acceptance.sh against each named feature's
// REAL file, scenario 02 drives the REAL shipped-confs shell test - both
// under a controlled child environment (the variable removed, never merely
// inherited from THIS process, which is itself run under whatever the pane
// exports). Scenarios 03/04 are structural, derived from the files
// (BL-1408/BL-1398 posture), never a hardcoded list - the opposite
// population from BL-1485's own scenario 02 (that ticket's candidates ASSERT
// on the gate and must UNSET/decide it; this ticket's candidates do NOT
// assert on the gate and must SET it explicitly).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const FEATURES_DIR = path.join(REPO_ROOT, 'specs', 'features');
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts');
const RUNTIME_JS = path.join(REPO_ROOT, 'specs', 'pipeline', 'runtime.js');
const SHIPPED_CONFS_TEST = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_shipped_confs_no_coordinator_window.sh'
);

const FEATURE = 'BL-1486 Every step handler that drives the launcher on a fixture decides the staffing gate itself';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Runs the REAL run_acceptance.sh against a REAL feature file, with
// PACK_STAFFING_SKIP_GATE removed entirely from the child's env - never
// merely inherited from THIS process, which is itself run under whatever a
// role's own pane exports (the exact hazard this ticket guards against).
function runFeatureWithoutHatch(featureFile) {
  const env = { ...process.env };
  delete env.PACK_STAFFING_SKIP_GATE;
  const r = spawnSync('bash', [RUN_ACCEPTANCE, path.join(FEATURES_DIR, featureFile)], { encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function runShippedConfsTestWithoutHatch() {
  const env = { ...process.env };
  delete env.PACK_STAFFING_SKIP_GATE;
  const r = spawnSync('bash', [SHIPPED_CONFS_TEST], { encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function registerSteps(registry) {
  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(registry, /^the environment does not export PACK_STAFFING_SKIP_GATE$/, (ctx) => {
    ctx.marker = true;
  });

  scoped(registry, /^the feature ([^ ]+) runs under the acceptance runner$/, (ctx, feature) => {
    ctx.featureResult = runFeatureWithoutHatch(`${feature}.feature`);
  });

  scoped(registry, /^every scenario in it passes$/, (ctx) => {
    assert.equal(
      ctx.featureResult.status,
      0,
      `expected the feature to pass with PACK_STAFFING_SKIP_GATE absent from the environment:\n${ctx.featureResult.out}`
    );
    assert.match(
      ctx.featureResult.out,
      /# fail 0/,
      `expected no failing rows with PACK_STAFFING_SKIP_GATE absent from the environment:\n${ctx.featureResult.out}`
    );
  });

  // ── scenario 02 ─────────────────────────────────────────────────────
  scoped(registry, /^the shipped-confs shell test runs$/, (ctx) => {
    ctx.shellResult = runShippedConfsTestWithoutHatch();
  });

  scoped(registry, /^no shipped conf is refused by the staffing gate$/, (ctx) => {
    assert.equal(
      ctx.shellResult.status,
      0,
      `expected the shipped-confs shell test to pass with PACK_STAFFING_SKIP_GATE absent from the environment:\n${ctx.shellResult.out}`
    );
    assert.doesNotMatch(
      ctx.shellResult.out,
      /pack staffing gate refused/i,
      `expected no shipped conf to be refused by the staffing gate:\n${ctx.shellResult.out}`
    );
  });

  // ── scenario 03 ─────────────────────────────────────────────────────
  // Structural, derived from the files (BL-1408/BL-1398 posture) - never a
  // hardcoded list. A file is a candidate when it both spawns a child
  // process AND actually drives parse_config (the literal call appears
  // inside a spawned command string - preceded by a quote/backtick/
  // semicolon/escaped-newline, never a bare prose mention like
  // bl1299ReverseHopMasterResidentSteps.js's or bl1495BaiGatewaySeatSteps.js's
  // own comments, verified: no other handler's prose mention collides with
  // this pattern). A candidate that itself asserts on the gate's refusal or
  // override text (the literal phrase "pack staffing gate", BL-1485's own
  // handler shape) is the OPPOSITE population (BL-1485's), excluded here.
  scoped(registry, /^every step handler under specs\/pipeline\/steps that drives parse_config is inspected$/, (ctx) => {
    const files = fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js'));
    ctx.candidates = [];
    for (const f of files) {
      const abs = path.join(STEPS_DIR, f);
      const content = fs.readFileSync(abs, 'utf8');
      const spawnsProcess = /spawnSync|execSync|execFileSync|require\(['"]node:child_process['"]\)/.test(content);
      const drivesParseConfig = /(?:[;'"`]|\\n)\s*parse_config\b/.test(content);
      if (!spawnsProcess || !drivesParseConfig) continue;
      const assertsOnGate = /pack staffing gate/i.test(content);
      if (assertsOnGate) continue;
      ctx.candidates.push({ file: f, content });
    }
  });

  scoped(
    registry,
    /^each one that does not assert on the staffing gate sets PACK_STAFFING_SKIP_GATE explicitly in the environment it spawns$/,
    (ctx) => {
      assert.ok(
        ctx.candidates.length > 0,
        'expected at least one step handler that drives parse_config without asserting on the staffing gate'
      );
      for (const { file, content } of ctx.candidates) {
        const decidesExplicitly =
          /PACK_STAFFING_SKIP_GATE\s*:\s*['"]1['"]/.test(content) ||
          /env(\.PACK_STAFFING_SKIP_GATE|\[['"]PACK_STAFFING_SKIP_GATE['"]\])\s*=/.test(content);
        assert.ok(
          decidesExplicitly,
          `${file} drives parse_config and never asserts on the staffing gate, but never sets PACK_STAFFING_SKIP_GATE itself in the env object it spawns - it would inherit the pane's own export`
        );
      }
    }
  );

  scoped(registry, /^no handler relies on the variable being present in the pane$/, (ctx) => {
    // Same candidate set as the prior step: every one already proven above
    // to decide the hatch explicitly, so none of them can be relying on
    // pane inheritance for its own verdict.
    assert.ok(Array.isArray(ctx.candidates), 'expected scenario 03 to have inspected the step handlers first');
  });

  // ── scenario 04 ─────────────────────────────────────────────────────
  scoped(registry, /^the acceptance runner and its scripts are inspected$/, (ctx) => {
    const files = [RUNTIME_JS, ...fs.readdirSync(SCRIPTS_DIR).map((f) => path.join(SCRIPTS_DIR, f))].filter((p) =>
      fs.statSync(p).isFile()
    );
    ctx.laneFiles = files.map((p) => ({ path: p, content: fs.readFileSync(p, 'utf8') }));
  });

  scoped(registry, /^none of them exports PACK_STAFFING_SKIP_GATE into every handler's environment$/, (ctx) => {
    for (const { path: p, content } of ctx.laneFiles) {
      assert.doesNotMatch(
        content,
        /export\s+PACK_STAFFING_SKIP_GATE|PACK_STAFFING_SKIP_GATE\s*[:=]/,
        `${p} exports PACK_STAFFING_SKIP_GATE lane-wide - a hatch declared here would blind BL-1318's and BL-1485's handlers (BL-1486's scenario 04)`
      );
    }
  });
}

module.exports = { registerSteps };
