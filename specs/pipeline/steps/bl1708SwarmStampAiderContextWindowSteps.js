'use strict';

// BL-1708: step handlers for the review-only stamp of hotfixes ab1d4cb2bd
// and d0dd4d36b7 (BL-848). Scenarios 01/02 drive the REAL
// write_role_launch_script generator through zsh against a throwaway
// fixture root - the exact same invocation shape
// test_aider_seat_launch_config.sh and bl1699AiderSeatLaunchAndBootstrapSteps.js
// already use for this generator - never a reimplementation of it.
// Scenario 03 reads the real, committed Modelfile and start script
// statically. This is a REVIEW ticket: nothing here edits swarmforge.sh,
// the Modelfile or the start script (the ticket's own FIRM invariant).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1708 swarm stamp - aider seats see the served context window (hotfixes ab1d4cb2bd, d0dd4d36b7)';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const MODELFILE = path.join(REPO_ROOT, 'swarmforge', 'packs', 'qwen2.5-coder-32k.Modelfile');
const START_SCRIPT = path.join(REPO_ROOT, 'start-swarm-ollama-qwen2.5-coder.sh');

const AIDER_MODEL_FLAGS = '--model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore';

// Same index_of_role snippet test_aider_seat_launch_config.sh and
// bl1699AiderSeatLaunchAndBootstrapSteps.js already use to resolve a
// write_role_launch_script call's positional ROLES index.
const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1708-launch-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'QA', 'coordinator', 'specifier']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function aiderPackConf() {
  return [
    'config coordinator_agent aider',
    'config coordinator_model openai/qwen2.5-coder:latest',
    `window coder aider coder ${AIDER_MODEL_FLAGS}`,
    `window QA aider QA ${AIDER_MODEL_FLAGS}`,
    'window specifier claude specifier --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low',
  ].join('\n') + '\n';
}

function claudePackConf() {
  return ['window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low'].join(
    '\n'
  ) + '\n';
}

// BL-1702's own gate (wired into this same parse_config, after this ticket
// - BL-1708 - was minted) refuses any pack whose "coder" seat is a driver
// (aider) seat with no passing steward probe summary for its model - the
// aiderPackConf() shape below, unchanged since before BL-1702 existed,
// happens to be exactly that shape. A fixture evidence dir carrying one
// keeps this ticket's OWN fixture unaffected by that unrelated, newer gate
// rather than editing swarmforge.sh or this fixture's long-established
// "coder"/"QA" role names to dodge it.
let _probeEvidenceDir;
function probeEvidenceDir() {
  if (!_probeEvidenceDir) {
    _probeEvidenceDir = trackedTmpRoot('bl1708-probe-evidence-');
    fs.writeFileSync(
      path.join(_probeEvidenceDir, 'local-coder-probe-qwen2.5-coder-latest-2026-09-27T00-00-00Z.md'),
      '# local coder probe: qwen2.5-coder:latest\n\nhanded off 5 of 5 - verdict pass\n'
    );
  }
  return _probeEvidenceDir;
}

function generateLaunchScript(root, confText, role) {
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confText);
  execFileSync(
    'zsh',
    ['-f', '-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role ${role})"`],
    {
      encoding: 'utf8',
      env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1', LOCAL_CODER_PROBE_EVIDENCE_DIR: probeEvidenceDir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return fs.readFileSync(path.join(root, '.swarmforge', 'launch', `${role}.sh`), 'utf8');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario Outline 01 ──────────────────────────────────────────────
  scoped(/^the launch script for the aider "([^"]+)" seat is generated$/, (ctx, role) => {
    ctx.role = role;
    const root = mkFixtureRoot();
    ctx.root = root;
    ctx.launchScript = generateLaunchScript(root, aiderPackConf(), role);
  });

  scoped(/^it passes the repo-root model settings and model metadata files by absolute path$/, (ctx) => {
    assert.ok(
      ctx.launchScript.includes(`--model-settings-file '${ctx.root}/.aider.model.settings.yml'`),
      `expected an absolute repo-root --model-settings-file, got:\n${ctx.launchScript}`
    );
    assert.ok(
      ctx.launchScript.includes(`--model-metadata-file '${ctx.root}/.aider.model.metadata.json'`),
      `expected an absolute repo-root --model-metadata-file, got:\n${ctx.launchScript}`
    );
  });

  scoped(/^it passes an llm history file for "([^"]+)" under the swarm state directory$/, (ctx, role) => {
    assert.equal(role, ctx.role, `expected the llm history step's role to match the Given role`);
    assert.ok(
      ctx.launchScript.includes(`--llm-history-file '${ctx.root}/.swarmforge/aider-llm-history/${role}.log'`),
      `expected a per-role llm history file under .swarmforge/aider-llm-history, got:\n${ctx.launchScript}`
    );
    assert.ok(
      ctx.launchScript.includes(`mkdir -p '${ctx.root}/.swarmforge/aider-llm-history'`),
      `expected the llm history directory to be created before aider starts, got:\n${ctx.launchScript}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the launch script for a Claude seat is generated$/, (ctx) => {
    const root = mkFixtureRoot();
    ctx.claudeRoot = root;
    ctx.claudeLaunchScript = generateLaunchScript(root, claudePackConf(), 'coder');
  });

  scoped(/^it carries no model settings file, no model metadata file and no llm history file$/, (ctx) => {
    assert.doesNotMatch(
      ctx.claudeLaunchScript,
      /--model-settings-file|--model-metadata-file|--llm-history-file|aider-llm-history/,
      `expected a Claude seat's launch script to carry none of the aider-only flags, got:\n${ctx.claudeLaunchScript}`
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the qwen2\.5-coder Modelfile and the pack's start script are read$/, (ctx) => {
    ctx.modelfileText = fs.readFileSync(MODELFILE, 'utf8');
    ctx.startScriptText = fs.readFileSync(START_SCRIPT, 'utf8');
  });

  scoped(/^the Modelfile sets num_ctx 32768 on the existing qwen2\.5-coder tag$/, (ctx) => {
    assert.match(ctx.modelfileText, /^FROM qwen2\.5-coder:7b-instruct$/m, 'expected the Modelfile to build FROM the existing qwen2.5-coder tag');
    assert.match(ctx.modelfileText, /^PARAMETER num_ctx 32768$/m, 'expected PARAMETER num_ctx 32768');
  });

  scoped(/^the start script sets AIDER_MAP_TOKENS to 1024 before it launches the swarm$/, (ctx) => {
    const exportLine = ctx.startScriptText.match(/^export AIDER_MAP_TOKENS=.*$/m);
    assert.ok(exportLine, `expected an AIDER_MAP_TOKENS export, got:\n${ctx.startScriptText}`);
    assert.match(exportLine[0], /1024/, `expected AIDER_MAP_TOKENS to default to 1024, got: ${exportLine[0]}`);
    const exportIndex = ctx.startScriptText.indexOf(exportLine[0]);
    const launchIndex = ctx.startScriptText.search(/exec ".*start-swarm\.sh"/);
    assert.ok(launchIndex > exportIndex, 'expected AIDER_MAP_TOKENS to be exported before the swarm is launched');
  });
}

module.exports = { registerSteps };
