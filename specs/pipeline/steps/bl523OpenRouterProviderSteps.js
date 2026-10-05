'use strict';

// BL-1948 (BL-523 stamp-off): step handlers for "OpenRouter provider
// support for claude-harness roles". Drives the REAL swarmforge.sh
// (sourced under zsh, parse_config + write_role_launch_script) against a
// fresh fixture root - the exact fixture shape
// swarmforge/scripts/test/test_openrouter_provider_support.sh already
// establishes, never a restatement of the billing_guard branching logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const SWARMFORGE_SH = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'swarmforge.sh');

const FEATURE = 'OpenRouter provider support for claude-harness roles';

const INDEX_OF_ROLE_SNIPPET = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function mkRoot() {
  const root = trackedTmpRoot('sfvc-bl523-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['specifier', 'coder', 'cleaner', 'architect', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function writeConf(root) {
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    [
      'config active_backlog_max_depth -1',
      'window coder claude coder --model deepseek/deepseek-chat',
      'window cleaner claude cleaner --model mistralai/mistral-large',
      'window architect claude architect --model google/gemini-2.5-pro',
      'window documenter claude documenter --model deepseek/deepseek-chat',
      '',
    ].join('\n')
  );
}

function writeLaunchScripts(root, { openrouterRoles, extraEnv = {} }, roles) {
  const script = `
source '${SWARMFORGE_SH}' '${root}'
parse_config
${INDEX_OF_ROLE_SNIPPET}
${roles.map((r) => `write_role_launch_script "$(index_of_role ${r})"`).join('\n')}
`;
  const env = {
    ...process.env,
    OPENROUTER_API_KEY: 'test-or-secret',
    ...extraEnv,
  };
  if (openrouterRoles === undefined) {
    delete env.SWARMFORGE_OPENROUTER_ROLES;
  } else {
    env.SWARMFORGE_OPENROUTER_ROLES = openrouterRoles;
  }
  const res = spawnSync('zsh', ['-c', script], { encoding: 'utf8', env });
  if (res.status !== 0) {
    throw new Error(`write_role_launch_script failed (status ${res.status}): ${res.stdout}${res.stderr}`);
  }
}

function launchScriptPath(root, role) {
  return path.join(root, '.swarmforge', 'launch', `${role}.sh`);
}

function readLaunchScript(root, role) {
  return fs.readFileSync(launchScriptPath(root, role), 'utf8');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a SwarmForge swarm with claude-harness roles configured$/, (ctx) => {
    ctx.root = mkRoot();
    writeConf(ctx.root);
  });

  scoped(/^OPENROUTER_API_KEY is available in the environment$/, () => {
    // writeLaunchScripts always supplies OPENROUTER_API_KEY; recorded here
    // only to name the precondition - nothing further to set up.
  });

  // ── openrouter-provider-support-01 ─────────────────────────────────────
  scoped(/^SWARMFORGE_OPENROUTER_ROLES is unset or empty$/, (ctx) => {
    ctx.openrouterRoles = undefined;
  });

  scoped(/^a claude-harness role starts$/, (ctx) => {
    ctx.startedRole = ctx.startedRole || 'documenter';
    writeLaunchScripts(ctx.root, { openrouterRoles: ctx.openrouterRoles }, [ctx.startedRole]);
    ctx.launchScript = readLaunchScript(ctx.root, ctx.startedRole);
  });

  scoped(/^the role uses first-party Anthropic subscription auth$/, (ctx) => {
    assert.match(ctx.launchScript, /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN/);
    assert.doesNotMatch(ctx.launchScript, /openrouter\.ai/);
  });

  scoped(/^ANTHROPIC_API_KEY is unset in the pane$/, (ctx) => {
    assert.match(ctx.launchScript, /unset ANTHROPIC_API_KEY/, 'expected the launch script to unset ANTHROPIC_API_KEY for this pane');
  });

  // ── openrouter-provider-support-02 ─────────────────────────────────────
  scoped(/^SWARMFORGE_OPENROUTER_ROLES contains "documenter"$/, (ctx) => {
    ctx.openrouterRoles = 'documenter';
    ctx.startedRole = 'documenter';
  });

  scoped(/^ANTHROPIC_BASE_URL is set to "https:\/\/openrouter\.ai\/api"$/, (ctx) => {
    assert.match(ctx.launchScript, /ANTHROPIC_BASE_URL='https:\/\/openrouter\.ai\/api'/);
  });

  scoped(/^ANTHROPIC_AUTH_TOKEN is set to the OPENROUTER_API_KEY value$/, (ctx) => {
    assert.match(ctx.launchScript, /ANTHROPIC_AUTH_TOKEN="\$OPENROUTER_API_KEY"/);
    assert.doesNotMatch(ctx.launchScript, /test-or-secret/, 'the secret value itself must never be written to disk');
  });

  // ── openrouter-provider-support-03 (outline) ───────────────────────────
  scoped(/^SWARMFORGE_OPENROUTER_ROLES contains "([^"]+)"$/, (ctx, roles) => {
    ctx.openrouterRoles = roles;
  });

  scoped(/^a (\S+) claude-harness role starts$/, (ctx, role) => {
    ctx.startedRole = role;
    writeLaunchScripts(ctx.root, { openrouterRoles: ctx.openrouterRoles }, [role]);
    ctx.launchScript = readLaunchScript(ctx.root, role);
  });

  scoped(/^the (\S+) uses OpenRouter endpoint$/, (ctx, role) => {
    assert.equal(role, ctx.startedRole);
    assert.match(ctx.launchScript, /openrouter\.ai/);
  });

  scoped(/^the (\S+) uses first-party Anthropic subscription auth$/, (ctx, role) => {
    assert.equal(role, ctx.startedRole);
    assert.match(ctx.launchScript, /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN/);
    assert.doesNotMatch(ctx.launchScript, /openrouter\.ai/);
  });

  // ── openrouter-provider-support-04 ─────────────────────────────────────
  scoped(/^the documenter window line specifies --model deepseek\/deepseek-chat$/, () => {
    // Already true of this fixture's own swarmforge.conf (writeConf above)
    // - named here as a precondition, nothing further to set up.
  });

  scoped(/^the harness receives model "deepseek\/deepseek-chat"$/, (ctx) => {
    const settingsPath = path.join(ctx.root, '.swarmforge', 'launch', `${ctx.startedRole}.claude-settings.json`);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.model, 'deepseek/deepseek-chat');
  });

  scoped(/^the model is passed to OpenRouter's Anthropic-compatible endpoint$/, (ctx) => {
    assert.match(ctx.launchScript, /openrouter\.ai/, 'expected this role to be routed through the OpenRouter endpoint alongside its model');
  });

  // ── openrouter-provider-support-05 ─────────────────────────────────────
  scoped(/^SWARMFORGE_OPENROUTER_ROLES no longer contains "documenter"$/, (ctx) => {
    ctx.openrouterRoles = '';
  });
}

module.exports = { registerSteps };
