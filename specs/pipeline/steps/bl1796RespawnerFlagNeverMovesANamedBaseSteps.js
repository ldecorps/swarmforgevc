'use strict';

// BL-1796: step handlers for "A respawner's own provider flag never moves
// a seat off the base it names". Drives the REAL write_role_launch_script
// generator through zsh and the REAL provider-respawn-env-args, against
// throwaway fixture roots - the exact same generator invocation shape
// BL-1793's own review handler uses, never a reimplementation of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1796 A respawner's own provider flag never moves a seat off the base it names";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const RESPAWN_ENV_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_respawn_env_lib.bb');

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough.
const KNOWN_SEAT_WINDOW_LINES = {
  'local Ollama aider':
    'window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore',
  'local-model': 'window coder local-model coder --model ista-iq3s-coder:latest',
  Claude: 'window coder claude coder',
};

const KNOWN_HOST_FLAGS = {
  'https://api.cerebras.ai/v1': 'SWARMFORGE_USE_CEREBRAS',
  'https://api.perplexity.ai': 'SWARMFORGE_USE_PERPLEXITY',
  'https://api.b.ai/v1': 'SWARMFORGE_USE_BAI',
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1': 'SWARMFORGE_USE_QWEN',
};

const KNOWN_FLAGS = new Set([
  'SWARMFORGE_USE_CEREBRAS',
  'SWARMFORGE_USE_PERPLEXITY',
  'SWARMFORGE_USE_QWEN',
  'SWARMFORGE_USE_BAI',
]);

// Same BL-1702 staffing-gate workaround BL-1793's own handler carries.
let _probeEvidenceDir;
function probeEvidenceDir() {
  if (!_probeEvidenceDir) {
    _probeEvidenceDir = trackedTmpRoot('bl1796-probe-evidence-');
    fs.writeFileSync(
      path.join(_probeEvidenceDir, 'local-coder-probe-qwen2.5-coder-latest-2026-09-27T00-00-00Z.md'),
      '# local coder probe: qwen2.5-coder:latest\n\nhanded off 5 of 5 - verdict pass\n'
    );
  }
  return _probeEvidenceDir;
}

// BL-971: a short fixture root (trackedTmpRoot roots at /tmp) so the
// generator's own tmux-socket-path length refusal (over 100 chars) never
// fires; removed by this file's own onAbnormalExit sweep.
function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1796-launch-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'QA', 'coordinator', 'specifier']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function generateLaunchScript(windowLine) {
  const root = mkFixtureRoot();
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `${windowLine}\n`);
  execFileSync(
    'zsh',
    ['-f', '-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role coder)"`],
    {
      encoding: 'utf8',
      env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1', LOCAL_CODER_PROBE_EVIDENCE_DIR: probeEvidenceDir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return root;
}

// Fake keys only, no network, no real provider key (ticket constraint) -
// every cloud provider has a key, so ONLY the launch-cli/flag interaction
// decides the outcome, never a missing-key branch.
function respawnerEnv(flag) {
  const env = {
    PATH: process.env.PATH,
    CEREBRAS_API_KEY: 'csk-x',
    PERPLEXITY_API_KEY: 'pplx-x',
    QWEN_API_KEY: 'sk-sp-x',
    B_AI_API_KEY: 'bai-x',
  };
  if (flag) {
    env[flag] = '1';
  }
  return env;
}

function respawnEnvArgs(root, role, flag) {
  const stateDir = path.join(root, '.swarmforge');
  const script = `(require '[cheshire.core :as json]) (load-file "${RESPAWN_ENV_LIB}") (println (json/generate-string (provider-respawn-env-lib/provider-respawn-env-args "${stateDir}" "${role}")))`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8', env: respawnerEnv(flag) });
  return JSON.parse(out.trim());
}

function hasFlag(args, flag) {
  return args.includes(`${flag}=1`);
}

function hasAnyUseFlag(args) {
  return args.some((a) => a.startsWith('SWARMFORGE_USE_'));
}

function hasAnyOpenAiBase(args) {
  return args.some((a) => a.startsWith('OPENAI_API_BASE=') || a.startsWith('OPENAI_BASE_URL='));
}

function hasBase(args, host) {
  return args.includes(`OPENAI_API_BASE=${host}`) && args.includes(`OPENAI_BASE_URL=${host}`);
}

function ensure(ctx) {
  if (!ctx.bl1796) {
    ctx.bl1796 = {};
  }
  return ctx.bl1796;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the respawning process holds a key for every cloud provider$/, () => {
    // Documentation only - respawnerEnv() above always builds exactly this
    // shape; the per-scenario flag is layered on in "sets ... to 1" below.
  });

  scoped(/^a launch script generated for a "([^"]+)" window line$/, (ctx, seat) => {
    const windowLine = KNOWN_SEAT_WINDOW_LINES[seat];
    assert.ok(windowLine, `unknown seat "${seat}" - known: ${Object.keys(KNOWN_SEAT_WINDOW_LINES).join(' | ')}`);
    const st = ensure(ctx);
    st.root = generateLaunchScript(windowLine);
    st.role = 'coder';
  });

  scoped(/^a launch script generated for an aider window line whose OpenAI base is "([^"]+)"$/, (ctx, host) => {
    assert.ok(KNOWN_HOST_FLAGS[host], `unknown host "${host}" - known: ${Object.keys(KNOWN_HOST_FLAGS).join(' | ')}`);
    const windowLine = `window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base ${host} --no-gitignore`;
    const st = ensure(ctx);
    st.root = generateLaunchScript(windowLine);
    st.role = 'coder';
    st.host = host;
  });

  scoped(/^the respawning process sets "([^"]+)" to 1$/, (ctx, flag) => {
    assert.ok(KNOWN_FLAGS.has(flag), `unknown flag "${flag}" - known: ${[...KNOWN_FLAGS].join(' | ')}`);
    ensure(ctx).flag = flag;
  });

  scoped(/^the respawn environment for that seat is computed$/, (ctx) => {
    const st = ensure(ctx);
    st.args = respawnEnvArgs(st.root, st.role, st.flag);
  });

  scoped(/^it sets no SWARMFORGE_USE flag and no OpenAI base$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(!hasAnyUseFlag(st.args), `expected no SWARMFORGE_USE_* flag, got: ${JSON.stringify(st.args)}`);
    assert.ok(!hasAnyOpenAiBase(st.args), `expected no OPENAI_API_BASE/OPENAI_BASE_URL, got: ${JSON.stringify(st.args)}`);
  });

  scoped(/^the seat is remapped to "([^"]+)" under the "([^"]+)" flag$/, (ctx, host, flag) => {
    const st = ensure(ctx);
    assert.equal(flag, KNOWN_HOST_FLAGS[host], `unknown (host, flag) pair - known hosts: ${Object.keys(KNOWN_HOST_FLAGS).join(' | ')}`);
    assert.ok(hasFlag(st.args, flag), `expected ${flag}=1 among the respawn args, got: ${JSON.stringify(st.args)}`);
    assert.ok(hasBase(st.args, host), `expected OPENAI_API_BASE and OPENAI_BASE_URL both set to ${host}, got: ${JSON.stringify(st.args)}`);
  });

  scoped(/^it sets no "([^"]+)" flag$/, (ctx, flag) => {
    const st = ensure(ctx);
    assert.ok(KNOWN_FLAGS.has(flag), `unknown flag "${flag}" - known: ${[...KNOWN_FLAGS].join(' | ')}`);
    assert.ok(!hasFlag(st.args, flag), `expected no ${flag}=1, got: ${JSON.stringify(st.args)}`);
  });
}

module.exports = { registerSteps };
