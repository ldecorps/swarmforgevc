'use strict';

// BL-1512: step handlers for "a diversified fallback pack survives b.ai
// and Anthropic being exhausted together". Same shape as BL-1511's
// step handler: scenario 01 is a structural check driving the REAL
// pack_staffing_gate_lib.bb's resolve-seat (never a reimplementation of
// its agent-model-providers/api-base-host-providers tables); scenario 02
// builds a scratch steward fixture and drives the REAL
// pack_staffing_gate_cli.bb; scenario 03 reads the real header text.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1512 A diversified fallback pack survives b.ai and Anthropic being exhausted together';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PACK_STAFFING_GATE_LIB = path.join(SCRIPTS_DIR, 'pack_staffing_gate_lib.bb');
const STAFFING_GATE_CLI = path.join(SCRIPTS_DIR, 'pack_staffing_gate_cli.bb');
const TICKET_YAML = path.join(
  REPO_ROOT,
  'backlog',
  'active',
  'BL-1512-a-diversified-fallback-pack-survives-two-exhausted-plans.yaml'
);

const PACK_PATH = path.join(SCRIPTS_DIR, '..', 'packs', 'candidate-diversified-fallback-mono-router.conf');

const PIPELINE_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const CURSOR_ROLES = ['specifier', 'cleaner', 'hardender', 'QA'];

function readCoordinatorRuling() {
  const text = fs.readFileSync(TICKET_YAML, 'utf8');
  // human_ruling: "Coordinator stays claude-sonnet-5 (Anthropic) with a
  // header caveat..." - the ruled agent (claude) and model (claude-sonnet-5).
  const match = text.match(/Coordinator stays (\S+) \((\S+)\)/);
  assert.ok(match, `ticket YAML's human_ruling did not match the expected "Coordinator stays <model> (<provider>)" shape:\n${text}`);
  return { model: match[1], provider: match[2] };
}

