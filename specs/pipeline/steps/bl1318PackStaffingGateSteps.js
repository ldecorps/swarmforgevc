'use strict';

// BL-1318: step handlers for "pack launch refuses a seat whose model the
// steward has not cleared for that role". Every scenario drives the REAL
// machinery, never a reimplementation:
//   - the CLI fs-adapter (pack_staffing_gate_cli.bb) for the structured
//     per-seat decision (role/provider/model/failing-check/steward-command),
//     the same TSV contract swarmforge.sh's own pack_staffing_gate parses;
//   - the REAL swarmforge.sh sourced and its REAL parse_config run against a
//     real fixture swarmforge.conf, for the launch-level behavioral claims
//     ("refused before any tmux window exists", "every window staffs") -
//     this is required_wiring anchor 1, proven live, not just callable.
// MODEL_STEWARD_STATE_DIR isolates every run to a scratch fixture - this
// never reads or writes this checkout's own real .swarmforge/model-steward/.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1318 pack launch refuses a seat whose model the steward has not cleared for that role';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const GATE_CLI = path.join(SCRIPTS_DIR, 'pack_staffing_gate_cli.bb');

// Explicit known values per the Scenario Outline handler rule: each
// substituted <standing>/<failing_check> is validated against the closed
// set the feature's own Examples table (plus the literal scenarios that
// reuse the same wording) actually use - an unknown row is a hard failure,
// never a passthrough. Each standing is wired to a REAL agent/model pinned
// through pack_staffing_gate_lib.bb's own resolvable table (never a
// fixture-only mapping) so QA's window line is exactly the shape a real
// pack would write.
const STANDINGS = {
  'globally certified but absent from the QA role-matrix': {
    agent: 'claude',
    model: 'claude-opus-5',
    providerModel: 'anthropic/claude-opus-5',
    failingCheck: 'not-on-role-matrix',
  },
  'ranked on the QA role-matrix with a human-verdict-pending QA-gate': {
    agent: 'claude',
    model: 'qwen3.8-max',
    providerModel: 'qwen/qwen3.8-max',
    failingCheck: 'role-gate-not-pass',
  },
  'ranked with a passing QA-gate but no longer assignment-eligible': {
    agent: 'cursor',
    model: 'auto',
    providerModel: 'cursor/auto',
    failingCheck: 'not-assignment-eligible',
  },
  'ranked on the QA role-matrix with a passing QA-gate and still assignment-eligible': {
    agent: 'claude',
    model: 'claude-sonnet-5',
    providerModel: 'anthropic/claude-sonnet-5',
    failingCheck: null,
  },
};

const KNOWN_FAILING_CHECKS = new Set([
  'not-on-role-matrix',
  'role-gate-not-pass',
  'not-assignment-eligible',
  'seat-model-unresolved',
]);

// The 6 non-QA pipeline roles the Background's pack fixture pins - all on
// the SAME fully-cleared anthropic/claude-sonnet-5 identity, each ranked +
// gate-passed for its OWN role competency (BL-1318's per-role gate).
const OTHER_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter'];
const GATE_COMPETENCY = { hardender: 'hardener-gate' };
const competencyFor = (role) => GATE_COMPETENCY[role] || `${role}-gate`;

function sweepStale() {
  const base = os.tmpdir();
  for (const name of fs.readdirSync(base)) {
    if (name.startsWith('bl1318-acc-')) {
      try {
        fs.rmSync(path.join(base, name), { recursive: true, force: true });
      } catch {
        // best-effort - a live run's own dir is removed by its own cleanup
      }
    }
  }
}

function mkFixture() {
  sweepStale();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1318-acc-'));
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(path.join(stateDir, 'scorecards'), { recursive: true });

  const models = {
    'anthropic/claude-sonnet-5': { provider: 'anthropic', model: 'claude-sonnet-5', status: 'certified', certification_report_path: null },
  };
  const roleMatrix = {};
  for (const role of OTHER_ROLES) {
    roleMatrix[role] = [{ provider: 'anthropic', model: 'claude-sonnet-5', score: 0.9, evidence: 'compliance-battery:bl1318-fixture' }];
  }
  const sonnetEntries = OTHER_ROLES.map((role) => ({ competency: competencyFor(role), status: 'pass' }));

  const registry = { models, capabilities: {}, role_matrix: roleMatrix, adapters: {} };
  fs.writeFileSync(path.join(stateDir, 'registry.json'), JSON.stringify(registry, null, 2));
  fs.writeFileSync(
    path.join(stateDir, 'scorecards', 'anthropic__claude-sonnet-5.json'),
    JSON.stringify({ model: 'claude-sonnet-5', entries: sonnetEntries }, null, 2)
  );

  return { root, stateDir, registry, sonnetEntries };
}

