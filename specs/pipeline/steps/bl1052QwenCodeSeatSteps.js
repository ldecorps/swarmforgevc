'use strict';

// BL-1052: step handlers for "A role seat can be staffed by qwen-code".
//
// Everything here drives the REAL artifacts - prompt_engine_lib.bb's
// provider-capabilities map through Babashka, and swarmforge.sh's own
// write_role_launch_script through zsh against a throwaway fixture root. No
// step re-implements a capability table or a launch body in JS; a handler
// that did would keep passing after the production code it describes was
// deleted.
//
// The capability reads go through the RAW map, never the normalize-agent-
// backed `capabilities` accessor: an agent with no entry of its own
// normalizes to "claude" and reports claude's chat-message/embedded shape, so
// scenario 01 would pass against exactly the missing entry it exists to
// catch. That fall-through is what the ticket's required_wiring calls out.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PACKS_DIR = path.join(REPO_ROOT, 'swarmforge', 'packs');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const PROMPT_ENGINE_LIB = path.join(SCRIPTS_DIR, 'prompt_engine_lib.bb');

const TOKEN_PLAN_ENDPOINT =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';

// BL-421 Scenario Outline rule: every Examples: column value is validated
// against an explicit lookup, never passed through - a gherkin-mutator edit
// into an unrecognised value must fail the scenario, not slip into an else
// branch. These are the two names swarmforge.sh's qwen guard actually reads,
// in its own precedence order.
const KNOWN_CREDENTIAL_KEYS = new Set(['QWEN_API_KEY', 'BAILIAN_CODING_PLAN_API_KEY']);

// A value no real key could collide with, so "the composed command does not
// contain the credential value" is a statement about the launch script and
// not about how unusual the fixture's key happens to look.
const FIXTURE_KEY_VALUE = 'bl1052-credential-must-never-reach-a-file';

// Every provider key the launcher can forward, cleared from the fixture
// environment so a real one inherited from this host cannot stand in for the
// one the scenario exported (~/.zshenv re-exports live keys on this host).
const PROVIDER_KEYS = [
  'QWEN_API_KEY',
  'BAILIAN_CODING_PLAN_API_KEY',
  'BAILIAN_TOKEN_PLAN_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'MISTRAL_API_KEY',
  'CEREBRAS_API_KEY',
  'PERPLEXITY_API_KEY',
  'GEMINI_API_KEY',
  'SWARMFORGE_GEMINI_API_KEY'
];

