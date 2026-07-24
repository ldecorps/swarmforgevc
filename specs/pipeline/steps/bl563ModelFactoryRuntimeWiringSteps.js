'use strict';

// BL-563 Slices 1+2: step handlers for "a ModelFactory assignment overlay
// changes what launches". Drives the REAL swarmforge.sh functions
// (write_role_launch_script / write_agent_instruction_file, via the
// bl563ModelFactoryHarness.sh sourcing shim - live tmux/PTY interaction is
// this project's own testability boundary, so the harness calls only the
// two testable file-writing functions, never launch_role's tmux plumbing)
// and the REAL model_factory_cli.bb / prompt_engine_cli.bb CLIs - never
// reimplements the overlay-over-pack decision or compose logic in JS.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const MODEL_FACTORY_CLI = path.join(SCRIPTS_DIR, 'model_factory_cli.bb');
const HARNESS = path.join(__dirname, 'lib', 'bl563ModelFactoryHarness.sh');

const ROLES = ['coder', 'cleaner', 'architect', 'documenter'];
const OVERLAY_REL_PATH = path.join('.swarmforge', 'model-factory', 'assignment.json');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_BROKEN_STATES = {
  'malformed JSON': '{not valid json',
  truncated: '{"coder": {"model": "op',
  empty: ''
};

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkFixtureRoot(packModel) {
  const root = mkdtemp('bl563-model-factory-root-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of [...ROLES, 'specifier']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  const conf = ['config active_backlog_max_depth -1']
    .concat(ROLES.map((role) => `window ${role} claude ${role} --model ${packModel}`))
    .join('\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `${conf}\n`);
  return root;
}

function overlayFile(root) {
  return path.join(root, OVERLAY_REL_PATH);
}

function writeOverlay(root, roleModelMap) {
  fs.mkdirSync(path.dirname(overlayFile(root)), { recursive: true });
  const assignment = {};
  for (const [role, model] of Object.entries(roleModelMap)) {
    assignment[role] = { role, agent: 'claude', provider: 'anthropic', model };
  }
  fs.writeFileSync(overlayFile(root), JSON.stringify(assignment));
}

function removeOverlay(root) {
  fs.rmSync(overlayFile(root), { force: true });
}

function factoryStateDirFor(root) {
  return path.join(root, '.swarmforge', 'model-factory');
}

function runHarness(mode, root, role) {
  execFileSync('zsh', [HARNESS, mode, root, role, SWARMFORGE_SH], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, MODEL_FACTORY_STATE_DIR: factoryStateDirFor(root) }
  });
}

// "the launcher writes the role settings files" runs against every
// conf-declared role, exactly what a real launch's per-role loop does -
// never aborts on a per-role failure so scenario-03's "completes without
// error" can be asserted precisely (an error here is a real defect, not a
// harness artifact).
function writeSettingsForAllRoles(root) {
  const errors = [];
  for (const role of ROLES) {
    try {
      runHarness('settings', root, role);
    } catch (err) {
      errors.push({ role, message: (err.stderr || err.message || String(err)).toString() });
    }
  }
  return { errors };
}

