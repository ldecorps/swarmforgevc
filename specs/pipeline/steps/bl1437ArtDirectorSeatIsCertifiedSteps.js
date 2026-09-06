'use strict';

// BL-1437: step handlers for "BL-1437 The art-director seat has a
// certified model". Every scenario drives the REAL model_steward_cli.bb,
// model_factory_cli.bb and pack_staffing_gate_cli.bb - never a
// reimplementation of any of their decisions. Scenarios 01 and 04 read
// this parcel's own committed tree (the seed, the scorecard, and the
// certification report) - a read-only live-tree read justified because
// they are the contract at this commit. Scenarios 02 and 03 run the real
// CLIs against isolated MODEL_STEWARD_STATE_DIR / MODEL_FACTORY_STATE_DIR
// temp dirs seeded from that same committed seed (empty on creation, so
// both CLIs fall back to reading it) - never the live
// `.swarmforge/model-steward/` state.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1437 The art-director seat has a certified model';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEWARD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');
const FACTORY_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_factory_cli.bb');
const STAFFING_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pack_staffing_gate_cli.bb');
const SEED_PATH = path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json');
const MODEL_STEWARD_DIR = path.join(REPO_ROOT, 'swarmforge', 'model-steward');
const FULL_FORGE_CONF = path.join(REPO_ROOT, 'swarmforge', 'packs', 'full-forge.conf');

const KNOWN_MODES = new Set(['quality', 'cheap']);

const tmpRoots = [];
process.on('exit', () => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(p);
  return p;
}

function runBb(script, args, env) {
  try {
    const out = execFileSync('bb', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { exit: 0, out, err: '' };
  } catch (e) {
    return { exit: e.status ?? 1, out: e.stdout ? e.stdout.toString() : '', err: e.stderr ? e.stderr.toString() : String(e.message || e) };
  }
}

function allJsonFilesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  };
  walk(root);
  return out;
}

