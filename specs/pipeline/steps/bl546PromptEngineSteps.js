'use strict';

// BL-546: step handlers for "PromptEngine is the single authority for all
// swarm prompt composition". Drives the REAL prompt_engine_cli.bb (the CLI
// swarmforge.sh's write_agent_instruction_file shells out to) and
// cache_warm_cli.bb - never re-implements composition in JS. Reuses ctx keys
// (text, stablePrefix, textA/textB/prefixLength) that bl519InlineConstitution
// CacheSteps.js's shared Then handlers read, so the BL-519 contract
// assertions run unchanged against PromptEngine output.
//
// Scoped-vs-unscoped: "the warm step \"<warm-outcome>\"" would match
// bl519InlineConstitutionCacheSteps.js's unscoped /^the warm step (.+)$/ (its
// feature uses UNQUOTED examples, so the quoted capture would fail its
// known-values lookup) - registered via defineScoped pinned to THIS feature's
// exact title so it wins only here. "the pack is relaunched with stable
// prefix content ..." (no "the") and the via-PromptEngine Given text do NOT
// collide with bl519's anchored patterns, so they stay unscoped.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMPT_ENGINE_CLI = path.join(SCRIPTS_DIR, 'prompt_engine_cli.bb');
const AGENT_RUNTIME_LIB = path.join(SCRIPTS_DIR, 'agent_runtime_lib.bb');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const CACHE_WARM_CLI = path.join(SCRIPTS_DIR, 'cache_warm_cli.bb');

const FEATURE_NAME = 'PromptEngine is the single authority for all swarm prompt composition';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough, so a gherkin-mutator edit into an unrecognized value fails the
// scenario immediately instead of slipping into an else branch.
const KNOWN_CHANGES = new Set(['unchanged', 'constitution-changed', 'model-routing-changed']);
const KNOWN_WARM_OUTCOMES = {
  'reuses the still-warm cache': 'reuse-cache',
  're-warms the new prefix': 'rewarm'
};

function compose(role, { agent = 'claude', twoPack = '0', overlayPrompt = '', deterministic = false } = {}) {
  const args = [PROMPT_ENGINE_CLI, 'compose', agent, role, twoPack, overlayPrompt];
  if (deterministic) {
    args.push('--deterministic');
  }
  return execFileSync('bb', args, { encoding: 'utf8' });
}

function stableBootstrapPrefix() {
  return execFileSync('bb', [PROMPT_ENGINE_CLI, 'stable-bootstrap-prefix'], { encoding: 'utf8' });
}

