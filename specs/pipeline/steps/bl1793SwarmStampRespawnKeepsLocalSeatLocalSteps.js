'use strict';

// BL-1793: step handlers for the review-only stamp of hotfix cb8d502fec
// (BL-848). Both scenarios drive the REAL write_role_launch_script
// generator through zsh, and the REAL provider-respawn-env-args, against
// throwaway fixture roots - the exact same generator invocation shape
// test_aider_seat_launch_config.sh and bl1708SwarmStampAiderContextWindowSteps.js
// already use, never a reimplementation of either. This is a REVIEW
// ticket: nothing here edits provider_compat_lib.bb, provider_respawn_env_lib.bb
// or swarmforge.sh (the ticket's own FIRM invariant).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1793 swarm stamp - a respawn keeps a local seat local (hotfix cb8d502fec)';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const RESPAWN_ENV_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'provider_respawn_env_lib.bb');

// Same index_of_role snippet test_aider_seat_launch_config.sh and
// bl1708SwarmStampAiderContextWindowSteps.js already use to resolve a
// write_role_launch_script call's positional ROLES index.
const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

// Explicit known values per the Scenario Outline handler rule - a mutated
// Examples cell must fail loudly, naming itself, never silently resolve
// through a passthrough.
const KNOWN_SEAT_WINDOW_LINES = {
  'local Ollama aider':
    'window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore',
  Claude: 'window coder claude coder',
};

const KNOWN_HOST_FLAGS = {
  'https://api.cerebras.ai/v1': 'SWARMFORGE_USE_CEREBRAS',
  'https://api.perplexity.ai': 'SWARMFORGE_USE_PERPLEXITY',
  'https://api.b.ai/v1': 'SWARMFORGE_USE_BAI',
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1': 'SWARMFORGE_USE_QWEN',
};

// BL-1702's own gate (wired into parse_config after BL-1708 minted this
// same workaround) refuses any pack whose "coder" seat is a driver (aider)
// seat with no passing steward probe summary for its model - same fixture
// evidence dir BL-1708's own handler carries, reused verbatim rather than
// re-derived, so this ticket's fixture is unaffected by that unrelated,
// newer gate.
let _probeEvidenceDir;
function probeEvidenceDir() {
  if (!_probeEvidenceDir) {
    _probeEvidenceDir = trackedTmpRoot('bl1793-probe-evidence-');
    fs.writeFileSync(
      path.join(_probeEvidenceDir, 'local-coder-probe-qwen2.5-coder-latest-2026-09-27T00-00-00Z.md'),
      '# local coder probe: qwen2.5-coder:latest\n\nhanded off 5 of 5 - verdict pass\n'
    );
  }
  return _probeEvidenceDir;
}

// BL-971: the fixture root is short (mkdtempSync(os.tmpdir())) so the
// generator's own tmux-socket-path length refusal (over 100 chars) never
// fires - trackedTmpRoot already roots at the short /tmp base for exactly
// this reason - and is removed in this file's own onAbnormalExit sweep.
function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1793-launch-');
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

// The respawning process's own env, built EXPLICITLY rather than inherited
// (the ticket's own instruction) - fake keys only, no SWARMFORGE_USE_* -
// the Background's "holds a key for every cloud provider and sets no
// SWARMFORGE_USE flag".
function respawnerEnv() {
  return {
    PATH: process.env.PATH,
    CEREBRAS_API_KEY: 'csk-x',
    PERPLEXITY_API_KEY: 'pplx-x',
    QWEN_API_KEY: 'sk-sp-x',
    B_AI_API_KEY: 'bai-x',
  };
}

function respawnEnvArgs(root, role) {
  const stateDir = path.join(root, '.swarmforge');
  const script = `(require '[cheshire.core :as json]) (load-file "${RESPAWN_ENV_LIB}") (println (json/generate-string (provider-respawn-env-lib/provider-respawn-env-args "${stateDir}" "${role}")))`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8', env: respawnerEnv() });
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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^the respawning process holds a key for every cloud provider and sets no SWARMFORGE_USE flag$/, () => {
    // Documentation only - respawnerEnv() above always builds exactly this
    // shape; no per-scenario state to record.
  });

  // ── Scenario Outline 01 ──────────────────────────────────────────────
  scoped(/^a launch script generated for a "([^"]+)" window line that names no cloud host$/, (ctx, seat) => {
    const windowLine = KNOWN_SEAT_WINDOW_LINES[seat];
    assert.ok(windowLine, `unknown seat "${seat}" - known: ${Object.keys(KNOWN_SEAT_WINDOW_LINES).join(' | ')}`);
    ctx.root = generateLaunchScript(windowLine);
    ctx.role = 'coder';
  });

  // ── Scenario Outline 02 ──────────────────────────────────────────────
  scoped(/^a launch script generated for an aider window line whose OpenAI base is "([^"]+)"$/, (ctx, host) => {
    assert.ok(KNOWN_HOST_FLAGS[host], `unknown host "${host}" - known: ${Object.keys(KNOWN_HOST_FLAGS).join(' | ')}`);
    const windowLine = `window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base ${host} --no-gitignore`;
    ctx.root = generateLaunchScript(windowLine);
    ctx.role = 'coder';
    ctx.host = host;
  });

  // ── When (shared by both scenarios) ──────────────────────────────────
  scoped(/^the respawn environment for that seat is computed$/, (ctx) => {
    ctx.args = respawnEnvArgs(ctx.root, ctx.role);
  });

  // ── Then: scenario 01 ─────────────────────────────────────────────────
  scoped(/^it sets no SWARMFORGE_USE flag and no OpenAI base$/, (ctx) => {
    assert.ok(!hasAnyUseFlag(ctx.args), `expected no SWARMFORGE_USE_* flag, got: ${JSON.stringify(ctx.args)}`);
    assert.ok(!hasAnyOpenAiBase(ctx.args), `expected no OPENAI_API_BASE/OPENAI_BASE_URL, got: ${JSON.stringify(ctx.args)}`);
  });

  // ── Then: scenario 02 ─────────────────────────────────────────────────
  scoped(/^the seat is remapped to "([^"]+)" under the "([^"]+)" flag$/, (ctx, host, flag) => {
    assert.equal(host, ctx.host, `expected the Then host to match the Given host`);
    assert.equal(flag, KNOWN_HOST_FLAGS[host], `unknown (host, flag) pair - known hosts: ${Object.keys(KNOWN_HOST_FLAGS).join(' | ')}`);
    assert.ok(hasFlag(ctx.args, flag), `expected ${flag}=1 among the respawn args, got: ${JSON.stringify(ctx.args)}`);
    assert.ok(hasBase(ctx.args, host), `expected OPENAI_API_BASE and OPENAI_BASE_URL both set to ${host}, got: ${JSON.stringify(ctx.args)}`);
  });
}

module.exports = { registerSteps };