function rawCapability(agent, key) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${PROMPT_ENGINE_LIB}")
       (if-let [caps (get prompt-engine-lib/provider-capabilities "${agent}")]
         (println (name (get caps ${key})))
         (println "ABSENT"))`
    ],
    { encoding: 'utf8' }
  );
  return out.trim();
}

// The fixture root is removed in a finally by the caller (BL-971): a throw
// between mkdtemp and the assertion must not leak it.
function makeFixtureRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1052-qwen-code-')));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'specifier', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

// Runs the launcher's OWN write_role_launch_script against a fixture conf and
// returns the generated script's text. Sourced, never executed (BL-089): no
// tmux server, no agent process, no network.
function composeLaunchScript({ role, agent, model, env = {} }) {
  const root = makeFixtureRoot();
  try {
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      `config active_backlog_max_depth -1\nwindow ${role} ${agent} ${role} --model ${model}\n`
    );
    const indexOfRole = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;
    const childEnv = { ...process.env, ...env };
    for (const name of PROVIDER_KEYS) {
      if (!(name in env)) {
        delete childEnv[name];
      }
    }
    execFileSync(
      'zsh',
      [
        '-f',
        '-c',
        `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${indexOfRole} write_role_launch_script "$(index_of_role ${role})"`
      ],
      { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return fs.readFileSync(path.join(root, '.swarmforge', 'launch', `${role}.sh`), 'utf8');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function windowLines(packText) {
  return packText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('window '));
}

function registerSteps(registry) {
  // ── qwen-code-seat-01 / 02 ──────────────────────────────────────────────
  registry.define(/^the capabilities for agent "([^"]+)" are read$/, (ctx, agent) => {
    ctx.agent = agent;
    ctx.wakeStyle = rawCapability(agent, ':wake-style');
    ctx.bootstrapStyle = rawCapability(agent, ':bootstrap-style');
    assert.notEqual(
      ctx.wakeStyle,
      'ABSENT',
      `agent "${agent}" has no entry of its own in provider-capabilities - it would fall through to the claude default`
    );
  });

  registry.define(/^its wake style is "([^"]+)"$/, (ctx, expected) => {
    assert.equal(ctx.wakeStyle, expected, `expected agent "${ctx.agent}" wake style "${expected}"`);
  });

  registry.define(/^its bootstrap style is "([^"]+)"$/, (ctx, expected) => {
    assert.equal(
      ctx.bootstrapStyle,
      expected,
      `expected agent "${ctx.agent}" bootstrap style "${expected}"`
    );
  });

  registry.define(/^its bootstrap style differs from the shape of agent "([^"]+)"$/, (ctx, other) => {
    const otherStyle = rawCapability(other, ':bootstrap-style');
    assert.notEqual(
      otherStyle,
      'ABSENT',
      `agent "${other}" has no entry of its own - "differs" would compare against the claude default`
    );
    assert.notEqual(
      ctx.bootstrapStyle,
      otherStyle,
      `agents "${ctx.agent}" and "${other}" must not share a bootstrap style - one can execute a shell command and the other cannot`
    );
  });

  // ── qwen-code-seat-03 / 04 ──────────────────────────────────────────────
  registry.define(
    /^a window line staffing role "([^"]+)" with agent "([^"]+)" and model "([^"]+)"$/,
    (ctx, role, agent, model) => {
      ctx.role = role;
      ctx.agent = agent;
      ctx.model = model;
    }
  );

  registry.define(/^the launch command for that window is composed$/, (ctx) => {
    ctx.launchScript = composeLaunchScript({
      role: ctx.role,
      agent: ctx.agent,
      model: ctx.model
    });
  });

  registry.define(/^it invokes "([^"]+)" with auth type "([^"]+)"$/, (ctx, binary, authType) => {
    assert.match(
      ctx.launchScript,
      new RegExp(`(^|\\s)${binary}\\s`, 'm'),
      `expected the launch body to invoke ${binary}`
    );
    assert.match(
      ctx.launchScript,
      new RegExp(`--auth-type ${authType}(\\s|$)`, 'm'),
      `expected the launch body to select --auth-type ${authType}`
    );
  });

  registry.define(/^it selects model "([^"]+)"$/, (ctx, model) => {
    assert.match(
      ctx.launchScript,
      new RegExp(`--model ${model.replace(/\./g, '\\.')}(\\s|$)`, 'm'),
      `expected the launch body to select model ${model}`
    );
  });

  registry.define(/^it enables non-interactive shell execution$/, (ctx) => {
    // -y is the whole reason this seat works: the operator's smoke test
    // showed the CLI EXECUTE a shell command with it, and refuse without it.
    assert.match(
      ctx.launchScript,
      /(^|\s)-y(\s|$)/m,
      'expected the launch body to pass -y so the agent may execute shell commands unattended'
    );
  });

  registry.define(/^the composed command carries the role's bootstrap prompt$/, (ctx) => {
    // Delivered at launch, in the agent's own first message - not pasted in
    // afterwards by a bootstrap step. By PATH rather than slurped content:
    // a composed role artifact runs past MAX_ARG_STRLEN (hardender's is
    // ~155KB against a 128KiB per-argument cap), so an embedded $(cat ...)
    // would hard-fail the largest roles.
    const promptPath = `/.swarmforge/prompts/${ctx.role}.md`;
    assert.ok(
      ctx.launchScript.includes(promptPath),
      `expected the launch command to name the role's bootstrap prompt ${promptPath}`
    );
    assert.match(
      ctx.launchScript,
      /obey every instruction in/,
      "expected the launch command to direct the agent at its bootstrap prompt in its first message"
    );
    assert.equal(
      rawCapability(ctx.agent, ':bootstrap-style'),
      'embedded',
      'a prompt delivered by the launch command must be declared :embedded, or a bootstrap step would paste it a second time'
    );
  });

  // ── qwen-code-seat-05 ───────────────────────────────────────────────────
  registry.define(/^"([^"]+)" is exported in the launching environment$/, (ctx, key) => {
    assert.ok(
      KNOWN_CREDENTIAL_KEYS.has(key),
      `unknown credential variable "${key}" - the qwen guard reads only ${[...KNOWN_CREDENTIAL_KEYS].join(', ')}`
    );
    ctx.credentialKey = key;
    ctx.credentialValue = FIXTURE_KEY_VALUE;
  });

  registry.define(/^the launch command for a "([^"]+)" window is composed$/, (ctx, agent) => {
    ctx.agent = agent;
    ctx.role = 'coder';
    ctx.launchScript = composeLaunchScript({
      role: 'coder',
      agent,
      model: 'qwen3.7-plus',
      env: { [ctx.credentialKey]: ctx.credentialValue }
    });
  });

  registry.define(/^the composed command does not contain the credential value$/, (ctx) => {
    assert.ok(
      !ctx.launchScript.includes(ctx.credentialValue),
      `${ctx.credentialKey}'s VALUE reached .swarmforge/launch/${ctx.role}.sh - a file under the target working directory (BL-130)`
    );
  });

  registry.define(/^the pane receives the OpenAI-compatible endpoint for the Token Plan$/, (ctx) => {
    // Forced, not defaulted. The opt-in guard branch carries the same host
    // inside a "${OPENAI_BASE_URL:-...}" fallback, so asserting on the host
    // alone would pass while ~/.zshenv's own re-export still won at runtime.
    assert.ok(
      ctx.launchScript.includes(`export OPENAI_BASE_URL=${TOKEN_PLAN_ENDPOINT}`),
      'expected the pane to be pointed unconditionally at the Token Plan OpenAI-compat endpoint'
    );
    assert.ok(
      ctx.launchScript.includes(`export OPENAI_API_BASE=${TOKEN_PLAN_ENDPOINT}`),
      'expected OPENAI_API_BASE to be forced to the Token Plan endpoint too'
    );
  });

  // ── qwen-code-seat-06 / 07 ──────────────────────────────────────────────
  registry.define(/^the pack file "([^"]+)" is read$/, (ctx, name) => {
    const packPath = path.join(PACKS_DIR, name);
    assert.ok(fs.existsSync(packPath), `expected a pack file at ${packPath}`);
    ctx.packName = name;
    ctx.packText = fs.readFileSync(packPath, 'utf8');
  });

  registry.define(
    /^it warns that a headless swarm may risk key revocation on a Personal plan$/,
    (ctx) => {
      // One line, deliberately: wrapped across two, the warning stops being
      // greppable and a reader can carry away half of it.
      const warning = ctx.packText
        .split('\n')
        .find((l) => /headless swarm may risk key revocation/.test(l));
      assert.ok(
        warning,
        `${ctx.packName} does not carry the terms-of-service caution on a single readable line`
      );
      assert.match(
        warning,
        /Personal/,
        `${ctx.packName}'s caution must name the Personal plan it applies to`
      );
    }
  );

  registry.define(/^it still names agent "([^"]+)" for every role window$/, (ctx, agent) => {
    const lines = windowLines(ctx.packText);
    assert.ok(lines.length > 0, `${ctx.packName} declares no window lines at all`);
    for (const line of lines) {
      const declared = line.split(/\s+/)[2];
      assert.equal(
        declared,
        agent,
        `${ctx.packName} must be left alone: window line "${line}" no longer staffs ${agent}`
      );
    }
  });
}

module.exports = { registerSteps };
