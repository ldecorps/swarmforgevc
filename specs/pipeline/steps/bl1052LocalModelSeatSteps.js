'use strict';

// BL-1052: step handlers for "A role seat can be staffed by a downloaded
// local model".
//
// Everything here drives the REAL artifacts — prompt_engine_lib.bb's
// provider-capabilities map through Babashka, and swarmforge.sh's own
// write_role_launch_script / launch_role through zsh against a throwaway
// fixture root. No step re-implements a capability table or a launch body
// in JS.
//
// Capability reads go through the RAW map, never the normalize-agent-backed
// `capabilities` accessor: an agent with no entry of its own normalizes to
// "claude" and reports claude's shape, so scenario 01 would pass against
// exactly the missing entry it exists to catch.
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

const DEFAULT_LOOPBACK_ENDPOINT = 'http://127.0.0.1:11434/v1';
const KNOWN_MODELS = new Set(['qwen2.5-coder:7b-instruct', 'llama3.1:8b']);
const FIXTURE_KEY_VALUE = 'bl1052-local-credential-must-never-reach-a-file';

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
  'SWARMFORGE_GEMINI_API_KEY',
  'SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS',
  'SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL'
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

function makeFixtureRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1052-local-model-')));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'specifier', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function makeFakeTmux() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1052-tmux-'));
  const tmuxPath = path.join(bin, 'tmux');
  fs.writeFileSync(
    tmuxPath,
    `#!/usr/bin/env bash\necho "$@" >> "$TMUX_LOG"\nexit 0\n`
  );
  fs.chmodSync(tmuxPath, 0o755);
  return bin;
}

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function composeLaunchScript({ role, agent, model, env = {} }) {
  const root = makeFixtureRoot();
  try {
    assert.ok(KNOWN_MODELS.has(model), `unknown model id "${model}"`);
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      `config active_backlog_max_depth -1\nwindow ${role} ${agent} ${role} --model ${model}\n`
    );
    const childEnv = { ...process.env, ...env, SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy' };
    for (const name of PROVIDER_KEYS) {
      if (!(name in env) && name !== 'SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS') {
        delete childEnv[name];
      }
    }
    childEnv.SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS = 'healthy';
    execFileSync(
      'zsh',
      [
        '-f',
        '-c',
        `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role ${role})"`
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
  const FEATURE = 'A role seat can be staffed by a downloaded local model';
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  define(/^the capabilities for agent "([^"]+)" are read$/, (ctx, agent) => {
    ctx.agent = agent;
    ctx.wakeStyle = rawCapability(agent, ':wake-style');
    ctx.bootstrapStyle = rawCapability(agent, ':bootstrap-style');
    assert.notEqual(
      ctx.wakeStyle,
      'ABSENT',
      `agent "${agent}" has no entry of its own in provider-capabilities - it would fall through to the claude default`
    );
  });

  define(/^its wake style is "([^"]+)"$/, (ctx, expected) => {
    assert.equal(ctx.wakeStyle, expected, `expected agent "${ctx.agent}" wake style "${expected}"`);
  });

  define(/^its bootstrap style is "([^"]+)"$/, (ctx, expected) => {
    assert.equal(
      ctx.bootstrapStyle,
      expected,
      `expected agent "${ctx.agent}" bootstrap style "${expected}"`
    );
  });

  define(/^its bootstrap style differs from the shape of agent "([^"]+)"$/, (ctx, other) => {
    const otherStyle = rawCapability(other, ':bootstrap-style');
    assert.notEqual(
      otherStyle,
      'ABSENT',
      `agent "${other}" has no entry of its own - "differs" would compare against the claude default`
    );
    assert.notEqual(
      ctx.bootstrapStyle,
      otherStyle,
      `agents "${ctx.agent}" and "${other}" must not share a bootstrap style`
    );
  });

  define(
    /^a window line staffing role "([^"]+)" with agent "([^"]+)" and model "([^"]+)"$/,
    (ctx, role, agent, model) => {
      assert.ok(KNOWN_MODELS.has(model), `unknown model id "${model}"`);
      ctx.role = role;
      ctx.agent = agent;
      ctx.model = model;
    }
  );

  define(/^the launch command for that window is composed$/, (ctx) => {
    ctx.launchScript = composeLaunchScript({
      role: ctx.role,
      agent: ctx.agent,
      model: ctx.model
    });
  });

  define(/^it targets the local inference endpoint on the loopback interface$/, (ctx) => {
    assert.match(
      ctx.launchScript,
      /127\.0\.0\.1|localhost/,
      'expected the launch body to target a loopback inference endpoint'
    );
  });

  define(/^it selects model "([^"]+)"$/, (ctx, model) => {
    assert.ok(KNOWN_MODELS.has(model), `unknown model id "${model}"`);
    assert.match(
      ctx.launchScript,
      new RegExp(`--model ${model.replace(/\./g, '\\.')}(\\s|$)`, 'm'),
      `expected the launch body to select model ${model}`
    );
  });

  define(/^it enables non-interactive shell execution$/, (ctx) => {
    assert.match(
      ctx.launchScript,
      /(^|\s)-y(\s|$)/m,
      'expected the launch body to pass -y so the agent may execute shell commands unattended'
    );
  });

  define(/^the composed command carries the role's bootstrap prompt$/, (ctx) => {
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
      'a prompt delivered by the launch command must be declared :embedded'
    );
  });

  define(/^a credential for the local endpoint is exported in the launching environment$/, (ctx) => {
    ctx.credentialKey = 'OPENAI_API_KEY';
    ctx.credentialValue = FIXTURE_KEY_VALUE;
  });

  define(/^the launch command for a "([^"]+)" window is composed$/, (ctx, agent) => {
    ctx.agent = agent;
    ctx.role = 'coder';
    ctx.launchScript = composeLaunchScript({
      role: 'coder',
      agent,
      model: 'qwen2.5-coder:7b-instruct',
      env: { [ctx.credentialKey]: ctx.credentialValue }
    });
  });

  define(/^the composed command does not contain the credential value$/, (ctx) => {
    assert.ok(
      !ctx.launchScript.includes(ctx.credentialValue),
      `${ctx.credentialKey}'s VALUE reached .swarmforge/launch/${ctx.role}.sh (BL-130)`
    );
  });

  define(/^the local endpoint health check reports not ready$/, (ctx) => {
    ctx.endpointStatus = 'missing';
    ctx.endpointUrl = DEFAULT_LOOPBACK_ENDPOINT;
  });

  define(/^a "([^"]+)" window is launched$/, (ctx, agent) => {
    const root = makeFixtureRoot();
    const fakeTmux = makeFakeTmux();
    const logPath = path.join(fakeTmux, 'tmux-calls.log');
    try {
      fs.writeFileSync(
        path.join(root, 'swarmforge', 'swarmforge.conf'),
        `config active_backlog_max_depth -1\nwindow coder ${agent} coder --model qwen2.5-coder:7b-instruct\n`
      );
      const childEnv = {
        ...process.env,
        PATH: `${fakeTmux}${path.delimiter}${process.env.PATH || ''}`,
        TMUX_LOG: logPath,
        SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: ctx.endpointStatus || 'missing',
        SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL: ctx.endpointUrl || DEFAULT_LOOPBACK_ENDPOINT
      };
      for (const name of PROVIDER_KEYS) {
        if (
          name !== 'SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS' &&
          name !== 'SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL'
        ) {
          delete childEnv[name];
        }
      }
      let refusal = '';
      let exitCode = 0;
      try {
        execFileSync(
          'zsh',
          [
            '-f',
            '-c',
            `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} choose_cleanup_owner; launch_role "$(index_of_role coder)"`
          ],
          { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
        );
      } catch (err) {
        exitCode = err.status ?? 1;
        refusal = `${err.stdout || ''}${err.stderr || ''}`;
      }
      ctx.launchExitCode = exitCode;
      ctx.launchRefusal = refusal;
      ctx.tmuxLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(fakeTmux, { recursive: true, force: true });
    }
  });

  define(/^the launch is refused$/, (ctx) => {
    assert.notEqual(ctx.launchExitCode, 0, 'expected launch_role to refuse');
    assert.ok(!/\brespawn-pane\b/.test(ctx.tmuxLog), 'refused launch must not respawn a pane');
  });

  define(/^the refusal names the endpoint that was not ready$/, (ctx) => {
    assert.match(
      ctx.launchRefusal,
      /127\.0\.0\.1:11434/,
      `refusal must name the unreachable endpoint, got: ${ctx.launchRefusal}`
    );
  });

  define(/^the new local-model pack file is read$/, (ctx) => {
    const packPath = path.join(PACKS_DIR, 'local-model-mono-router.conf');
    assert.ok(fs.existsSync(packPath), `expected a pack file at ${packPath}`);
    ctx.packName = 'local-model-mono-router.conf';
    ctx.packText = fs.readFileSync(packPath, 'utf8');
  });

  define(/^every role window names agent "([^"]+)"$/, (ctx, agent) => {
    const lines = windowLines(ctx.packText);
    assert.ok(lines.length > 0, `${ctx.packName} declares no window lines at all`);
    for (const line of lines) {
      const declared = line.split(/\s+/)[2];
      assert.equal(declared, agent, `${ctx.packName} window line "${line}" must staff ${agent}`);
    }
  });

  define(/^it requires no cloud provider API key$/, (ctx) => {
    assert.doesNotMatch(
      ctx.packText,
      /OPENAI_API_KEY|ANTHROPIC|MISTRAL_API_KEY|QWEN_API_KEY|BAILIAN|GEMINI_API_KEY|CURSOR_API_KEY/i,
      `${ctx.packName} must not require a cloud provider API key`
    );
  });

  define(/^the pack file "([^"]+)" is read$/, (ctx, name) => {
    const packPath = path.join(PACKS_DIR, name);
    assert.ok(fs.existsSync(packPath), `expected a pack file at ${packPath}`);
    ctx.packName = name;
    ctx.packText = fs.readFileSync(packPath, 'utf8');
  });

  define(/^it still names agent "([^"]+)" for every role window$/, (ctx, agent) => {
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
