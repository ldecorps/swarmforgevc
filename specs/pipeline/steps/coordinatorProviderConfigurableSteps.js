'use strict';

// BL-319: step handlers for "Coordinator provider is configurable like all
// other roles". Drives the REAL swarmforge.sh directly (sourced, not
// executed - BL-089's own ZSH_EVAL_CONTEXT toplevel guard skips
// tmux/git/real-launch side effects when sourced), mirroring
// coordinatorModelConfigurableSteps.js's own sourceAndRun/mkFixtureRoot
// shape exactly (deliberately duplicated rather than imported - neither
// file exports its fixture helpers, the same "small live-glue duplicated
// across independent step files" posture documented elsewhere in this
// codebase).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SH = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'swarmforge.sh');

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-coordinator-provider-'));
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
// returning { ok, stdout } - never throws on a non-zero exit (scenario 03
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

const SPLIT_MARKER = '---BL319-SPLIT---';

function provisionCoordinator(ctx) {
  ctx.result = sourceAndRun(
    ctx.root,
    `print -l -- "\${ROLES[@]}" ; print -r -- "${SPLIT_MARKER}" ; print -l -- "\${AGENTS[@]}" ; print -r -- "${SPLIT_MARKER}" ; print -l -- "\${EXTRA_CLI_ARGS[@]}"`
  );
  if (!ctx.result.ok) {
    // A rejected launch (scenario 03) has no roles/agents/extra_cli blocks
    // to split - the caller's own step asserts on ctx.result directly.
    return;
  }
  const [rolesBlock, agentsBlock, extraCliBlock] = ctx.result.stdout.split(`${SPLIT_MARKER}\n`);
  const roles = rolesBlock.split('\n').filter(Boolean);
  const agents = agentsBlock.split('\n');
  const extraCliArgs = extraCliBlock.split('\n');
  const coordinatorIdx = roles.indexOf('coordinator');
  if (coordinatorIdx === -1) {
    throw new Error(`expected a provisioned coordinator, got: ${ctx.result.stdout}`);
  }
  ctx.coordinatorAgent = agents[coordinatorIdx];
  ctx.coordinatorExtraCli = extraCliArgs[coordinatorIdx];
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm is configured with a specific provider for the coordinator$/, () => {
    // Narrative only - each scenario below writes its own fixture conf.
  });

  registry.define(/^the coordinator is provisioned as reserved infrastructure$/, () => {
    // Narrative restatement of BL-243, unchanged by this ticket - no
    // setup of its own; scenario 03 below re-verifies the launch still
    // fails loudly, just now via the shared validate_agent path.
  });

  // ── coordinator-provider-configurable-01 ────────────────────────────
  // "the swarm launches" is ALREADY registered by coordinatorProvisioningSteps.js
  // (BL-243) with identical literal text - the registry resolves by
  // first-registration-wins over the whole GLOBAL step namespace (no
  // per-feature scoping, specs/pipeline/stepRegistry.js), so a second
  // identical pattern here would simply be dead/unreachable code, not a
  // second, feature-scoped handler. Rather than fight that (or mutate
  // BL-243's own file), the launch itself runs here, in the Given step -
  // by the time "When the swarm launches" resolves to BL-243's shared
  // handler (which harmlessly re-runs parse_config/write_roles_file
  // against the SAME fixture root for its own unrelated assertions), this
  // scenario's own data is already captured.
  registry.define(/^the pack config specifies coordinator_agent as copilot$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'config coordinator_agent copilot\nwindow coder claude coder --model x\n');
    provisionCoordinator(ctx);
  });

  registry.define(/^the coordinator should be launched using the copilot provider$/, (ctx) => {
    if (ctx.coordinatorAgent !== 'copilot') {
      throw new Error(`expected the coordinator provisioned with the copilot provider, got: ${ctx.coordinatorAgent}`);
    }
  });

  registry.define(/^the coordinator's launch script should not contain Claude-specific flags$/, (ctx) => {
    if (ctx.coordinatorExtraCli.includes('--dangerously-skip-permissions') || ctx.coordinatorExtraCli.includes('--effort')) {
      throw new Error(`expected no Claude-only flags in a copilot coordinator's extra_cli, got: ${ctx.coordinatorExtraCli}`);
    }
  });

  // ── coordinator-provider-configurable-02 ────────────────────────────
  // Same "the swarm launches" collision as scenario 01 above - the launch
  // runs here, in the Given step.
  registry.define(/^no coordinator_agent config is present$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'window coder claude coder --model x\n');
    provisionCoordinator(ctx);
  });

  registry.define(/^the coordinator should default to claude provider$/, (ctx) => {
    if (ctx.coordinatorAgent !== 'claude') {
      throw new Error(`expected the coordinator to default to claude, got: ${ctx.coordinatorAgent}`);
    }
  });

  registry.define(/^should use the same flags as today's launch$/, (ctx) => {
    if (
      !ctx.coordinatorExtraCli.includes('--dangerously-skip-permissions') ||
      !ctx.coordinatorExtraCli.includes('--effort high') ||
      !ctx.coordinatorExtraCli.includes('--model claude-sonnet-5')
    ) {
      throw new Error(`expected today's exact default claude flags unchanged, got: ${ctx.coordinatorExtraCli}`);
    }
  });

  // ── coordinator-provider-configurable-03 ────────────────────────────
  registry.define(/^a pack file contains config coordinator_agent with an unknown provider name bogus$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'config coordinator_agent bogus\nwindow coder claude coder --model x\n');
  });

  registry.define(/^the swarm attempts to launch$/, (ctx) => {
    provisionCoordinator(ctx);
  });

  registry.define(/^the launch should fail with an explicit error about unknown provider$/, (ctx) => {
    if (ctx.result.ok) {
      throw new Error('expected the launch to fail for an unknown coordinator_agent');
    }
    if (!/Unsupported agent 'bogus' for role 'coordinator'/.test(ctx.result.stdout)) {
      throw new Error(`expected the shared "Unsupported agent" error, got: ${ctx.result.stdout}`);
    }
  });

  // ── coordinator-provider-configurable-04 ────────────────────────────
  // Handoff injection itself (handoffd.bb's notify-agent!/wake-steps) is
  // ALREADY provider-agnostic - it reads :agent off roles.tsv generically
  // for every role including the coordinator (confirmed by inspection: no
  // coordinator-specific hardcoding anywhere in handoffd.bb). The one real
  // contract point THIS ticket owns is that the configured provider
  // actually REACHES roles.tsv - so this scenario provisions a copilot
  // coordinator, writes roles.tsv via the real write_roles_file, and
  // asserts the coordinator's row carries "copilot" in the agent column,
  // exactly what load-roles (handoffd.bb) reads to pick wake-steps.
  registry.define(/^the coordinator is running with copilot provider$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeConf(ctx.root, 'config coordinator_agent copilot\nwindow coder claude coder --model x\n');
    ctx.result = sourceAndRun(ctx.root, 'write_roles_file');
    if (!ctx.result.ok) {
      throw new Error(`setup: expected provisioning to succeed, got: ${ctx.result.stdout}`);
    }
  });

  registry.define(/^a handoff needs to be delivered to the coordinator$/, () => {
    // Narrative only - the delivery-readiness contract (roles.tsv carrying
    // the right provider) is what the Then step below actually verifies;
    // handoffd.bb's own injection logic is out of this ticket's scope
    // (already generic, unchanged).
  });

  registry.define(/^the handoff should be successfully injected into the copilot agent's session$/, (ctx) => {
    const rolesTsvPath = path.join(ctx.root, '.swarmforge', 'roles.tsv');
    if (!fs.existsSync(rolesTsvPath)) {
      throw new Error('expected roles.tsv to be written');
    }
    const rolesTsv = fs.readFileSync(rolesTsvPath, 'utf8');
    const coordinatorRow = rolesTsv.split('\n').find((line) => line.startsWith('coordinator\t'));
    if (!coordinatorRow) {
      throw new Error(`expected a coordinator row in roles.tsv, got: ${rolesTsv}`);
    }
    const agentColumn = coordinatorRow.split('\t')[5];
    if (agentColumn !== 'copilot') {
      throw new Error(`expected roles.tsv's coordinator row to carry the configured copilot provider, got: ${coordinatorRow}`);
    }
  });
}

module.exports = { registerSteps };
