'use strict';

// BL-1702: step handlers for "the first local pack canaries one real
// ticket on a probe-certified local coder". Scenario 1 reads the REAL
// pack conf (swarmforge/packs/mixed-local-coder.conf) and drives the REAL
// driver-seat? predicate (local_parcel_driver_lib.bb) - never a
// reimplementation of BL-1697's own driver-seat rule. Scenario Outline 2
// drives the REAL staffing gate CLI (local_coder_probe_gate_cli.bb)
// against a scratch fixture root, the same shape QA's own manual
// acceptance procedure uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1702 the first local pack canaries one real ticket on a probe-certified local coder';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_coder_probe_gate_cli.bb');
const PACK_CONF = path.join(REPO_ROOT, 'swarmforge', 'packs', 'mixed-local-coder.conf');
const DRIVER_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');

function parseWindowLines(confText) {
  return confText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter((tokens) => tokens[0] === 'window')
    .map((tokens) => ({
      role: tokens[1],
      agent: tokens[2].toLowerCase(),
      rest: tokens.slice(3).join(' '),
    }));
}

function flagValue(text, flag) {
  const tokens = text.split(/\s+/);
  const i = tokens.indexOf(flag);
  return i === -1 ? undefined : tokens[i + 1];
}

// Drives the REAL BL-1697 predicate, never a JS restatement of it.
function isDriverSeat(agent, role) {
  const script = `(load-file "${DRIVER_LIB}")\n(println (local-parcel-driver-lib/driver-seat? "${agent}" "${role}"))\n`;
  const r = spawnSync('bb', ['-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, `driver-seat? crashed: ${r.stderr}`);
  return r.stdout.trim() === 'true';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the mixed local-coder pack conf$/, (ctx) => {
    ctx.confText = fs.readFileSync(PACK_CONF, 'utf8');
    ctx.windows = parseWindowLines(ctx.confText);
  });

  // ── Scenario: the mixed pack's roster ────────────────────────────────
  scoped(/^the pack's roster is resolved$/, () => {
    // no-op: Background already parsed the real, committed conf.
  });

  scoped(/^coder@2 runs aider on a local model, is a driver seat and declares the easy seat tier$/, (ctx) => {
    const w = ctx.windows.find((x) => x.role === 'coder@2');
    assert.ok(w, `expected a coder@2 window line, got roles: ${ctx.windows.map((x) => x.role)}`);
    assert.equal(w.agent, 'aider', `expected coder@2 to run aider, got ${w.agent}`);
    const model = flagValue(w.rest, '--model');
    assert.ok(model, 'expected coder@2 to declare a --model');
    assert.equal(isDriverSeat(w.agent, w.role), true, 'expected coder@2 to be a BL-1697 driver seat');
    assert.equal(flagValue(w.rest, '--seat-tier'), 'easy', 'expected coder@2 to declare --seat-tier easy');
  });

  scoped(/^the coder seat runs Claude and declares the hard seat tier$/, (ctx) => {
    const w = ctx.windows.find((x) => x.role === 'coder');
    assert.ok(w, 'expected a bare coder window line');
    assert.equal(w.agent, 'claude', `expected coder to run claude, got ${w.agent}`);
    assert.equal(flagValue(w.rest, '--seat-tier'), 'hard', 'expected coder to declare --seat-tier hard');
    assert.equal(isDriverSeat(w.agent, w.role), false, 'the Claude coder seat is never a driver seat');
  });

  scoped(/^every other seat, the coordinator and the specifier included, runs Claude$/, (ctx) => {
    const others = ctx.windows.filter((x) => x.role !== 'coder' && x.role !== 'coder@2');
    assert.ok(others.length > 0, 'expected at least one other window line');
    for (const w of others) {
      assert.equal(w.agent, 'claude', `expected seat '${w.role}' to run claude, got ${w.agent}`);
    }
    // BL-243: the coordinator is reserved infrastructure and is never a
    // window line - only its optional `config coordinator_model`/
    // `config coordinator_agent` overrides say what it runs. Neither line
    // is present here (full-forge's own default, Claude, carries over).
    assert.doesNotMatch(ctx.confText, /^config coordinator_agent /m, 'expected no coordinator_agent override away from Claude');
    const coordinatorModel = ctx.confText.match(/^config coordinator_model (\S+)/m);
    if (coordinatorModel) {
      assert.ok(coordinatorModel[1].startsWith('claude'), `expected the coordinator to run a claude model, got ${coordinatorModel[1]}`);
    }
  });

  // ── Scenario Outline: the staffing gate ─────────────────────────────
  scoped(/^the newest probe summary for the pack's local coder model (.+)$/, (ctx, summary) => {
    ctx.root = trackedTmpRoot('bl1702-probe-gate-');
    fs.mkdirSync(path.join(ctx.root, 'swarmforge', 'packs'), { recursive: true });
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'evidence'), { recursive: true });
    fs.copyFileSync(PACK_CONF, path.join(ctx.root, 'swarmforge', 'packs', 'mixed-local-coder.conf'));

    const w = parseWindowLines(fs.readFileSync(PACK_CONF, 'utf8')).find((x) => x.role === 'coder@2');
    ctx.model = flagValue(w.rest, '--model').replace(/^openai\//, '');

    if (summary === 'does not exist') {
      return; // no evidence file written - the "no probe summary" case.
    }
    const match = summary.match(/^records (\d+) of 5 handed off and (.+)$/);
    assert.ok(match, `unrecognized Examples "summary" text: "${summary}"`);
    const handedOff = Number(match[1]);
    const breached = match[2].includes('breached');
    const verdict = handedOff >= 4 && !breached ? 'pass' : 'fail';
    const safeModel = ctx.model.replace(/[:/]/g, '-');
    const filename = `local-coder-probe-${safeModel}-2026-09-27T00-00-00Z.md`;
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'evidence', filename),
      `# local coder probe: ${ctx.model}\n\nhanded off ${handedOff} of 5 - verdict ${verdict}\n`
    );
  });

  scoped(/^the pack's staffing gate runs$/, (ctx) => {
    ctx.result = spawnSync('bb', [GATE_CLI, ctx.root, 'mixed-local-coder'], { encoding: 'utf8', timeout: 30000 });
  });

  scoped(/^it refuses the launch naming the model and "([^"]+)"$/, (ctx, reason) => {
    const out = `${ctx.result.stdout || ''}${ctx.result.stderr || ''}`;
    assert.notEqual(ctx.result.status, 0, `expected a refusal, got: ${out}`);
    assert.ok(out.includes(ctx.model), `expected the refusal to name the model "${ctx.model}", got: ${out}`);
    assert.ok(out.includes(reason), `expected the reason "${reason}", got: ${out}`);
  });

  scoped(/^it admits the launch and cites the summary's path$/, (ctx) => {
    const out = `${ctx.result.stdout || ''}${ctx.result.stderr || ''}`;
    assert.equal(ctx.result.status, 0, `expected admission, got: ${out}`);
    assert.match(out, /^admit\t/m, `expected an admit decision line, got: ${out}`);
    assert.match(out, /local-coder-probe-.*\.md/, `expected the summary's path cited, got: ${out}`);
  });
}

module.exports = { registerSteps };
