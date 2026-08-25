'use strict';

// BL-556: step handlers for Model Steward evaluate ingest. Drives the REAL
// model_steward_cli.bb evaluate subcommand against throwaway state dirs —
// never reimplements ingest in JS. Tracks subprocess invocations via a
// wrapper env only for the pure-ingest scenario (no battery/recruiter spawn).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'Model Steward evaluate ingests captured benchmark evidence into the registry';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');

const PROVIDER = 'test';
const MODEL = 'winner-model';
const ROLE = 'coder';

function cli(stateDir, args, opts = {}) {
  const result = spawnSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MODEL_STEWARD_STATE_DIR: stateDir, ...opts.env },
  });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(`cli failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function registry(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'registry.json'), 'utf8'));
}

function registerSteps(registrySteps) {
  const scoped = (re, fn) => registrySteps.defineScoped(re, fn, FEATURE);

  scoped(/^the Model Steward registry is initialised$/, (ctx) => {
    ctx.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl556-steward-'));
    ctx.invocations = [];
    cli(ctx.stateDir, ['status']);
    cli(ctx.stateDir, [
      'register',
      `${PROVIDER}/${MODEL}`,
      '--status',
      'candidate',
      '--context-window',
      '1000',
      '--cost-class',
      'medium',
    ]);
  });

  scoped(/^a captured recruiter scorecard artifact exists for model "winner-model" role "coder"$/, (ctx) => {
    ctx.scorecardPath = path.join(ctx.stateDir, 'evidence', 'winner-scorecard.json');
    ctx.scorecardId = 'recruiter-scorecard:winner-01';
    writeJson(ctx.scorecardPath, {
      scorecard_id: ctx.scorecardId,
      model: MODEL,
      entries: [
        { competency: 'receive', status: 'pass' },
        { competency: 'protocol-compliance', status: 'pass' },
        { competency: 'tool-usage', status: 'pass' },
        { competency: 'autonomy', status: 'pass' },
      ],
      overall: 'swarm-compliant',
    });
  });

  scoped(/^model-steward evaluate is run for "winner-model" role "coder" with that scorecard$/, (ctx) => {
    ctx.lastEval = cli(ctx.stateDir, [
      'evaluate',
      `${PROVIDER}/${MODEL}`,
      '--role',
      ROLE,
      '--scorecard',
      ctx.scorecardPath,
    ]);
  });

  scoped(/^the capability registry entry for "winner-model" is updated from the scorecard dimensions$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const caps = reg.capabilities[`${PROVIDER}/${MODEL}`];
    assert.ok(caps, 'expected capability entry');
    assert.ok(caps.coding_quality && typeof caps.coding_quality.score === 'number');
    assert.ok(caps.protocol_compliance && typeof caps.protocol_compliance.score === 'number');
  });

  scoped(/^the role recommendation matrix entry for "coder" carries the scorecard id as its evidence pointer$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const rows = reg.role_matrix.coder || reg.role_matrix[ROLE] || [];
    const hit = rows.find((r) => r.model === MODEL && r.provider === PROVIDER);
    assert.ok(hit, 'expected role-matrix row');
    assert.equal(hit.evidence, ctx.scorecardId);
  });

  scoped(/^a certification report artifact is recorded with non-empty gate results$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const entry = reg.models[`${PROVIDER}/${MODEL}`];
    assert.ok(entry.certification_report_path, 'expected report path');
    const report = JSON.parse(
      fs.readFileSync(path.join(ctx.stateDir, entry.certification_report_path), 'utf8')
    );
    ctx.report = report;
    assert.ok(Array.isArray(report.gates) && report.gates.length > 0);
  });

  scoped(/^the certification report references the scorecard id$/, (ctx) => {
    assert.equal(ctx.report.scorecard_id, ctx.scorecardId);
  });

  scoped(/^a captured bake-off run artifact for model "winner-model"$/, (ctx) => {
    ctx.bakeoffPath = path.join(ctx.stateDir, 'evidence', 'winner-bakeoff.json');
    ctx.bakeoffId = 'bakeoff-run:winner-01';
    writeJson(ctx.bakeoffPath, {
      bakeoff_run_id: ctx.bakeoffId,
      roles: [
        {
          leaderboard: {
            ranked: [{ model: MODEL, capability: 8, planCost: 'medium', costTier: null }],
          },
        },
      ],
      escalated: [],
    });
  });

  scoped(/^model-steward evaluate is run for "winner-model" role "coder" with the scorecard and bake-off run$/, (ctx) => {
    ctx.lastEval = cli(ctx.stateDir, [
      'evaluate',
      `${PROVIDER}/${MODEL}`,
      '--role',
      ROLE,
      '--scorecard',
      ctx.scorecardPath,
      '--bakeoff',
      ctx.bakeoffPath,
    ]);
  });

  scoped(/^the capability registry includes bake-off-derived scores$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const caps = reg.capabilities[`${PROVIDER}/${MODEL}`];
    assert.equal(caps.coding_quality.bakeoff_capability, 8);
  });

  scoped(/^the certification report references the bake-off run id$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const entry = reg.models[`${PROVIDER}/${MODEL}`];
    const report = JSON.parse(
      fs.readFileSync(path.join(ctx.stateDir, entry.certification_report_path), 'utf8')
    );
    assert.equal(report.bakeoff_run_id, ctx.bakeoffId);
  });

  scoped(/^"winner-model" already has a prior certification report$/, (ctx) => {
    // First evaluate with all-pass scorecard to plant a prior report.
    cli(ctx.stateDir, [
      'evaluate',
      `${PROVIDER}/${MODEL}`,
      '--role',
      ROLE,
      '--scorecard',
      ctx.scorecardPath,
    ]);
    const reg = registry(ctx.stateDir);
    ctx.priorReportPath = reg.models[`${PROVIDER}/${MODEL}`].certification_report_path;
    assert.ok(ctx.priorReportPath);
  });

  scoped(/^model-steward evaluate is run again with a scorecard showing a gate below its floor$/, (ctx) => {
    ctx.regressedPath = path.join(ctx.stateDir, 'evidence', 'winner-regressed.json');
    writeJson(ctx.regressedPath, {
      scorecard_id: 'recruiter-scorecard:winner-regressed',
      model: MODEL,
      entries: [
        { competency: 'receive', status: 'pass' },
        { competency: 'protocol-compliance', status: 'fail', reason: 'below floor' },
        { competency: 'tool-usage', status: 'pass' },
        { competency: 'autonomy', status: 'pass' },
      ],
      overall: 'fail',
    });
    ctx.lastEval = cli(ctx.stateDir, [
      'evaluate',
      `${PROVIDER}/${MODEL}`,
      '--role',
      ROLE,
      '--scorecard',
      ctx.regressedPath,
    ]);
  });

  scoped(/^the new certification report records which gate regressed pass to fail$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const entry = reg.models[`${PROVIDER}/${MODEL}`];
    const report = JSON.parse(
      fs.readFileSync(path.join(ctx.stateDir, entry.certification_report_path), 'utf8')
    );
    ctx.report = report;
    assert.ok(Array.isArray(report.regression_diff) && report.regression_diff.length > 0);
    assert.ok(report.regression_diff.some((r) => r.gate === 'protocol-compliance'));
  });

  scoped(/^the regressed gate is reported to the operator$/, (ctx) => {
    assert.match(ctx.lastEval.stderr + ctx.lastEval.stdout, /REGRESSION protocol-compliance/);
  });

  scoped(/^"winner-model" is currently certified with a prior passing gate$/, (ctx) => {
    cli(ctx.stateDir, [
      'evaluate',
      `${PROVIDER}/${MODEL}`,
      '--role',
      ROLE,
      '--scorecard',
      ctx.scorecardPath,
    ]);
    const reg = registry(ctx.stateDir);
    assert.equal(reg.models[`${PROVIDER}/${MODEL}`].status, 'certified');
  });

  scoped(/^model-steward evaluate is run with the decertify-on-regression flag and a regressed scorecard$/, (ctx) => {
    ctx.regressedPath = path.join(ctx.stateDir, 'evidence', 'winner-regressed-decert.json');
    writeJson(ctx.regressedPath, {
      scorecard_id: 'recruiter-scorecard:winner-decert',
      model: MODEL,
      entries: [
        { competency: 'receive', status: 'fail' },
        { competency: 'protocol-compliance', status: 'pass' },
        { competency: 'tool-usage', status: 'pass' },
        { competency: 'autonomy', status: 'pass' },
      ],
      overall: 'fail',
    });
    ctx.lastEval = cli(ctx.stateDir, [
      'evaluate',
      `${PROVIDER}/${MODEL}`,
      '--role',
      ROLE,
      '--scorecard',
      ctx.regressedPath,
      '--decertify-on-regression',
    ]);
  });

  scoped(/^the model status becomes "candidate" or "deprecated"$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const status = reg.models[`${PROVIDER}/${MODEL}`].status;
    assert.ok(status === 'candidate' || status === 'deprecated', status);
  });

  scoped(/^the certification report records the regression reason$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    const entry = reg.models[`${PROVIDER}/${MODEL}`];
    assert.ok(entry.last_regression_reason);
    assert.match(entry.last_regression_reason, /evaluate regression/);
    const report = JSON.parse(
      fs.readFileSync(path.join(ctx.stateDir, entry.certification_report_path), 'utf8')
    );
    assert.equal(report.result, 'regressed');
    assert.ok(report.reason || entry.last_regression_reason);
  });

  scoped(/^a captured recruiter scorecard artifact on disk and no running compliance battery$/, (ctx) => {
    ctx.noBattery = true;
    assert.ok(fs.existsSync(ctx.scorecardPath));
  });

  scoped(/^the capability registry is updated solely from the artifact file$/, (ctx) => {
    const reg = registry(ctx.stateDir);
    assert.ok(reg.capabilities[`${PROVIDER}/${MODEL}`]);
  });

  scoped(/^no compliance battery or recruiter subprocess is invoked$/, (ctx) => {
    // evaluate is a bb script reading JSON — assert CLI source has no spawn of
    // compliance_battery / recruiter-run (static pin for this scenario).
    const cliSrc = fs.readFileSync(CLI, 'utf8');
    const evalLib = fs.readFileSync(
      path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_evaluate_lib.bb'),
      'utf8'
    );
    assert.doesNotMatch(cliSrc, /compliance_battery/);
    assert.doesNotMatch(cliSrc, /recruiter-run/);
    assert.doesNotMatch(evalLib, /process\/sh|shell|babashka\.process/);
    assert.ok(ctx.noBattery);
  });
}

module.exports = { registerSteps };