function decideAndRecordWarm(stateDir, packName, modelRoutingText, stableTextOverride) {
  const args = [CACHE_WARM_CLI, 'decide-and-record-warm', stateDir, packName, modelRoutingText];
  if (stableTextOverride !== undefined) {
    args.push(stableTextOverride);
  }
  const out = execFileSync('bb', args, { encoding: 'utf8' });
  const [decision, hash] = out.trim().split('\n');
  return { decision, hash };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────────
  registry.define(/^the PromptEngine compose API is available$/, (ctx) => {
    if (!fs.existsSync(PROMPT_ENGINE_CLI)) {
      throw new Error(`expected the PromptEngine CLI to exist at ${PROMPT_ENGINE_CLI}`);
    }
    const prefix = stableBootstrapPrefix();
    if (!prefix.includes('# SwarmForge Constitution')) {
      throw new Error('expected the PromptEngine CLI to serve the BL-519 stable prefix (constitution missing)');
    }
    ctx.promptEngineCli = PROMPT_ENGINE_CLI;
  });

  registry.define(/^a standard seven-pack launch context with role "([^"]+)" and agent "([^"]+)"$/, (ctx, role, agent) => {
    ctx.role = role;
    ctx.agent = agent;
  });

  // ── single-authority-compose-01 ───────────────────────────────────────────
  registry.define(/^a role is prepared for launch$/, (ctx) => {
    ctx.systemPrompt = compose(ctx.role, { agent: ctx.agent });
  });

  registry.define(/^the system prompt artifact is produced by PromptEngine compose$/, (ctx) => {
    const prefix = stableBootstrapPrefix();
    if (!ctx.systemPrompt.startsWith(prefix)) {
      throw new Error('expected the launch artifact to begin with the PromptEngine stable prefix');
    }
    if (!ctx.systemPrompt.includes('You are the coder.')) {
      throw new Error('expected the launch artifact to carry the role prompt content after the stable prefix');
    }
  });

  registry.define(/^no launch script assembles prompt text directly$/, (ctx) => {
    const launcher = fs.readFileSync(SWARMFORGE_SH, 'utf8');
    if (!launcher.includes('prompt_engine_cli.bb" compose')) {
      throw new Error('expected swarmforge.sh to produce prompt artifacts via prompt_engine_cli.bb compose');
    }
    if (launcher.includes('agent_runtime_cli.bb" bootstrap-text')) {
      throw new Error('swarmforge.sh still assembles prompt text via the pre-BL-546 CLI path');
    }
  });

  // ── bl519-stable-prefix-preserved-02 (Then steps are bl519's shared ones) ─
  registry.define(/^PromptEngine composes a system prompt for a launched role$/, (ctx) => {
    ctx.text = compose(ctx.role, { agent: ctx.agent });
    ctx.stablePrefix = stableBootstrapPrefix();
  });

  // ── stable-prefix-byte-identical-03 (Then step is bl519's shared one) ─────
  registry.define(/^PromptEngine composes system prompts for roles "([^"]+)" and "([^"]+)"$/, (ctx, roleA, roleB) => {
    ctx.textA = compose(roleA, { agent: ctx.agent });
    ctx.textB = compose(roleB, { agent: ctx.agent });
    ctx.prefixLength = Buffer.byteLength(stableBootstrapPrefix(), 'utf8');
  });

  // ── deterministic-compose-04 ──────────────────────────────────────────────
  registry.define(/^PromptEngine is invoked twice with the same compose request and deterministic mode enabled$/, (ctx) => {
    const request = { agent: ctx.agent, twoPack: '0', overlayPrompt: '', deterministic: true };
    ctx.detA = compose(ctx.role, request);
    ctx.detB = compose(ctx.role, request);
  });

  registry.define(/^both composed system prompts are byte-identical$/, (ctx) => {
    const bufA = Buffer.from(ctx.detA, 'utf8');
    const bufB = Buffer.from(ctx.detB, 'utf8');
    if (!bufA.equals(bufB)) {
      throw new Error('expected deterministic compose to be byte-stable across identical invocations, but the outputs differed');
    }
  });

  // ── no-direct-agent-construction-07 ───────────────────────────────────────
  registry.define(/^a running swarm role pane$/, (ctx) => {
    // Acceptance is host-side (no live tmux): the pane's bootstrap prompt is
    // generated through the same CLI the launcher's write_agent_instruction_
    // file uses, which is the call chain this scenario pins.
    ctx.paneRole = ctx.role;
  });

  registry.define(/^its bootstrap system prompt is generated$/, (ctx) => {
    ctx.generatedPrompt = compose(ctx.paneRole, { agent: ctx.agent });
  });

  registry.define(/^the generation call chain includes PromptEngine compose$/, (ctx) => {
    const runtimeLib = fs.readFileSync(AGENT_RUNTIME_LIB, 'utf8');
    if (!runtimeLib.includes('prompt_engine_lib.bb') || !runtimeLib.includes('prompt-engine-lib/compose')) {
      throw new Error('expected agent_runtime_lib.bb to delegate bootstrap text to prompt-engine-lib/compose');
    }
    if (ctx.generatedPrompt !== compose(ctx.paneRole, { agent: ctx.agent })) {
      throw new Error('expected the pane bootstrap prompt to be PromptEngine compose output');
    }
  });

  registry.define(/^the role prompt file alone is not the sole system prompt source$/, (ctx) => {
    if (!ctx.generatedPrompt.includes('# SwarmForge Constitution')) {
      throw new Error('expected the composed prompt to include the constitution, not just the role prompt file');
    }
    const rolePrompt = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'roles', `${ctx.paneRole}.prompt`), 'utf8');
    if (!ctx.generatedPrompt.includes(rolePrompt.trim())) {
      throw new Error('expected the composed prompt to include the role prompt content');
    }
    if (Buffer.byteLength(ctx.generatedPrompt, 'utf8') <= Buffer.byteLength(rolePrompt, 'utf8')) {
      throw new Error('expected the composed prompt to be larger than the role prompt file alone');
    }
  });

  // ── cache-warm-hash-delegation-08 (Scenario Outline) ──────────────────────
  registry.define(/^a pack has been launched and its stable-prefix content hash recorded via PromptEngine$/, (ctx) => {
    ctx.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl546-cache-warm-'));
    ctx.packName = 'bl546-test-pack';
    ctx.baselineStableText = 'BL546_BASELINE_STABLE_TEXT_V1';
    ctx.baselineModelRoutingText = 'window coder claude coder --model claude-sonnet-5';
    const first = decideAndRecordWarm(ctx.stateDir, ctx.packName, ctx.baselineModelRoutingText, ctx.baselineStableText);
    if (first.decision !== 'rewarm') {
      throw new Error(`expected the first-ever launch of a pack to re-warm, got: ${first.decision}`);
    }
  });

  registry.define(/^the pack is relaunched with stable prefix content "([^"]+)"$/, (ctx, change) => {
    if (!KNOWN_CHANGES.has(change)) {
      throw new Error(`unrecognized Examples <change> value: "${change}"`);
    }
    let stableText = ctx.baselineStableText;
    let modelRoutingText = ctx.baselineModelRoutingText;
    if (change === 'constitution-changed') {
      stableText = 'BL546_BASELINE_STABLE_TEXT_V2_CHANGED';
    } else if (change === 'model-routing-changed') {
      modelRoutingText = 'window coder claude coder --model claude-opus-4-8';
    }
    ctx.result = decideAndRecordWarm(ctx.stateDir, ctx.packName, modelRoutingText, stableText);
  });

  registry.defineScoped(/^the warm step "([^"]+)"$/, (ctx, warmOutcome) => {
    const expected = KNOWN_WARM_OUTCOMES[warmOutcome];
    if (!expected) {
      throw new Error(`unrecognized Examples <warm-outcome> value: "${warmOutcome}"`);
    }
    if (ctx.result.decision !== expected) {
      throw new Error(`expected warm decision "${expected}" for outcome "${warmOutcome}", got: ${ctx.result.decision}`);
    }
    fs.rmSync(ctx.stateDir, { recursive: true, force: true });
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