// Merges one QA standing's identity into the fixture's registry/scorecards
// (mutating the same files mkFixture wrote), matching the incident shape:
// a model already registered/ranked for OTHER roles gaining a QA claim.
function wireQaStanding(fx, standingKey) {
  const s = STANDINGS[standingKey];
  assert.ok(s, `unknown standing "${standingKey}" - the handlers know ${Object.keys(STANDINGS)}`);
  const [provider, model] = s.providerModel.split('/');
  const registry = JSON.parse(fs.readFileSync(path.join(fx.stateDir, 'registry.json'), 'utf8'));
  const scorecardPath = path.join(fx.stateDir, 'scorecards', `${provider}__${model}.json`);
  const scorecard = fs.existsSync(scorecardPath) ? JSON.parse(fs.readFileSync(scorecardPath, 'utf8')) : { model, entries: [] };

  switch (standingKey) {
    case 'globally certified but absent from the QA role-matrix':
      registry.models[s.providerModel] = { provider, model, status: 'certified', certification_report_path: null };
      registry.role_matrix.coder = registry.role_matrix.coder || [];
      registry.role_matrix.coder.push({ provider, model, score: 0.85, evidence: 'recruiter-scorecard:bl1318-fixture' });
      break;
    case 'ranked on the QA role-matrix with a human-verdict-pending QA-gate':
      registry.models[s.providerModel] = { provider, model, status: 'certified', certification_report_path: null };
      registry.role_matrix.QA = registry.role_matrix.QA || [];
      registry.role_matrix.QA.push({ provider, model, score: 0.8, evidence: 'compliance-battery:bl1318-fixture' });
      scorecard.entries.push({ competency: 'QA-gate', status: 'human-verdict-pending' });
      break;
    case 'ranked with a passing QA-gate but no longer assignment-eligible':
      registry.models[s.providerModel] = { provider, model, status: 'candidate', certification_report_path: null };
      registry.role_matrix.QA = registry.role_matrix.QA || [];
      registry.role_matrix.QA.push({ provider, model, score: 0.8, evidence: 'compliance-battery:bl1318-fixture' });
      scorecard.entries.push({ competency: 'QA-gate', status: 'pass' });
      break;
    case 'ranked on the QA role-matrix with a passing QA-gate and still assignment-eligible':
      // reuses the shared anthropic/claude-sonnet-5 identity every other
      // role already staffs on.
      registry.role_matrix.QA = registry.role_matrix.QA || [];
      registry.role_matrix.QA.push({ provider, model, score: 0.9, evidence: 'compliance-battery:bl1318-fixture' });
      scorecard.entries.push({ competency: 'QA-gate', status: 'pass' });
      break;
    default:
      throw new Error(`unhandled standing "${standingKey}"`);
  }

  fs.writeFileSync(path.join(fx.stateDir, 'registry.json'), JSON.stringify(registry, null, 2));
  fs.writeFileSync(scorecardPath, JSON.stringify(scorecard, null, 2));
  return s;
}

