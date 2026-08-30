'use strict';

// BL-1182 acceptance: the day-long BoB trial lifecycle - nominate, seat,
// assess, promote or revert, tie -> cheapest.
//
// Every scenario drives the REAL steward CLI (`model_steward_cli.bb trial`)
// against an isolated state dir, never a restatement of its decisions: the
// registry, the trial state and ModelFactory's assignment overlay are the same
// files production writes, pointed at a temp root by the env seams the CLI
// already exposes for exactly this.
//
// The memory boundary is the one thing stubbed, by MODEL_STEWARD_MEMORY_TOOL.
// A live capture would drag tmux and a running agent into an acceptance run;
// what scenario 05 needs to see is that the lifecycle CALLS the boundary at
// both switches and honours its verdict, and a recording stub shows that
// exactly. The bridge's own composition of BL-1178's API is unit-tested in
// extension/test/trialBoundaryMemory.test.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');

const FEATURE_NAME = 'day-long BoB trial nominates assesses and promotes or reverts';

const PERMANENT = { provider: 'anthropic', model: 'perm-model', cost: 'medium', score: 7 };
const KNOWN_ROLES = new Set(['coder']);

function fixture(ctx) {
  if (ctx.bl1182) {
    return ctx.bl1182;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1182-trial-'));
  const steward = path.join(root, 'steward');
  const factory = path.join(root, 'factory');
  fs.mkdirSync(steward, { recursive: true });
  fs.mkdirSync(factory, { recursive: true });
  const calls = path.join(root, 'memory-calls');
  fs.writeFileSync(calls, '');
  fs.writeFileSync(
    path.join(root, 'memory-ok.js'),
    "const fs = require('fs');\n" +
      "fs.appendFileSync(process.env.BL1182_CALLS, process.argv.slice(2).join(' ') + '\\n');\n" +
      "process.stdout.write(JSON.stringify({ ok: true }) + '\\n');\n"
  );
  ctx.bl1182 = { root, steward, factory, calls, memoryTool: path.join(root, 'memory-ok.js') };
  return ctx.bl1182;
}

function cli(ctx, args) {
  const f = fixture(ctx);
  return spawnSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MODEL_STEWARD_STATE_DIR: f.steward,
      MODEL_FACTORY_STATE_DIR: f.factory,
      MODEL_STEWARD_MEMORY_TOOL: f.memoryTool,
      BL1182_CALLS: f.calls,
    },
  });
}

// A registry with the permanent model and one candidate, the candidate's score
// and cost class chosen per scenario, plus a seated permanent - the seat is
// what a trial displaces, so it has to exist before one is nominated.
function seed(ctx, role, { score, cost }) {
  const f = fixture(ctx);
  fs.rmSync(path.join(f.steward, 'registry.json'), { force: true });
  fs.rmSync(path.join(f.steward, 'trials.json'), { force: true });
  for (const [id, klass] of [
    [`${PERMANENT.provider}/${PERMANENT.model}`, PERMANENT.cost],
    ['cerebras/trial-model', cost],
  ]) {
    const out = cli(ctx, ['register', id, '--status', 'certified', '--cost-class', klass]);
    assert.equal(out.status, 0, `register ${id} failed: ${out.stderr}`);
  }
  const registryPath = path.join(f.steward, 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.role_matrix = registry.role_matrix || {};
  registry.role_matrix[role] = [
    { provider: PERMANENT.provider, model: PERMANENT.model, score: PERMANENT.score, evidence: 'scorecard: perm' },
    { provider: 'cerebras', model: 'trial-model', score, evidence: 'scorecard: trial' },
  ];
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  fs.writeFileSync(
    path.join(f.factory, 'assignment.json'),
    JSON.stringify({
      [role]: { role, provider: PERMANENT.provider, model: PERMANENT.model, agent: 'claude' },
    })
  );
  ctx.bl1182.role = role;
}

function seatedModel(ctx) {
  const f = fixture(ctx);
  const p = path.join(f.factory, 'assignment.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8'))[ctx.bl1182.role].model : null;
}

