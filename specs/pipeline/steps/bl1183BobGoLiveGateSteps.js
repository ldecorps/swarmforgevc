'use strict';

// BL-1183 acceptance: BoB production day trials refuse until telemetry and
// performance assessors are ready.
//
// The human's instruction is the whole specification: do not run live day-long
// production trials until telemetry and assessing tools can decide
// outrank / tie / lose. So the scenarios drive the REAL trial start path -
// `model_steward_cli.bb trial nominate`, the same command BL-1182 arms a trial
// with - over a real registry fixture, and assert on what it actually does:
// refuses, names the gap, and seats nothing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');

const FEATURE_NAME = 'BoB production day trials refuse until telemetry and assessors are ready';

const ROLE = 'coder';
const PERMANENT = { provider: 'anthropic', model: 'perm-model' };
const CANDIDATE = { provider: 'cerebras', model: 'trial-model' };

function fixture(ctx) {
  if (ctx.bl1183.root) {
    return ctx.bl1183.root;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1183-golive-'));
  fs.mkdirSync(path.join(root, 'steward'), { recursive: true });
  fs.mkdirSync(path.join(root, 'factory'), { recursive: true });
  // A memory-boundary stub, so nothing here depends on a live capture.
  fs.writeFileSync(path.join(root, 'memory.js'), "process.stdout.write('{}\\n');\n");
  ctx.bl1183.root = root;
  return root;
}

function cli(ctx, args) {
  const root = fixture(ctx);
  return spawnSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MODEL_STEWARD_STATE_DIR: path.join(root, 'steward'),
      MODEL_FACTORY_STATE_DIR: path.join(root, 'factory'),
      MODEL_STEWARD_MEMORY_TOOL: path.join(root, 'memory.js'),
    },
  });
}

/**
 * A registry where each side's score and evidence are set independently, which
 * is what lets a scenario withhold exactly one of the two things the checklist
 * looks for.
 */
function seed(ctx, { permEvidence, trialScore, trialEvidence }) {
  const root = fixture(ctx);
  const steward = path.join(root, 'steward');
  fs.rmSync(path.join(steward, 'registry.json'), { force: true });
  fs.rmSync(path.join(steward, 'trials.json'), { force: true });
  for (const { provider, model } of [PERMANENT, CANDIDATE]) {
    const out = cli(ctx, ['register', `${provider}/${model}`, '--status', 'certified', '--cost-class', 'medium']);
    assert.equal(out.status, 0, `register failed: ${out.stdout}${out.stderr}`);
  }
  const registryPath = path.join(steward, 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const matrix = [{ ...PERMANENT, score: 7, evidence: permEvidence }];
  if (trialScore !== undefined) {
    matrix.push({ ...CANDIDATE, score: trialScore, evidence: trialEvidence });
  }
  registry.role_matrix = { ...(registry.role_matrix || {}), [ROLE]: matrix };
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  // The seat a trial would displace.
  fs.writeFileSync(
    path.join(root, 'factory', 'assignment.json'),
    JSON.stringify({ [ROLE]: { role: ROLE, ...PERMANENT, agent: 'claude' } })
  );
}

function discard(ctx) {
  if (ctx.bl1183 && ctx.bl1183.root) {
    fs.rmSync(ctx.bl1183.root, { recursive: true, force: true });
    ctx.bl1183.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the day-long BoB trial lifecycle from BL-1182$/, (ctx) => {
    ctx.bl1183 = { root: null };
    assert.ok(fs.existsSync(CLI), 'the steward CLI is missing');
    const usage = spawnSync('bb', [CLI], { encoding: 'utf8', cwd: REPO_ROOT });
    assert.match(`${usage.stdout}${usage.stderr}`, /trial nominate/, 'BL-1182 trial lifecycle is not present');
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the go-live checklist finds missing trial-comparison telemetry$/, (ctx) => {
    // The candidate has no recorded score at all: `decide` could only revert
    // on absent evidence, so the day would be spent learning nothing.
    ctx.bl1183.expectGap = 'trial-comparison telemetry';
    seed(ctx, { permEvidence: 'scorecard: perm' });
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^the go-live checklist finds performance assessors unavailable$/, (ctx) => {
    // Scored, but on somebody's opinion rather than a battery, scorecard or
    // bake-off - which cannot adjudicate a day of production.
    ctx.bl1183.expectGap = 'performance assessor';
    seed(ctx, { permEvidence: 'scorecard: perm', trialScore: 8, trialEvidence: 'the operator likes it' });
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^telemetry and performance assessors satisfy the go-live checklist$/, (ctx) => {
    ctx.bl1183.expectGap = null;
    seed(ctx, { permEvidence: 'scorecard: perm', trialScore: 8, trialEvidence: 'battery: coder-battery-2026-08' });
  });

  scoped(/^a production day trial is nominated$/, (ctx) => {
    ctx.bl1183.run = cli(ctx, [
      'trial', 'nominate', `${CANDIDATE.provider}/${CANDIDATE.model}`, '--role', ROLE,
    ]);
    ctx.bl1183.output = `${ctx.bl1183.run.stdout}${ctx.bl1183.run.stderr}`;
  });

  scoped(/^the trial refuses to arm$/, (ctx) => {
    assert.notEqual(ctx.bl1183.run.status, 0, `the trial armed anyway: ${ctx.bl1183.output}`);
    assert.match(ctx.bl1183.output, /go-live checklist is not satisfied/);
    // Nothing was seated, and no trial state was written - a refusal that
    // still armed would be the silent skip invariant 2 forbids.
    const trials = path.join(ctx.bl1183.root, 'steward', 'trials.json');
    const armed = fs.existsSync(trials) ? JSON.parse(fs.readFileSync(trials, 'utf8')).active?.[ROLE] : undefined;
    assert.equal(armed, undefined, 'a refused trial was armed anyway');
    const seat = JSON.parse(fs.readFileSync(path.join(ctx.bl1183.root, 'factory', 'assignment.json'), 'utf8'));
    assert.equal(seat[ROLE].model, PERMANENT.model, 'a refused trial moved the seat');
  });

  // Scenario 01 says "names the missing telemetry", scenario 02 "names the
  // assessor gap" - two sentences for the two halves of the checklist, so one
  // handler takes both rather than two handlers asserting the same thing.
  scoped(/^the refusal names the (?:missing telemetry|assessor gap)$/, (ctx) => {
    const which = ctx.bl1183.expectGap === 'trial-comparison telemetry' ? 'telemetry' : 'assessor gap';
    const expected = which === 'telemetry' ? 'trial-comparison telemetry' : 'performance assessor';
    assert.equal(expected, ctx.bl1183.expectGap, 'the scenario and its Given disagree about the gap');
    assert.ok(
      ctx.bl1183.output.includes(expected),
      `the refusal does not name the ${which}: ${ctx.bl1183.output}`
    );
    // ...and names WHICH model, or the operator is left looking.
    assert.ok(
      ctx.bl1183.output.includes(`${CANDIDATE.provider}/${CANDIDATE.model}`),
      `the refusal does not name the model: ${ctx.bl1183.output}`
    );
    discard(ctx);
  });

  scoped(/^the go-live gate allows the trial to arm$/, (ctx) => {
    assert.equal(ctx.bl1183.run.status, 0, `the gate refused a ready pairing: ${ctx.bl1183.output}`);
    assert.match(ctx.bl1183.output, /go-live checklist satisfied/);
    assert.match(ctx.bl1183.output, /trial armed role=coder/);
    discard(ctx);
  });
}

module.exports = { registerSteps };
