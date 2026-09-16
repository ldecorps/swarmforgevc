'use strict';

// BL-1511: step handlers for "the BoB mono-router pack seats a specifier
// again". Scenarios 01/03 drive the REAL launcher's parse_config against
// the REAL pack file (test_alternate_runtime_launch.sh's own "source,
// parse_config, index_of_role" shape) - never a reimplementation of the
// pack-line grammar or the staffing gate's decision. Scenario 02 drives the
// REAL pack_staffing_gate_cli.bb, the same CLI the qa_e2e_procedure names.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1511 The BoB mono-router pack seats a specifier again';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const STAFFING_GATE_CLI = path.join(SCRIPTS_DIR, 'pack_staffing_gate_cli.bb');
const TICKET_YAML = path.join(
  REPO_ROOT,
  'backlog',
  'active',
  'BL-1511-the-bob-pack-seats-a-specifier-again.yaml'
);

const PACK_NAME = 'bob-multi-provider-mono-router';
const PACK_PATH = path.join(SCRIPTS_DIR, '..', 'packs', `${PACK_NAME}.conf`);

// Every role this pack's window lines declare, in the current on-disk pack
// (parse_config requires a role prompt file for each window role it sees -
// a placeholder, same as test_alternate_runtime_launch.sh's own mk_root).
const PACK_ROLES = ['coder', 'specifier', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function readTicketRuling() {
  const text = fs.readFileSync(TICKET_YAML, 'utf8');
  const match = text.match(/on (\S+) via the (\S+) agent/);
  assert.ok(match, `ticket YAML's human_ruling did not match the expected "on <model> via the <agent> agent" shape:\n${text}`);
  return { model: match[1], agent: match[2] };
}

function seedFixtureRoot() {
  const root = mkSocketFixtureRoot('bl1511-acceptance-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of PACK_ROLES) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

// Sources the REAL swarmforge.sh against a scratch root, points its
// CONFIG_FILE at the REAL pack file (SWARMFORGE_CONFIG override - the
// exact file this ticket edits, never a copy), runs parse_config, and
// prints one line per role: "<role>\t<agent>\t<extra_cli>". extra_cli is
// where --model lives (register_role's own EXTRA_CLI_ARGS array) - the
// launcher stores no separate "model" field.
//
// Scenario 01 is a STRUCTURAL check only (does the pack declare a
// specifier window on the ruled agent/model) - it is not testing the
// staffing gate's verdict (scenario 02 owns that, against a fixture
// steward state, since .swarmforge/ is gitignored/per-worktree/stale -
// backlog/evidence/BL-1511-coder-spec-gap-20260916.md). parse_config
// invokes pack_staffing_gate inline per window line regardless, so this
// runs it exactly as the pack's own LAUNCH line does - with
// PACK_STAFFING_SKIP_GATE=1 - rather than unsetting it (BL-1485's lesson
// applies to scenario 02's real verdict check, not to this one).
function runParseConfig() {
  const root = seedFixtureRoot();
  try {
    const script = `
source '${SWARMFORGE_SH}' '${root}'
parse_config
for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
  printf '%s\\t%s\\t%s\\n' "\${ROLES[$i]}" "\${AGENTS[$i]}" "\${EXTRA_CLI_ARGS[$i]}"
done
`;
    const env = { ...process.env, PACK_STAFFING_SKIP_GATE: '1', SWARMFORGE_CONFIG: PACK_PATH };
    const out = execFileSync('zsh', ['-c', script], { env, encoding: 'utf8' });
    return out;
  } finally {
    releaseSocketFixtureRoot(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function parseRoleRows(output) {
  return output
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [role, agent, extraCli] = l.split('\t');
      return { role, agent, extraCli: extraCli || '' };
    });
}

function modelFromExtraCli(extraCli) {
  const m = extraCli.match(/--model (\S+)/);
  return m ? m[1] : null;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: the pack declares a specifier window on the ruled model ──
  scoped(/^the pack is parsed$/, (ctx) => {
    ctx.bl1511rows = parseRoleRows(runParseConfig());
  });

  scoped(/^it has exactly one specifier window line$/, (ctx) => {
    const specifierRows = ctx.bl1511rows.filter((r) => r.role === 'specifier');
    assert.equal(
      specifierRows.length,
      1,
      `expected exactly one specifier row, got ${specifierRows.length}: ${JSON.stringify(ctx.bl1511rows)}`
    );
    ctx.bl1511specifierRow = specifierRows[0];
  });

  scoped(/^that line pins the agent and model the ticket's human ruling names$/, (ctx) => {
    const ruling = readTicketRuling();
    const row = ctx.bl1511specifierRow;
    assert.equal(row.agent, ruling.agent, `specifier window agent "${row.agent}" does not match the ticket's ruled agent "${ruling.agent}"`);
    const model = modelFromExtraCli(row.extraCli);
    assert.equal(model, ruling.model, `specifier window model "${model}" does not match the ticket's ruled model "${ruling.model}" (extra_cli: ${row.extraCli})`);
  });

  // ── Scenario 02 (amended 2026-09-16): the gate decides on steward evidence ──
  // Never reads live steward state (.swarmforge/ is gitignored, per-worktree,
  // and stale in every worktree - see backlog/evidence/BL-1511-coder-spec-
  // gap-20260916.md); builds a scratch .swarmforge/model-steward/ instead.

  const WORKER_ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

  function gateCompetency(role) {
    return role === 'hardender' ? 'hardener-gate' : `${role}-gate`;
  }

  const SPECIFIER_EVIDENCE = {
    'ranks the ruled specifier model on specifier with its role gate recorded pass': true,
    'carries no entry for the ruled specifier model': false,
  };

  // Builds .swarmforge/model-steward/{registry.json,scorecards/*.json} for
  // the worker model (every worker role ranked, every role's gate pass) and,
  // when includeSpecifier is true, the ruled specifier model ranked on
  // specifier with its own gate pass - the sensitivity row omits it so the
  // specifier line has nothing to resolve against (not-on-role-matrix).
  function buildStewardFixture(root, includeSpecifier) {
    const stateDir = path.join(root, '.swarmforge', 'model-steward');
    fs.mkdirSync(path.join(stateDir, 'scorecards'), { recursive: true });
    const roleMatrix = {};
    const models = {
      'tencentcloud2/glm-5.3-flash': { status: 'certified', provider: 'tencentcloud2', model: 'glm-5.3-flash' },
    };
    for (const role of WORKER_ROLES) {
      roleMatrix[role] = [{ provider: 'tencentcloud2', model: 'glm-5.3-flash', score: 0.9, evidence: 'fixture' }];
    }
    if (includeSpecifier) {
      const ruling = readTicketRuling();
      const provider = ruling.agent === 'claude' ? 'anthropic' : ruling.agent;
      roleMatrix.specifier = [{ provider, model: ruling.model, score: 1.0, evidence: 'fixture' }];
      models[`${provider}/${ruling.model}`] = { status: 'certified', provider, model: ruling.model };
      fs.writeFileSync(
        path.join(stateDir, 'scorecards', `${provider}__${ruling.model}.json`),
        JSON.stringify({ entries: [{ competency: 'specifier-gate', status: 'pass' }] })
      );
    }
    fs.writeFileSync(path.join(stateDir, 'registry.json'), JSON.stringify({ models, role_matrix: roleMatrix }));
    fs.writeFileSync(
      path.join(stateDir, 'scorecards', 'tencentcloud2__glm-5.3-flash.json'),
      JSON.stringify({ entries: WORKER_ROLES.map((role) => ({ competency: gateCompetency(role), status: 'pass' })) })
    );
  }

  // The qa_e2e_procedure's own awk field rule, replicated exactly (never a
  // different parse): $1=window $2=role $3=agent $4=worktree, then skip an
  // optional task|batch, an optional forward-only|back-one|back-all, and an
  // optional idle-clear; everything remaining is extra-cli.
  function deriveWindowsFile(packText) {
    const rows = packText
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
        return { role, line: `${role}\t${role}\t${agent}\t${extra}` };
      });
    return rows;
  }

  scoped(/^a scratch root whose steward registry ranks the pack's worker model on every worker role with each role gate recorded pass and (.+)$/, (ctx, specifierEvidence) => {
    const includeSpecifier = SPECIFIER_EVIDENCE[specifierEvidence];
    assert.ok(includeSpecifier !== undefined, `unknown specifier-evidence example value: "${specifierEvidence}"`);
    const root = mkSocketFixtureRoot('bl1511-gate-');
    ctx.bl1511gateRoot = root;
    buildStewardFixture(root, includeSpecifier);
    ctx.bl1511includesSpecifier = includeSpecifier;
  });

  scoped(/^PACK_STAFFING_SKIP_GATE is unset$/, () => {
    // Asserted by the run step's own env, not a separate state mutation -
    // this step exists so the scenario reads naturally (Given/When/Then).
  });

  scoped(/^the pack staffing gate runs on the windows-file derived from the pack by the launcher's field rules$/, (ctx) => {
    const packText = fs.readFileSync(PACK_PATH, 'utf8');
    const rows = deriveWindowsFile(packText);
    ctx.bl1511windowsRows = rows;
    const windowsFile = path.join(ctx.bl1511gateRoot, 'windows.tsv');
    fs.writeFileSync(windowsFile, rows.map((r) => r.line).join('\n') + '\n');
    const env = { ...process.env };
    delete env.PACK_STAFFING_SKIP_GATE;
    const result = execFileSync('bb', [STAFFING_GATE_CLI, ctx.bl1511gateRoot, windowsFile], { env, encoding: 'utf8' });
    ctx.bl1511gateOutput = result
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        const [seatId, decision, provider, model, failingCheck] = l.split('\t');
        return { seatId, decision, provider, model, failingCheck };
      });
    try {
      releaseSocketFixtureRoot(ctx.bl1511gateRoot);
      fs.rmSync(ctx.bl1511gateRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup, never masks the assertions below
    }
  });

  scoped(/^the derived windows-file holds exactly 7 window lines, the specifier line among them$/, (ctx) => {
    assert.equal(ctx.bl1511windowsRows.length, 7, `expected 7 window lines, got ${ctx.bl1511windowsRows.length}: ${JSON.stringify(ctx.bl1511windowsRows)}`);
    assert.ok(ctx.bl1511windowsRows.some((r) => r.role === 'specifier'), `no specifier row in the derived windows-file: ${JSON.stringify(ctx.bl1511windowsRows)}`);
  });

  const GATE_VERDICTS = {
    'every window line reads pass': (ctx) => {
      for (const row of ctx.bl1511gateOutput) {
        assert.equal(row.decision, 'pass', `seat "${row.seatId}" did not read pass: ${JSON.stringify(row)}`);
      }
    },
    'every worker line reads pass and the specifier line refuses not-on-role-matrix': (ctx) => {
      for (const row of ctx.bl1511gateOutput) {
        if (row.seatId === 'specifier') {
          assert.equal(row.decision, 'refuse', `specifier line did not refuse: ${JSON.stringify(row)}`);
          assert.equal(row.failingCheck, 'not-on-role-matrix', `specifier line refused for the wrong check: ${JSON.stringify(row)}`);
        } else {
          assert.equal(row.decision, 'pass', `worker seat "${row.seatId}" did not read pass: ${JSON.stringify(row)}`);
        }
      }
    },
  };

  scoped(/^(every window line reads pass|every worker line reads pass and the specifier line refuses not-on-role-matrix)$/, (ctx, verdicts) => {
    const check = GATE_VERDICTS[verdicts];
    assert.ok(check, `unknown verdicts example value: "${verdicts}"`);
    check(ctx);
  });

  // ── Scenario 03: the header matches the window lines ─────────────────────
  scoped(/^the pack header is read$/, (ctx) => {
    ctx.bl1511headerText = fs.readFileSync(PACK_PATH, 'utf8');
  });

  scoped(/^its role table names a specifier row with the same agent and model as the window line$/, (ctx) => {
    const text = ctx.bl1511headerText;
    const headerMatch = text.match(/#\s+specifier\s+→\s*(\S+)\s*→\s*(\S+)/);
    assert.ok(headerMatch, `header role table has no parseable specifier row:\n${text.slice(0, 2000)}`);
    const [, headerAgent, headerModel] = headerMatch;

    const windowMatch = text.match(/^window specifier\s+(\S+)\s+\S+\s+--model (\S+)/m);
    assert.ok(windowMatch, `no window specifier line found in the pack file:\n${text.slice(0, 2000)}`);
    const [, windowAgent, windowModel] = windowMatch;

    assert.equal(headerAgent, windowAgent, `header role table names agent "${headerAgent}", window line names "${windowAgent}"`);
    assert.equal(headerModel, windowModel, `header role table names model "${headerModel}", window line names "${windowModel}"`);
  });

  scoped(/^it no longer says the specifier is absent or that nothing can rotate there$/, (ctx) => {
    const text = ctx.bl1511headerText;
    assert.ok(!/deliberately ABSENT/i.test(text), 'header still says the specifier is deliberately ABSENT');
    assert.ok(!/nothing can rotate/i.test(text), 'header still says nothing can rotate on this pack');
  });

  scoped(/^its LAUNCH line carries PACK_STAFFING_SKIP_GATE=1 and its PREREQ names role-gate-not-pass and the compliance battery steward command that clears it$/, (ctx) => {
    const text = ctx.bl1511headerText;
    const launchMatch = text.match(/# LAUNCH:\n(?:#.*\n)*/);
    assert.ok(launchMatch, `no LAUNCH block found in the header:\n${text.slice(0, 2000)}`);
    assert.ok(
      /PACK_STAFFING_SKIP_GATE=1/.test(launchMatch[0]),
      `LAUNCH block does not carry PACK_STAFFING_SKIP_GATE=1:\n${launchMatch[0]}`
    );

    const prereqMatch = text.match(/# PREREQ[^\n]*\n(?:#.*\n)*/);
    assert.ok(prereqMatch, `no PREREQ block found in the header:\n${text.slice(0, 2000)}`);
    assert.ok(
      /role-gate-not-pass/.test(prereqMatch[0]),
      `PREREQ block does not name role-gate-not-pass:\n${prereqMatch[0]}`
    );
    assert.ok(
      /compliance_battery\.bb gate/.test(prereqMatch[0]),
      `PREREQ block does not name the compliance_battery.bb gate steward command:\n${prereqMatch[0]}`
    );
  });
}

module.exports = { registerSteps };
