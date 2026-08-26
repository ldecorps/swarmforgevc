'use strict';

// BL-314: step handlers for "The coordinator's model and effort are
// pack-configurable instead of hardcoded to Opus". Drives the REAL
// swarmforge.sh directly (sourced, not executed - BL-089's own
// ZSH_EVAL_CONTEXT toplevel guard skips tmux/git/real-launch side effects
// when sourced), mirroring coordinatorProvisioningSteps.js's own
// sourceAndRun/mkFixtureRoot shape exactly (deliberately duplicated rather
// than imported - neither file exports its fixture helpers, the same
// "small live-glue duplicated across independent step files" posture
// documented elsewhere in this codebase).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SH = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'swarmforge.sh');

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-coordinator-model-'));
  const rolesDir = path.join(root, 'swarmforge', 'roles');
  fs.mkdirSync(rolesDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['specifier', 'coder']) {
    fs.writeFileSync(path.join(rolesDir, `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function writeConf(root, content) {
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), content);
}

// Runs `source swarmforge.sh <root>; parse_config; <extraCommands>`,
// returning { ok, stdout } - never throws on a non-zero exit (scenario 04
// expects a rejection, not a test-harness failure). Explicitly clears any
// inherited SWARMFORGE_CONFIG from the calling shell (a coder session may
// itself be launched via a pack) so this fixture's own conf is always the
// one actually resolved.
function sourceAndRun(root, extraCommands) {
  const script = `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${extraCommands}`;
  try {
    const stdout = execFileSync('zsh', ['-c', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SWARMFORGE_CONFIG: '' },
    });
    return { ok: true, stdout };
  } catch (err) {
    const stdout = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
    return { ok: false, stdout };
  }
}

const SPLIT_MARKER = '---BL314-SPLIT---';

function provisionCoordinator(ctx) {
  ctx.result = sourceAndRun(
    ctx.root,
    `print -l -- "\${ROLES[@]}" ; print -r -- "${SPLIT_MARKER}" ; print -l -- "\${EXTRA_CLI_ARGS[@]}"`
  );
  const [rolesBlock, extraCliBlock] = ctx.result.stdout.split(`${SPLIT_MARKER}\n`);
  const roles = rolesBlock.split('\n').filter(Boolean);
  const extraCliArgs = extraCliBlock.split('\n');
  const coordinatorIdx = roles.indexOf('coordinator');
  if (coordinatorIdx === -1) {
    throw new Error(`expected a provisioned coordinator, got: ${ctx.result.stdout}`);
  }
  ctx.coordinatorExtraCli = extraCliArgs[coordinatorIdx];
}

function registerSteps(registry) {
  // ── coordinator-model-configurable-01 ───────────────────────────────
  registry.define(
    /^a pack config declares coordinator_model claude-sonnet-5 and coordinator_effort high$/,
    (ctx) => {
      ctx.root = mkFixtureRoot();
      writeConf(ctx.root, 'config coordinator_model claude-sonnet-5\nconfig coordinator_effort high\nwindow coder claude coder --model x\n');
    }
  );

  registry.define(/^the coordinator is provisioned$/, (ctx) => {
    provisionCoordinator(ctx);
  });

  registry.define(/^it is launched with that model and effort$/, (ctx) => {
    if (!ctx.coordinatorExtraCli.includes('--model claude-sonnet-5') || !ctx.coordinatorExtraCli.includes('--effort high')) {
      throw new Error(`expected the declared model/effort honored, got: ${ctx.coordinatorExtraCli}`);
    }
  });

  // ── coordinator-model-configurable-02 ───────────────────────────────
  registry.define(/^a pack config declares neither coordinator_model nor coordinator_effort$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'window coder claude coder --model x\n');
  });

  registry.define(/^it is launched with the default Sonnet-tier model, not Opus$/, (ctx) => {
    if (!ctx.coordinatorExtraCli.includes('--model claude-sonnet-5') || !ctx.coordinatorExtraCli.includes('--effort high')) {
      throw new Error(`expected the Sonnet-tier default (claude-sonnet-5/high), got: ${ctx.coordinatorExtraCli}`);
    }
    if (ctx.coordinatorExtraCli.includes('opus')) {
      throw new Error(`expected NOT Opus by default, got: ${ctx.coordinatorExtraCli}`);
    }
  });

  // ── coordinator-model-configurable-03 ───────────────────────────────
  registry.define(/^a pack config declares coordinator_model claude-opus-4-8$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'config coordinator_model claude-opus-4-8\nwindow coder claude coder --model x\n');
  });

  registry.define(/^it is launched with the Opus model as declared$/, (ctx) => {
    if (!ctx.coordinatorExtraCli.includes('--model claude-opus-4-8')) {
      throw new Error(`expected an explicit Opus opt-in to be honored, got: ${ctx.coordinatorExtraCli}`);
    }
  });

  // ── coordinator-model-configurable-04 ───────────────────────────────
  registry.define(/^a pack config declares a window line for the coordinator role$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'window coordinator claude master --model x\nwindow coder claude coder --model x\n');
  });

  registry.define(/^the config is parsed$/, (ctx) => {
    ctx.parseResult = sourceAndRun(ctx.root, '');
  });

  registry.define(/^it is rejected exactly as before$/, (ctx) => {
    if (ctx.parseResult.ok) {
      throw new Error('expected parse_config to reject a conf naming coordinator as a window line');
    }
    if (!/coordinator is reserved infrastructure/i.test(ctx.parseResult.stdout)) {
      throw new Error(`expected "coordinator is reserved infrastructure", got: ${ctx.parseResult.stdout}`);
    }
  });
}

module.exports = { registerSteps };