function writeConf(fx, qaWindowLine) {
  const lines = ['config active_backlog_max_depth -1'];
  for (const role of OTHER_ROLES) {
    lines.push(`window ${role} claude ${role === 'specifier' ? 'master' : role} --model claude-sonnet-5`);
  }
  lines.push(qaWindowLine);
  const confPath = path.join(fx.root, 'swarmforge.conf');
  fs.writeFileSync(confPath, lines.join('\n') + '\n');

  const projectRoot = path.join(fx.root, 'project');
  fs.mkdirSync(path.join(projectRoot, 'swarmforge', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of [...OTHER_ROLES, 'QA']) {
    fs.writeFileSync(path.join(projectRoot, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.copyFileSync(confPath, path.join(projectRoot, 'swarmforge', 'swarmforge.conf'));
  return projectRoot;
}

function runGateCli(fx, windows, extraArgs = []) {
  const wf = path.join(fx.root, `windows-${Date.now()}-${Math.random().toString(36).slice(2)}.tsv`);
  fs.writeFileSync(wf, windows.map((w) => w.join('\t')).join('\n') + '\n');
  const r = spawnSync('bb', [GATE_CLI, REPO_ROOT, wf, ...extraArgs], { encoding: 'utf8', env: { ...process.env, MODEL_STEWARD_STATE_DIR: fx.stateDir } });
  assert.equal(r.status, 0, `pack_staffing_gate_cli.bb exited nonzero: ${r.stderr}`);
  // NEVER .trim() the whole blob first - a trailing empty TSV field (a
  // "pass" decision's failing-check/steward-command columns) is a literal
  // trailing tab, and .trim() strips tabs as whitespace right along with
  // the newline, silently dropping empty trailing columns.
  return r.stdout
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.split('\t'));
}

function runRealParse(fx, projectRoot, extraEnv) {
  const cmd = `source '${SWARMFORGE_SH}' '${projectRoot}'; parse_config; echo "ROLE_COUNT=\${#ROLES[@]}"; echo PARSE_CONFIG_RETURNED`;
  const r = spawnSync('zsh', ['-c', cmd], {
    encoding: 'utf8',
    env: { ...process.env, MODEL_STEWARD_STATE_DIR: fx.stateDir, ...extraEnv },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function snapshotStateDir(stateDir) {
  const snap = {};
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        walk(p);
      } else {
        snap[path.relative(stateDir, p)] = fs.readFileSync(p, 'utf8');
      }
    }
  };
  walk(stateDir);
  return snap;
}

function cleanup(ctx) {
  if (ctx.fx && ctx.fx.root) {
    try {
      fs.rmSync(ctx.fx.root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a steward registry fixture carrying a role matrix and a compliance scorecard per model$/, (ctx) => {
    ctx.fx = mkFixture();
  });

  scoped(/^a pack fixture whose window lines pin an agent and a model for every pipeline role$/, (ctx) => {
    assert.ok(ctx.fx, 'the steward registry fixture must be built first');
    ctx.otherRolesWired = true;
  });

  // ── Scenario Outline 01 + literal scenarios 03/04 reuse this same Given ──
  scoped(/^the pack's QA window resolves to a model that is (.+)$/, (ctx, standing) => {
    try {
      ctx.standing = wireQaStanding(ctx.fx, standing);
      ctx.qaWindowLine = `window QA ${ctx.standing.agent} QA --model ${ctx.standing.model}`;
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the pack's QA window names an agent and model the seat resolver has no mapping for$/, (ctx) => {
    try {
      ctx.standing = { agent: 'claude', model: 'totally-unmapped-model-xyz', providerModel: null, failingCheck: 'seat-model-unresolved' };
      ctx.qaWindowLine = `window QA ${ctx.standing.agent} QA --model ${ctx.standing.model}`;
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the operator sets the staffing-gate override$/, (ctx) => {
    ctx.override = true;
  });

  scoped(/^the pack is parsed for launch$/, (ctx) => {
    try {
      const projectRoot = writeConf(ctx.fx, ctx.qaWindowLine);
      ctx.beforeSnapshot = snapshotStateDir(ctx.fx.stateDir);

      // The structured per-seat decision (role/provider/model/failing-check/
      // steward-command), fetched directly from the CLI so assertions below
      // key off exact fields rather than parsing swarmforge.sh's prose.
      const qaDecisionRows = runGateCli(ctx.fx, [['QA', 'QA', ctx.standing.agent, `--model ${ctx.standing.model}`]]);
      ctx.qaDecision = qaDecisionRows[0];

      ctx.launch = runRealParse(ctx.fx, projectRoot, ctx.override ? { PACK_STAFFING_SKIP_GATE: '1' } : {});
      ctx.afterSnapshot = snapshotStateDir(ctx.fx.stateDir);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^launch is refused before any seat is staffed$/, (ctx) => {
    try {
      assert.notEqual(ctx.launch.status, 0, `expected parse_config to refuse:\n${ctx.launch.out}`);
      assert.ok(
        !ctx.launch.out.includes('PARSE_CONFIG_RETURNED'),
        `parse_config must exit before returning - no tmux window is ever opened after it:\n${ctx.launch.out}`
      );
    } finally {
      // scenario ends here for 01/02 - clean up now.
      if (!ctx.override) cleanup(ctx);
    }
  });

  scoped(
    /^the refusal names the role, the resolved provider and model, the failing check "([^"]+)", and the steward command that would clear it$/,
    (ctx, failingCheck) => {
      try {
        assert.ok(KNOWN_FAILING_CHECKS.has(failingCheck), `unknown failing_check "${failingCheck}"`);
        assert.equal(failingCheck, ctx.standing.failingCheck, 'the Example row and the fixture wiring disagree on the failing check');
        assert.match(ctx.launch.out, /role 'QA'/, `refusal did not name the role:\n${ctx.launch.out}`);
        const [provider, model] = ctx.standing.providerModel.split('/');
        assert.ok(ctx.launch.out.includes(`${provider}/${model}`), `refusal did not name ${provider}/${model}:\n${ctx.launch.out}`);
        assert.ok(ctx.launch.out.includes(failingCheck), `refusal did not report ${failingCheck}:\n${ctx.launch.out}`);
        assert.match(ctx.launch.out, /model_steward_cli\.bb|compliance_battery\.bb/, `refusal did not carry a runnable steward command:\n${ctx.launch.out}`);

        assert.equal(ctx.qaDecision[1], 'refuse', `expected the QA CLI decision to be refuse: ${ctx.qaDecision}`);
        assert.equal(ctx.qaDecision[4], failingCheck, `CLI decision named the wrong failing check: ${ctx.qaDecision}`);
      } finally {
        cleanup(ctx);
      }
    }
  );

  scoped(
    /^the refusal names the role, quotes the unresolved window line, and reports the failing check "([^"]+)"$/,
    (ctx, failingCheck) => {
      try {
        assert.equal(failingCheck, 'seat-model-unresolved');
        assert.match(ctx.launch.out, /role 'QA'/, `refusal did not name the role:\n${ctx.launch.out}`);
        assert.ok(
          ctx.launch.out.includes(`window line '${ctx.standing.agent} --model ${ctx.standing.model}`),
          `refusal did not quote the unresolved window line:\n${ctx.launch.out}`
        );
        assert.ok(ctx.launch.out.includes('seat-model-unresolved'), `refusal did not report seat-model-unresolved:\n${ctx.launch.out}`);
        assert.equal(ctx.qaDecision[1], 'refuse');
        assert.equal(ctx.qaDecision[4], 'seat-model-unresolved');
      } finally {
        cleanup(ctx);
      }
    }
  );

  scoped(/^every window staffs$/, (ctx) => {
    assert.equal(ctx.launch.status, 0, `expected parse_config to succeed:\n${ctx.launch.out}`);
    // 7 declared pipeline windows + provision_coordinator's own
    // always-auto-provisioned coordinator slot (parse_config's own tail
    // call, Article 1.1/BL-243 - reserved infrastructure, never a window
    // line, but still a ROLES entry).
    assert.match(ctx.launch.out, /ROLE_COUNT=8/, `expected all 7 pipeline windows plus the auto-provisioned coordinator to register:\n${ctx.launch.out}`);
    assert.match(ctx.launch.out, /PARSE_CONFIG_RETURNED/, `parse_config did not complete:\n${ctx.launch.out}`);
  });

  scoped(/^the gate records a pass decision naming the role and the resolved provider and model$/, (ctx) => {
    try {
      assert.equal(ctx.qaDecision[0], 'QA');
      assert.equal(ctx.qaDecision[1], 'pass', `expected a pass decision: ${ctx.qaDecision}`);
      assert.equal(ctx.qaDecision[2], 'anthropic');
      assert.equal(ctx.qaDecision[3], 'claude-sonnet-5');
      assert.equal(ctx.qaDecision[4], '', `a pass decision must name no failing check: ${ctx.qaDecision}`);
      assert.ok(!ctx.launch.out.includes('WARNING'), `a plain pass must not print an override warning:\n${ctx.launch.out}`);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a warning names the role, the resolved provider and model, and the failing check$/, (ctx) => {
    try {
      assert.match(ctx.launch.out, /WARNING: pack staffing gate OVERRIDE/, `no override warning printed:\n${ctx.launch.out}`);
      assert.match(ctx.launch.out, /role 'QA'/, `warning did not name the role:\n${ctx.launch.out}`);
      const [provider, model] = ctx.standing.providerModel.split('/');
      assert.ok(ctx.launch.out.includes(`${provider}/${model}`), `warning did not name ${provider}/${model}:\n${ctx.launch.out}`);
      assert.ok(ctx.launch.out.includes(ctx.standing.failingCheck), `warning did not name the failing check:\n${ctx.launch.out}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the recorded decision is "override" and never "pass"$/, (ctx) => {
    try {
      const [row] = runGateCli(ctx.fx, [['QA', 'QA', ctx.standing.agent, `--model ${ctx.standing.model}`]], ['--override']);
      assert.equal(row[1], 'override', `expected an override decision: ${row}`);
      assert.notEqual(row[1], 'pass', 'override must never be recorded as pass');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the steward registry, its scorecards and its role matrices are byte-identical to before the parse$/, (ctx) => {
    assert.deepEqual(ctx.afterSnapshot, ctx.beforeSnapshot, 'the gate wrote to steward evidence it must only read (invariant 2)');
  });

  scoped(/^no compliance battery is run$/, (ctx) => {
    try {
      const stateFiles = Object.keys(ctx.afterSnapshot);
      const beforeFiles = Object.keys(ctx.beforeSnapshot);
      assert.deepEqual(stateFiles.sort(), beforeFiles.sort(), 'no new evidence file may appear - the gate never runs a compliance battery');
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