function discard(ctx) {
  if (ctx.bl1182 && ctx.bl1182.root) {
    fs.rmSync(ctx.bl1182.root, { recursive: true, force: true });
    ctx.bl1182.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^Model Steward can nominate certified candidates for a role$/, (ctx) => {
    ctx.bl1182 = null;
    assert.ok(fs.existsSync(CLI), 'the steward CLI is missing');
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^a candidate that might outrank the permanent model for role "(.+)"$/, (ctx, role) => {
    assert.ok(KNOWN_ROLES.has(role), `unknown role example value "${role}"`);
    seed(ctx, role, { score: 9, cost: 'high' });
  });

  scoped(/^the steward nominates that candidate for trial$/, (ctx) => {
    ctx.bl1182.run = cli(ctx, ['trial', 'nominate', 'cerebras/trial-model', '--role', ctx.bl1182.role]);
  });

  scoped(/^a one-day trial is armed on a swarm seat for that role$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1182.run;
    assert.equal(status, 0, `nominate exited ${status}: ${stdout}${stderr}`);
    assert.match(stdout, /trial armed role=coder/);

    const armed = JSON.parse(fs.readFileSync(path.join(ctx.bl1182.steward, 'trials.json'), 'utf8'))
      .active[ctx.bl1182.role];
    assert.equal(armed.status, 'armed');
    const day = (Date.parse(armed.ends_at) - Date.parse(armed.started_at)) / 3600000;
    assert.equal(day, 24, 'the trial window is one operating day');
    assert.equal(seatedModel(ctx), 'trial-model', 'the seat runs the trialled model');
    discard(ctx);
  });

  // ── 02 / 03 / 04: the assessed outcomes ───────────────────────────────
  const armTrial = (ctx, { score, cost, evidence }) => {
    seed(ctx, 'coder', { score, cost });
    const args = ['trial', 'nominate', 'cerebras/trial-model', '--role', 'coder'];
    if (evidence) {
      args.push('--evidence', evidence);
    }
    const out = cli(ctx, args);
    assert.equal(out.status, 0, `nominate exited ${out.status}: ${out.stdout}${out.stderr}`);
  };

  scoped(/^a day trial that effectively outranks the permanent model$/, (ctx) => {
    armTrial(ctx, { score: PERMANENT.score + 2, cost: 'high' });
  });

  scoped(/^a day trial that ties the permanent model on performance$/, (ctx) => {
    ctx.bl1182Pending = { score: PERMANENT.score };
  });

  scoped(/^the trialled model has a cheaper cost class$/, (ctx) => {
    armTrial(ctx, { score: ctx.bl1182Pending.score, cost: 'low' });
  });

  scoped(/^a day trial that loses to the permanent model$/, (ctx) => {
    armTrial(ctx, { score: PERMANENT.score - 3, cost: 'low', evidence: 'scorecards/first.json' });
  });

  scoped(/^end-of-day assessment completes$/, (ctx) => {
    ctx.bl1182.run = cli(ctx, ['trial', 'assess', '--role', ctx.bl1182.role]);
    assert.equal(ctx.bl1182.run.status, 0, `assess failed: ${ctx.bl1182.run.stderr}`);
  });

  scoped(/^the trialled model becomes permanent for that role$/, (ctx) => {
    assert.match(ctx.bl1182.run.stdout, /trial promote role=coder/);
    assert.match(ctx.bl1182.run.stdout, /permanent=cerebras\/trial-model/);
    assert.equal(seatedModel(ctx), 'trial-model');
    discard(ctx);
  });

  scoped(/^the cheaper model becomes permanent for that role$/, (ctx) => {
    assert.match(ctx.bl1182.run.stdout, /trial promote role=coder/);
    assert.match(ctx.bl1182.run.stdout, /tie at/, 'the reason must say it was decided on a tie');
    assert.match(ctx.bl1182.run.stdout, /cheaper/);
    assert.equal(seatedModel(ctx), 'trial-model');
    discard(ctx);
  });

  scoped(/^the seat reverts to the permanent model$/, (ctx) => {
    assert.match(ctx.bl1182.run.stdout, /trial revert role=coder/);
    assert.equal(seatedModel(ctx), PERMANENT.model);
  });

  scoped(/^steward evidence records the loss against silent re-trial$/, (ctx) => {
    const trials = JSON.parse(fs.readFileSync(path.join(ctx.bl1182.steward, 'trials.json'), 'utf8'));
    const losers = trials.losers[ctx.bl1182.role] || [];
    assert.equal(losers.length, 1, `expected one recorded loss, got ${JSON.stringify(losers)}`);
    assert.equal(losers[0].evidence, 'scorecards/first.json');

    // The record is not decoration: the same evidence buys no second trial.
    const again = cli(ctx, [
      'trial', 'nominate', 'cerebras/trial-model', '--role', ctx.bl1182.role,
      '--evidence', 'scorecards/first.json',
    ]);
    assert.notEqual(again.status, 0, 'a re-trial on the same evidence was allowed');
    assert.match(again.stderr, /already lost a trial/);
    discard(ctx);
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^a trial starts or ends with a model change for one role$/, (ctx) => {
    armTrial(ctx, { score: PERMANENT.score - 3, cost: 'low' });
    ctx.bl1182.run = cli(ctx, ['trial', 'assess', '--role', ctx.bl1182.role]);
    assert.equal(ctx.bl1182.run.status, 0, `assess failed: ${ctx.bl1182.run.stderr}`);
  });

  scoped(/^agent-memory transfer runs before live work resumes$/, (ctx) => {
    const calls = fs.readFileSync(ctx.bl1182.calls, 'utf8').split('\n').filter(Boolean);
    const boundaries = calls.map((line) => line.split(' ')[line.split(' ').indexOf('--boundary') + 1]);
    assert.deepEqual(
      boundaries,
      ['start', 'end'],
      `both model-changing boundaries must transfer memory; got ${JSON.stringify(calls)}`
    );
    for (const line of calls) {
      assert.ok(line.includes(`--role ${ctx.bl1182.role}`), `transfer did not name the role: ${line}`);
    }
    discard(ctx);
  });
}

module.exports = { registerSteps };
