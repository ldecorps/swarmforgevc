'use strict';

// BL-1829: step handlers for "A local-model seat starts qwen with only the
// tools its role loop uses". Drives the REAL write_role_launch_script (and,
// for scenario 03, the REAL local_model_window_gate_cli.bb) through zsh
// against a throwaway fixture root - same posture as BL-1052/BL-1801's own
// step handlers for this same launch path. Never a reimplementation of the
// settings-writer or the window-gate decision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1829 A local-model seat starts qwen with only the tools its role loop uses';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const WINDOW_GATE_CLI = path.join(SCRIPTS_DIR, 'local_model_window_gate_cli.bb');

// The six loop tools this ticket allows, matching write_local_model_qwen_settings.
const CORE_TOOLS = ['run_shell_command', 'read_file', 'write_file', 'edit', 'glob', 'grep_search'];

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function makeFixtureRoot() {
  const root = trackedTmpRoot('bl1829-local-seat-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'cleaner']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    [
      'config active_backlog_max_depth -1',
      'window coder local-model coder --model qwen2.5-coder:7b-instruct',
      'window cleaner claude cleaner',
      '',
    ].join('\n')
  );
  return root;
}

function ensure(ctx) {
  if (!ctx.bl1829) {
    ctx.bl1829 = { root: makeFixtureRoot() };
  }
  return ctx.bl1829;
}

function writeLaunchScripts(ctx) {
  const st = ensure(ctx);
  const childEnv = { ...process.env, PACK_STAFFING_SKIP_GATE: '1', SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy' };
  for (const role of ['coder', 'cleaner']) {
    execFileSync(
      'zsh',
      [
        '-f',
        '-c',
        `source '${SWARMFORGE_SH}' '${st.root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role ${role})"`,
      ],
      { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  }
}

function qwenSettingsPath(root, role) {
  return path.join(root, '.worktrees', role, '.qwen', 'settings.json');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack with a local-model coder seat and a claude cleaner seat$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the launch scripts are written$/, (ctx) => {
    writeLaunchScripts(ctx);
  });

  scoped(/^the coder seat's working directory has a \.qwen\/settings\.json whose core tools are exactly run_shell_command, read_file, write_file, edit, glob and grep_search$/, (ctx) => {
    const st = ensure(ctx);
    const p = qwenSettingsPath(st.root, 'coder');
    assert.ok(fs.existsSync(p), `expected ${p} to exist`);
    const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepEqual(
      [...settings.coreTools].sort(),
      [...CORE_TOOLS].sort(),
      `expected coreTools to be exactly the six loop tools, got: ${JSON.stringify(settings.coreTools)}`
    );
    assert.deepEqual(
      [...settings.tools.core].sort(),
      [...CORE_TOOLS].sort(),
      `expected tools.core to be exactly the six loop tools, got: ${JSON.stringify(settings.tools.core)}`
    );
    st.coderSettings = settings;
  });

  scoped(/^its excluded tools name none of those six$/, (ctx) => {
    const st = ensure(ctx);
    const settings = st.coderSettings;
    for (const tool of CORE_TOOLS) {
      assert.ok(!settings.excludeTools.includes(tool), `excludeTools must not name loop tool "${tool}", got: ${JSON.stringify(settings.excludeTools)}`);
      assert.ok(!settings.tools.exclude.includes(tool), `tools.exclude must not name loop tool "${tool}", got: ${JSON.stringify(settings.tools.exclude)}`);
    }
  });

  scoped(/^the cleaner seat's working directory has no \.qwen\/settings\.json written by the launch$/, (ctx) => {
    const st = ensure(ctx);
    const p = qwenSettingsPath(st.root, 'cleaner');
    assert.ok(!fs.existsSync(p), `expected no settings.json at ${p} - a claude seat must never get one`);
  });

  scoped(/^the swarm's recorded local-model CLI overhead and the coder's compact card$/, (ctx) => {
    const st = ensure(ctx);
    const source = fs.readFileSync(SWARMFORGE_SH, 'utf8');
    const m = source.match(/^DEFAULT_LOCAL_MODEL_CLI_OVERHEAD_CHARS=(\d+)/m);
    assert.ok(m, 'DEFAULT_LOCAL_MODEL_CLI_OVERHEAD_CHARS not found in swarmforge.sh');
    st.overheadChars = Number(m[1]);
    // BL-1798: the coder's compact card is AT MOST 8,192 characters - the
    // worst case this scenario means to prove still fits.
    const promptPath = path.join(st.root, 'compact-card.txt');
    fs.writeFileSync(promptPath, 'x'.repeat(8192));
    st.promptPath = promptPath;
  });

  scoped(/^the window gate checks the coder seat against a 32768-token window$/, (ctx) => {
    const st = ensure(ctx);
    const args = [
      WINDOW_GATE_CLI,
      'check',
      '--role', 'coder',
      '--model', 'ista-iq3s-coder:latest',
      '--prompt-file', st.promptPath,
      // Unreachable on purpose (BL-1801's own test convention) - the
      // window comes from --context-length below, never a live probe.
      '--endpoint-url', 'http://127.0.0.1:1/v1',
      '--context-length', '32768',
      '--overhead-chars', String(st.overheadChars),
    ];
    try {
      st.out = execFileSync('bb', args, { encoding: 'utf8' });
      st.exitCode = 0;
    } catch (err) {
      st.out = `${err.stdout || ''}${err.stderr || ''}`;
      st.exitCode = err.status;
    }
  });

  scoped(/^the seat is not refused$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.exitCode, 0, `expected exit 0 (not refused), got ${st.exitCode}: ${st.out}`);
    assert.doesNotMatch(st.out, /^REFUSE:/m, `expected no REFUSE line, got: ${st.out}`);
  });
}

module.exports = { registerSteps };