// swarmforge.conf window line: `window <seat-id> <agent> <stage> <extra-cli...>`.
function findWindowLine(confPath, seatId) {
  const text = fs.readFileSync(confPath, 'utf8');
  const line = text.split('\n').find((l) => {
    const t = l.trim().split(/\s+/);
    return t[0] === 'window' && t[1] === seatId;
  });
  assert.ok(line, `expected a "window ${seatId} ..." line in ${confPath}`);
  const tokens = line.trim().split(/\s+/);
  return { seatId: tokens[1], agent: tokens[2], stage: tokens[3], extraCli: tokens.slice(4).join(' ') };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^the Model Steward registry seeded from the parcel's own models\.seed\.json into a fixture state directory$/,
    (ctx) => {
      ctx.stewardDir = mkTmp('sfvc-bl1437-steward-');
      ctx.factoryDir = mkTmp('sfvc-bl1437-factory-');
      ctx.env = { MODEL_STEWARD_STATE_DIR: ctx.stewardDir, MODEL_FACTORY_STATE_DIR: ctx.factoryDir };
    }
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the art-director row of the role matrix is read$/, (ctx) => {
    const { exit, out } = runBb(STEWARD_CLI, ['role-matrix', 'art-director'], ctx.env);
    assert.equal(exit, 0, `expected role-matrix to succeed, got: ${out}`);
    const line = out.trim().split('\n')[0];
    assert.ok(line, `expected at least one role_matrix row for art-director, got: ${out}`);
    const [providerModel, , evidence] = line.split(' ');
    const [provider, model] = providerModel.split('/');
    ctx.roleMatrixRow = { provider, model, evidence };
  });

  scoped(/^it names a provider and model whose registry status is certified$/, (ctx) => {
    const { provider, model } = ctx.roleMatrixRow;
    const { out, exit } = runBb(STEWARD_CLI, ['show', `${provider}/${model}`], ctx.env);
    assert.equal(exit, 0, `expected show to succeed, got: ${out}`);
    const entry = JSON.parse(out.trim());
    assert.equal(entry.status, 'certified', `expected status certified, got: ${JSON.stringify(entry)}`);
  });

  scoped(/^its evidence pointer resolves to a scorecard artifact committed in the repository$/, (ctx) => {
    const files = allJsonFilesUnder(path.join(MODEL_STEWARD_DIR, 'scorecards'));
    const match = files.find((f) => JSON.parse(fs.readFileSync(f, 'utf8')).scorecard_id === ctx.roleMatrixRow.evidence);
    assert.ok(match, `expected a committed scorecards/*.json whose own scorecard_id equals "${ctx.roleMatrixRow.evidence}"`);
  });

  // ── Scenario 02 (outline) ────────────────────────────────────────────
  scoped(/^the model factory resolves the full swarm assignment in (\S+) mode$/, (ctx, mode) => {
    assert.ok(KNOWN_MODES.has(mode), `unknown <mode> example value: ${mode}`);
    ctx.assignResult = runBb(FACTORY_CLI, ['assign', '--mode', mode], ctx.env);
  });

  scoped(/^the assignment names art-director with a certified model and a launch agent$/, (ctx) => {
    const { out, exit } = ctx.assignResult;
    assert.equal(exit, 0, `expected assign to succeed, got: ${out}`);
    const assignment = JSON.parse(out.trim());
    assert.ok(Object.prototype.hasOwnProperty.call(assignment, 'art-director'), `expected the assignment to name art-director, got keys: ${Object.keys(assignment)}`);
    const seat = assignment['art-director'];
    assert.ok(seat.provider && seat.model, `expected art-director's seat to name a provider and model, got: ${JSON.stringify(seat)}`);
    assert.ok(seat.agent, `expected art-director's seat to name a launch agent, got: ${JSON.stringify(seat)}`);
    const { out: showOut, exit: showExit } = runBb(STEWARD_CLI, ['show', `${seat.provider}/${seat.model}`], ctx.env);
    assert.equal(showExit, 0, `expected show to succeed, got: ${showOut}`);
    assert.equal(JSON.parse(showOut.trim()).status, 'certified', `expected the assigned model to be certified, got: ${showOut}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the staffing gate evaluates the full-forge pack's art-director window line$/, (ctx) => {
    // The role-matrix row this parcel delivers is only HALF of what the
    // staffing gate's own decision needs (seat-staffing-decision's third
    // check, role-gate-passed?, reads a SEPARATE compliance-battery
    // scorecard keyed by provider/model - BL-1079's own concept, out of
    // this ticket's scope). A synthetic one is seeded into the SAME fixture
    // state directory the Background built, so the gate's decision for
    // THIS ticket's own contribution (ranked-on-role-matrix?) is isolated
    // from that separately-scoped gate.
    const scorecardsDir = path.join(ctx.stewardDir, 'scorecards');
    fs.mkdirSync(scorecardsDir, { recursive: true });
    fs.writeFileSync(
      path.join(scorecardsDir, 'anthropic__claude-sonnet-5.json'),
      JSON.stringify({ entries: [{ competency: 'art-director-gate', status: 'pass' }] })
    );
    const w = findWindowLine(FULL_FORGE_CONF, 'art-director');
    const windowsFile = path.join(ctx.stewardDir, 'windows.tsv');
    fs.writeFileSync(windowsFile, `${w.seatId}\t${w.stage}\t${w.agent}\t${w.extraCli}\n`);
    const { out, exit } = runBb(STAFFING_CLI, [REPO_ROOT, windowsFile], ctx.env);
    assert.equal(exit, 0, `expected the staffing gate CLI to run cleanly, got: ${out}`);
    const line = out.split('\n').find((l) => l.length > 0);
    const [seatId, decision, provider, model, failingCheck] = line.split('\t');
    ctx.staffingDecision = { seatId, decision, provider, model, failingCheck };
  });

  scoped(/^its decision for that seat is not refuse$/, (ctx) => {
    assert.notEqual(ctx.staffingDecision.decision, 'refuse', `expected a non-refuse decision, got: ${JSON.stringify(ctx.staffingDecision)}`);
  });

  scoped(/^no check reports the seat as not on the role matrix$/, (ctx) => {
    assert.notEqual(
      ctx.staffingDecision.failingCheck,
      'not-on-role-matrix',
      `expected no not-on-role-matrix failure, got: ${JSON.stringify(ctx.staffingDecision)}`
    );
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the certification report for the art-director model is read$/, () => {
    // shared committed-tree read done in the Then step below, so a report
    // whose OWN :role field is missing (a pre-BL-1437 report shape) fails
    // loudly there rather than being silently skipped here.
  });

  scoped(/^it names the role, the provider and model, the scorecard it rests on, and the date$/, () => {
    const files = allJsonFilesUnder(path.join(MODEL_STEWARD_DIR, 'certification-reports'));
    const match = files
      .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
      .find((body) => body.role === 'art-director');
    assert.ok(match, 'expected a committed certification-reports/*.json whose own role is "art-director"');
    assert.ok(match.role, 'expected the report to name the role');
    assert.ok(match.provider && match.model, 'expected the report to name the provider and model');
    assert.ok(match.scorecard_id, 'expected the report to name the scorecard it rests on');
    assert.ok(match.timestamp, 'expected the report to carry a date/timestamp');
  });
}

module.exports = { registerSteps };