// The qa_e2e_procedure's own awk field rule (BL-1511's shape, reused
// verbatim - never a different parse): $1=window $2=role $3=agent
// $4=worktree, skip an optional task|batch, an optional
// forward-only|back-one|back-all, an optional idle-clear; the rest is
// extra-cli.
function deriveWindowsFile(packText) {
  return packText
    .split('\n')
    .filter((l) => l.startsWith('window '))
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      const role = fields[1];
      const agent = fields[2];
      let i = 4;
      if (fields[i] === 'task' || fields[i] === 'batch') i += 1;
      if (['forward-only', 'back-one', 'back-all'].includes(fields[i])) i += 1;
      if (fields[i] === 'idle-clear') i += 1;
      const extra = fields.slice(i).join(' ');
      return { role, agent, extra, line: `${role}\t${role}\t${agent}\t${extra}` };
    });
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: structural - every pipeline seat, no anthropic/tencentcloud2 ──
  scoped(/^candidate-diversified-fallback-mono-router\.conf is parsed$/, (ctx) => {
    const packText = fs.readFileSync(PACK_PATH, 'utf8');
    const rows = deriveWindowsFile(packText);
    // The rows travel to bb as a JSON STRING argument, parsed on the
    // Clojure side (cheshire.core/parse-string) - embedding JSON directly
    // as Clojure source is invalid syntax (colons, etc.).
    const resultsJson = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${PACK_STAFFING_GATE_LIB}") ` +
          `(let [rows (cheshire.core/parse-string (slurp *in*) true)] ` +
          `(println (cheshire.core/generate-string (mapv (fn [r] (assoc (pack-staffing-gate-lib/resolve-seat (:agent r) (:extra r)) :role (:role r))) rows))))`,
      ],
      { encoding: 'utf8', input: JSON.stringify(rows) }
    );
    ctx.bl1512resolved = JSON.parse(resultsJson);
    ctx.bl1512rows = rows;
  });

  scoped(/^each of specifier, coder, cleaner, architect, hardender, documenter and QA has one window line$/, (ctx) => {
    for (const role of PIPELINE_ROLES) {
      const matches = ctx.bl1512rows.filter((r) => r.role === role);
      assert.equal(matches.length, 1, `expected exactly one window line for ${role}, got ${matches.length}`);
    }
  });

  scoped(/^none of those lines resolves to the anthropic or the tencentcloud2 provider$/, (ctx) => {
    for (const r of ctx.bl1512resolved) {
      assert.notEqual(r.provider, 'anthropic', `${r.role} resolved to the anthropic provider: ${JSON.stringify(r)}`);
      assert.notEqual(r.provider, 'tencentcloud2', `${r.role} resolved to the tencentcloud2 provider: ${JSON.stringify(r)}`);
    }
  });

  scoped(/^the cursor lines resolve to the cursor provider and the documenter line to the qwen provider$/, (ctx) => {
    for (const role of CURSOR_ROLES) {
      const r = ctx.bl1512resolved.find((x) => x.role === role);
      assert.ok(r, `no resolved entry for ${role}`);
      assert.equal(r.provider, 'cursor', `${role} did not resolve to the cursor provider: ${JSON.stringify(r)}`);
    }
    const doc = ctx.bl1512resolved.find((x) => x.role === 'documenter');
    assert.ok(doc, 'no resolved entry for documenter');
    assert.equal(doc.provider, 'qwen', `documenter did not resolve to the qwen provider: ${JSON.stringify(doc)}`);
  });

  // ── Scenario 02: the gate decides the cursor/qwen lines on steward evidence ──
  const SCORECARD_MODES = {
    'every one of those role gates recorded pass': 'all',
    'every one of those role gates recorded pass except documenter': 'no-documenter',
  };

  function gateCompetency(role) {
    return role === 'hardender' ? 'hardener-gate' : `${role}-gate`;
  }

  function buildStewardFixture(root, mode) {
    const stateDir = path.join(root, '.swarmforge', 'model-steward');
    fs.mkdirSync(path.join(stateDir, 'scorecards'), { recursive: true });
    const cursorRoles = CURSOR_ROLES;
    const roleMatrix = {};
    for (const role of cursorRoles) {
      roleMatrix[role] = [{ provider: 'cursor', model: 'auto', score: 0.9, evidence: 'fixture' }];
    }
    roleMatrix.documenter = [{ provider: 'qwen', model: 'qwen3.7-plus', score: 0.75, evidence: 'fixture' }];
    const models = {
      'cursor/auto': { status: 'certified', provider: 'cursor', model: 'auto' },
      'qwen/qwen3.7-plus': { status: 'certified', provider: 'qwen', model: 'qwen3.7-plus' },
    };
    fs.writeFileSync(path.join(stateDir, 'registry.json'), JSON.stringify({ models, role_matrix: roleMatrix }));
    fs.writeFileSync(
      path.join(stateDir, 'scorecards', 'cursor__auto.json'),
      JSON.stringify({ entries: cursorRoles.map((role) => ({ competency: gateCompetency(role), status: 'pass' })) })
    );
    if (mode === 'all') {
      fs.writeFileSync(
        path.join(stateDir, 'scorecards', 'qwen__qwen3.7-plus.json'),
        JSON.stringify({ entries: [{ competency: 'documenter-gate', status: 'pass' }] })
      );
    } else {
      // 'no-documenter': the qwen scorecard exists (so the model is
      // certified/eligible) but carries no documenter-gate entry -
      // role-gate-not-pass, not seat-model-unresolved or not-on-role-matrix.
      fs.writeFileSync(path.join(stateDir, 'scorecards', 'qwen__qwen3.7-plus.json'), JSON.stringify({ entries: [] }));
    }
  }

  scoped(
    /^a scratch root whose steward registry ranks cursor\/auto on specifier, cleaner, hardender and QA and qwen\/qwen3\.7-plus on documenter, with (.+)$/,
    (ctx, scorecards) => {
      const mode = SCORECARD_MODES[scorecards];
      assert.ok(mode, `unknown scorecards example value: "${scorecards}"`);
      const root = mkSocketFixtureRoot('bl1512-gate-');
      ctx.bl1512gateRoot = root;
      buildStewardFixture(root, mode);
    }
  );

  scoped(/^PACK_STAFFING_SKIP_GATE is unset$/, () => {
    // Asserted by the run step's own env - this step exists so the
    // scenario reads naturally (Given/When/Then), same as BL-1511.
  });

  scoped(/^the pack staffing gate runs on the windows-file derived from the pack by the launcher's field rules$/, (ctx) => {
    const packText = fs.readFileSync(PACK_PATH, 'utf8');
    const rows = deriveWindowsFile(packText);
    ctx.bl1512windowsRows = rows;
    const windowsFile = path.join(ctx.bl1512gateRoot, 'windows.tsv');
    fs.writeFileSync(windowsFile, rows.map((r) => r.line).join('\n') + '\n');
    const env = { ...process.env };
    delete env.PACK_STAFFING_SKIP_GATE;
    const result = execFileSync('bb', [STAFFING_GATE_CLI, ctx.bl1512gateRoot, windowsFile], { env, encoding: 'utf8' });
    ctx.bl1512gateOutput = result
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        const [seatId, decision, provider, model, failingCheck] = l.split('\t');
        return { seatId, decision, provider, model, failingCheck };
      });
    try {
      releaseSocketFixtureRoot(ctx.bl1512gateRoot);
      fs.rmSync(ctx.bl1512gateRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup, never masks the assertions below
    }
  });

  scoped(/^the derived windows-file holds exactly 7 window lines$/, (ctx) => {
    assert.equal(ctx.bl1512windowsRows.length, 7, `expected 7 window lines, got ${ctx.bl1512windowsRows.length}: ${JSON.stringify(ctx.bl1512windowsRows)}`);
  });

  const GATE_VERDICTS = {
    'the four cursor lines and the documenter line read pass': (ctx) => {
      for (const role of [...CURSOR_ROLES, 'documenter']) {
        const row = ctx.bl1512gateOutput.find((r) => r.seatId === role);
        assert.ok(row, `no gate result for ${role}`);
        assert.equal(row.decision, 'pass', `${role} did not read pass: ${JSON.stringify(row)}`);
      }
    },
    'the four cursor lines read pass and the documenter line refuses role-gate-not-pass': (ctx) => {
      for (const role of CURSOR_ROLES) {
        const row = ctx.bl1512gateOutput.find((r) => r.seatId === role);
        assert.ok(row, `no gate result for ${role}`);
        assert.equal(row.decision, 'pass', `${role} did not read pass: ${JSON.stringify(row)}`);
      }
      const doc = ctx.bl1512gateOutput.find((r) => r.seatId === 'documenter');
      assert.ok(doc, 'no gate result for documenter');
      assert.equal(doc.decision, 'refuse', `documenter did not refuse: ${JSON.stringify(doc)}`);
      assert.equal(doc.failingCheck, 'role-gate-not-pass', `documenter refused for the wrong check: ${JSON.stringify(doc)}`);
    },
  };

  scoped(
    /^(the four cursor lines and the documenter line read pass|the four cursor lines read pass and the documenter line refuses role-gate-not-pass)$/,
    (ctx, verdicts) => {
      const check = GATE_VERDICTS[verdicts];
      assert.ok(check, `unknown verdicts example value: "${verdicts}"`);
      check(ctx);
    }
  );

  // ── Scenario 03: the header ───────────────────────────────────────────
  scoped(/^the pack header is read$/, (ctx) => {
    ctx.bl1512headerText = fs.readFileSync(PACK_PATH, 'utf8');
  });

  scoped(/^the coordinator seat matches the ticket's human ruling$/, (ctx) => {
    const ruling = readCoordinatorRuling();
    assert.ok(
      new RegExp(`config coordinator_agent claude`, 'm').test(ctx.bl1512headerText),
      `header does not set coordinator_agent to claude:\n${ctx.bl1512headerText.slice(0, 3000)}`
    );
    assert.ok(
      new RegExp(`config coordinator_model ${ruling.model}`, 'm').test(ctx.bl1512headerText),
      `header does not set coordinator_model to ${ruling.model}:\n${ctx.bl1512headerText.slice(0, 3000)}`
    );
  });

  scoped(/^the header states which coordinator picks were proven live and which were not$/, (ctx) => {
    const text = ctx.bl1512headerText;
    assert.ok(/PROVEN LIVE/i.test(text), 'header does not state which coordinator picks were proven live');
    assert.ok(/no role-matrix data/i.test(text) || /untested/i.test(text), 'header does not state which coordinator picks were not proven');
  });

  scoped(
    /^its LAUNCH line carries PACK_STAFFING_SKIP_GATE=1 and its PREREQ names the codex lines as unresolved by the gate and the documenter line as lacking a recorded documenter gate$/,
    (ctx) => {
      const text = ctx.bl1512headerText;
      const launchMatch = text.match(/# LAUNCH:\n(?:#.*\n)*/);
      assert.ok(launchMatch, `no LAUNCH block found in the header:\n${text.slice(0, 2000)}`);
      assert.ok(/PACK_STAFFING_SKIP_GATE=1/.test(launchMatch[0]), `LAUNCH block does not carry PACK_STAFFING_SKIP_GATE=1:\n${launchMatch[0]}`);

      const prereqMatch = text.match(/# PREREQ[^\n]*\n(?:#.*\n)*/);
      assert.ok(prereqMatch, `no PREREQ block found in the header:\n${text.slice(0, 2000)}`);
      assert.ok(/seat-model-unresolved/.test(prereqMatch[0]), `PREREQ does not name seat-model-unresolved (the codex lines):\n${prereqMatch[0]}`);
      assert.ok(/role-gate-not-pass/.test(prereqMatch[0]), `PREREQ does not name role-gate-not-pass (the documenter line):\n${prereqMatch[0]}`);
      assert.ok(/documenter/.test(prereqMatch[0]), `PREREQ does not mention the documenter seat by name:\n${prereqMatch[0]}`);
    }
  );
}

module.exports = { registerSteps };