function readSettings(root, role) {
  const p = path.join(root, '.swarmforge', 'launch', `${role}.claude-settings.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function settingsPathFor(root, role) {
  return path.join(root, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

function readComposeMetadata(root, role) {
  const p = path.join(root, '.swarmforge', 'prompts', `${role}.md.metadata.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────────
  registry.define(/^a pack conf whose window line for role "([^"]+)" carries --model "([^"]+)"$/, (ctx, role, model) => {
    ctx.root = mkFixtureRoot(model);
    ctx.packRole = role;
    ctx.packModel = model;
  });

  registry.define(/^the model-factory assignment overlay path is (.+)$/, (ctx, relPath) => {
    if (relPath !== OVERLAY_REL_PATH) {
      throw new Error(`expected the canonical overlay path "${OVERLAY_REL_PATH}", background named "${relPath}"`);
    }
    ctx.overlayRelPath = relPath;
  });

  // ── model-factory-runtime-wiring-01 / -06 (shared Given) ──────────────────
  registry.define(/^the assignment overlay names model "([^"]+)" for role "([^"]+)"$/, (ctx, model, role) => {
    writeOverlay(ctx.root, { [role]: model });
    ctx.overlayModel = model;
    ctx.overlayRole = role;
  });

  registry.define(/^the launcher writes the role settings files$/, (ctx) => {
    ctx.writeResult = writeSettingsForAllRoles(ctx.root);
    if (ctx.baselineRoot) {
      ctx.baselineWriteResult = writeSettingsForAllRoles(ctx.baselineRoot);
    }
  });

  registry.define(/^\.swarmforge\/launch\/([a-zA-Z]+)\.claude-settings\.json carries model "([^"]+)"$/, (ctx, role, model) => {
    const settings = readSettings(ctx.root, role);
    if (settings.model !== model) {
      throw new Error(`expected ${role}'s settings to carry model "${model}", got: ${JSON.stringify(settings)}`);
    }
  });

  // ── model-factory-runtime-wiring-02 ────────────────────────────────────────
  registry.define(/^no \.swarmforge\/model-factory\/assignment\.json exists$/, (ctx) => {
    // ctx.root: an overlay is written then removed, proving the removal path
    // is clean. ctx.baselineRoot: a second fixture that never had an
    // overlay at all. Both run through writeSettingsForAllRoles (see the
    // shared When step above) and are compared byte-for-byte in the Then
    // step - proof the overlay machinery is a true no-op when absent,
    // regardless of prior history, without hand-asserting a literal JSON
    // string that would drift from write_claude_settings_file's own format.
    writeOverlay(ctx.root, { [ctx.packRole]: 'a-transient-model-that-must-not-survive' });
    removeOverlay(ctx.root);
    ctx.baselineRoot = mkFixtureRoot(ctx.packModel);
  });

  registry.define(/^every role's settings file is byte-identical to the pack-derived baseline$/, (ctx) => {
    for (const role of ROLES) {
      const a = fs.readFileSync(settingsPathFor(ctx.root, role));
      const b = fs.readFileSync(settingsPathFor(ctx.baselineRoot, role));
      if (!a.equals(b)) {
        throw new Error(`expected ${role}'s settings file to be byte-identical to the pack-derived baseline; got:\n${a}\nvs baseline:\n${b}`);
      }
    }
  });

  // ── model-factory-runtime-wiring-03 (Scenario Outline) ─────────────────────
  registry.define(/^the assignment overlay file is (.+)$/, (ctx, brokenState) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_BROKEN_STATES, brokenState)) {
      throw new Error(`model-factory-runtime-wiring-03: unrecognized <broken-state> example value "${brokenState}"`);
    }
    fs.mkdirSync(path.dirname(overlayFile(ctx.root)), { recursive: true });
    fs.writeFileSync(overlayFile(ctx.root), KNOWN_BROKEN_STATES[brokenState]);
  });

  registry.define(/^every role's settings file carries its pack-derived model$/, (ctx) => {
    for (const role of ROLES) {
      const settings = readSettings(ctx.root, role);
      if (settings.model !== ctx.packModel) {
        throw new Error(`expected ${role}'s settings to carry the pack-derived model "${ctx.packModel}", got: ${JSON.stringify(settings)}`);
      }
    }
  });

  registry.define(/^the settings-writing step completes without error$/, (ctx) => {
    if (ctx.writeResult.errors.length > 0) {
      throw new Error(`expected the settings-writing step to complete without error, got: ${JSON.stringify(ctx.writeResult.errors)}`);
    }
  });

  // ── model-factory-runtime-wiring-04 ────────────────────────────────────────
  registry.define(/^the assignment overlay names a model only for role "([^"]+)"$/, (ctx, role) => {
    ctx.overlayModel = 'opus';
    ctx.overlayRole = role;
    writeOverlay(ctx.root, { [role]: ctx.overlayModel });
  });

  registry.define(/^coder's settings file carries the overlay model$/, (ctx) => {
    const settings = readSettings(ctx.root, 'coder');
    if (settings.model !== ctx.overlayModel) {
      throw new Error(`expected coder's settings to carry the overlay model "${ctx.overlayModel}", got: ${JSON.stringify(settings)}`);
    }
  });

  registry.define(/^the settings files for roles the overlay does not name keep their pack-derived models$/, (ctx) => {
    for (const role of ROLES) {
      if (role === ctx.overlayRole) continue;
      const settings = readSettings(ctx.root, role);
      if (settings.model !== ctx.packModel) {
        throw new Error(`expected ${role} (not named by the overlay) to keep the pack-derived model "${ctx.packModel}", got: ${JSON.stringify(settings)}`);
      }
    }
  });

  // ── model-factory-runtime-wiring-05 ────────────────────────────────────────
  // The REAL default_launch_seam.sh's own job (kill_all_swarm.sh + a live
  // tmux-session poll) is the unsuitable-for-acceptance boundary this
  // project's own testability rule names (live tmux/PTY interaction);
  // BL-525's own cold-apply-plan-08 scenario already stubs the launch seam
  // entirely rather than touch real tmux. This scenario proves the same
  // contract BL-525 established one step further: that the overlay
  // cold-apply just wrote is the SAME overlay a settings-writing step
  // consults - via the real cold-apply CLI (writes the overlay) and the
  // real resolve-model CLI (consults it), both against the same
  // MODEL_FACTORY_STATE_DIR, standing in for "the seam relaunches onto the
  // canonical path cold-apply already populated".
  registry.define(/^a cold-apply plan whose overlay_path names a freshly written assignment overlay$/, (ctx) => {
    ctx.factoryStateDir = mkdtemp('bl563-cold-apply-factory-');
    const seamDir = mkdtemp('bl563-cold-apply-seam-');
    ctx.stubSeamPath = path.join(seamDir, 'stub-seam.sh');
    ctx.stubInvocationLog = path.join(seamDir, 'invocation.log');
    fs.writeFileSync(
      ctx.stubSeamPath,
      `#!/usr/bin/env bash\nprintf '%s' "$1" > "${ctx.stubInvocationLog}"\nexit 0\n`
    );
    fs.chmodSync(ctx.stubSeamPath, 0o755);
    ctx.pack = 'codex-mono-router';
    ctx.coldApplyOut = JSON.parse(execFileSync('bb', [
      MODEL_FACTORY_CLI, 'cold-apply', '--mode', 'quality', '--pack', ctx.pack, '--launch-seam', ctx.stubSeamPath
    ], {
      encoding: 'utf8',
      env: { ...process.env, MODEL_FACTORY_STATE_DIR: ctx.factoryStateDir }
    }));
    const writtenOverlay = path.join(ctx.factoryStateDir, 'assignment.json');
    if (!fs.existsSync(writtenOverlay)) {
      throw new Error(`expected cold-apply to write the overlay at ${writtenOverlay}`);
    }
    if (ctx.coldApplyOut.plan.overlay_path !== writtenOverlay) {
      throw new Error(`expected the plan to name the freshly written overlay, got: ${ctx.coldApplyOut.plan.overlay_path}`);
    }
  });

  registry.define(/^the default launch seam executes the plan against a stub launcher$/, (ctx) => {
    // The stub launcher stands in for "the relaunched swarm's settings-writing
    // step": it consults the SAME MODEL_FACTORY_STATE_DIR the plan's overlay
    // sits under, via the real resolve-model CLI - never a hand-rolled
    // re-derivation of the overlay-over-pack decision.
    ctx.stubLauncherResolvedModel = execFileSync('bb', [
      MODEL_FACTORY_CLI, 'resolve-model', 'coder', 'a-pack-derived-model-that-must-lose'
    ], {
      encoding: 'utf8',
      env: { ...process.env, MODEL_FACTORY_STATE_DIR: ctx.factoryStateDir }
    }).trim();
  });

  registry.define(/^the stub launcher consults that overlay when writing settings files$/, (ctx) => {
    const expected = ctx.coldApplyOut.assignment.coder.model;
    if (ctx.stubLauncherResolvedModel !== expected) {
      throw new Error(`expected the stub launcher to consult the freshly written overlay and resolve coder's model to "${expected}", got: "${ctx.stubLauncherResolvedModel}"`);
    }
  });

  // ── model-factory-runtime-wiring-06 ────────────────────────────────────────
  registry.define(/^the launcher composes coder's system-prompt artifact$/, (ctx) => {
    runHarness('compose', ctx.root, 'coder');
    ctx.composeMetadata = readComposeMetadata(ctx.root, 'coder');
  });

  registry.define(/^the compose invocation for "([^"]+)" receives model "([^"]+)"$/, (ctx, role, model) => {
    if (ctx.composeMetadata.role !== role || ctx.composeMetadata.model !== model) {
      throw new Error(`expected the compose invocation for "${role}" to receive model "${model}", got: ${JSON.stringify(ctx.composeMetadata)}`);
    }
  });

  registry.define(/^the composed artifact's metadata records model "([^"]+)"$/, (ctx, model) => {
    if (ctx.composeMetadata.model !== model) {
      throw new Error(`expected the composed artifact's metadata to record model "${model}", got: ${JSON.stringify(ctx.composeMetadata)}`);
    }
  });
}

module.exports = { registerSteps };
