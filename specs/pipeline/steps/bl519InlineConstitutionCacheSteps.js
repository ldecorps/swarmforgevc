'use strict';

// BL-519: step handlers for "agent bootstrap inlines the constitution into a
// cacheable stable-first system-prompt prefix". Drives the REAL
// agent_runtime_cli.bb (bootstrap-text / stable-bootstrap-prefix) and
// cache_warm_cli.bb (decide-and-record-warm) - the same CLIs swarmforge.sh
// itself shells out to - rather than re-implementing the generation/hash
// logic in JS. Live cache-read telemetry (usage.cache_read_input_tokens)
// needs a real swarm + the Anthropic API across respawns, so it is NOT
// covered here; the ticket records that as QA's end-to-end procedure.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const AGENT_RUNTIME_CLI = path.join(SCRIPTS_DIR, 'agent_runtime_cli.bb');
const CACHE_WARM_CLI = path.join(SCRIPTS_DIR, 'cache_warm_cli.bb');

function bootstrapText(role, { twoPack = false, overlayPrompt = '' } = {}) {
  return execFileSync('bb', [AGENT_RUNTIME_CLI, 'bootstrap-text', 'claude', role, twoPack ? '1' : '0', overlayPrompt], {
    encoding: 'utf8'
  });
}

function stableBootstrapPrefix() {
  return execFileSync('bb', [AGENT_RUNTIME_CLI, 'stable-bootstrap-prefix'], { encoding: 'utf8' });
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
  // ── constitution-inlined-not-read-01 / stable-content-ordered-first-02 /
  //    no-volatile-before-stable-chunk-03 share this Given ────────────────
  registry.define(/^the appended system prompt generated for a launched role$/, (ctx) => {
    ctx.role = 'coder';
    ctx.text = bootstrapText(ctx.role);
    ctx.stablePrefix = stableBootstrapPrefix();
  });

  registry.define(/^it contains the inlined constitution and PIPELINE content$/, (ctx) => {
    if (!ctx.text.includes('# SwarmForge Constitution')) {
      throw new Error('expected the actual constitution content to be inlined, but it was not found');
    }
    if (!ctx.text.includes('# Parcel Flow')) {
      throw new Error('expected the actual PIPELINE.md content to be inlined, but it was not found');
    }
  });

  registry.define(/^it does not instruct the agent to Read the constitution at boot$/, (ctx) => {
    if (ctx.text.includes('Read swarmforge/constitution.prompt, then read every file it refers to recursively')) {
      throw new Error('expected the old runtime-Read instruction to be gone, but it is still present');
    }
  });

  registry.define(/^the inlined constitution and PIPELINE content appears before any role-specific content$/, (ctx) => {
    const constitutionIdx = ctx.text.indexOf('# SwarmForge Constitution');
    const pipelineIdx = ctx.text.indexOf('# Parcel Flow');
    const roleIdx = ctx.text.indexOf('You are the coder.');
    if (constitutionIdx === -1 || pipelineIdx === -1 || roleIdx === -1) {
      throw new Error(`expected to find constitution, PIPELINE, and role markers; got indices ${constitutionIdx}/${pipelineIdx}/${roleIdx}`);
    }
    if (!(constitutionIdx < roleIdx && pipelineIdx < roleIdx)) {
      throw new Error('expected stable content (constitution, PIPELINE) to precede role-specific content');
    }
  });

  registry.define(/^no date, session id, ticket id, or resume-on-start note precedes the stable chunk$/, (ctx) => {
    if (ctx.stablePrefix.includes('RESUME-ON-START')) {
      throw new Error('expected no RESUME-ON-START note in the stable prefix, but found one');
    }
  });

  // ── stable-prefix-byte-identical-across-packs-04 ─────────────────────────
  registry.define(/^the appended system prompts generated for two roles built by the same bootstrap code path$/, (ctx) => {
    ctx.textA = bootstrapText('coder');
    ctx.textB = bootstrapText('cleaner', { twoPack: true });
    ctx.prefixLength = Buffer.byteLength(stableBootstrapPrefix(), 'utf8');
  });

  registry.define(/^their inlined constitution-and-PIPELINE prefix is byte-identical$/, (ctx) => {
    const bufA = Buffer.from(ctx.textA, 'utf8').subarray(0, ctx.prefixLength);
    const bufB = Buffer.from(ctx.textB, 'utf8').subarray(0, ctx.prefixLength);
    if (!bufA.equals(bufB)) {
      throw new Error('expected the stable prefix to be byte-identical across two different roles/packs, but it differed');
    }
  });

  // ── warm-hash-tracks-stable-prefix-05 (Scenario Outline) ─────────────────
  registry.define(/^a pack has been launched and its stable-prefix content hash recorded$/, (ctx) => {
    ctx.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl519-cache-warm-'));
    ctx.packName = 'bl519-test-pack';
    ctx.baselineStableText = 'BL519_BASELINE_STABLE_TEXT_V1';
    ctx.baselineModelRoutingText = 'window coder claude coder --model claude-sonnet-5';
    const first = decideAndRecordWarm(ctx.stateDir, ctx.packName, ctx.baselineModelRoutingText, ctx.baselineStableText);
    if (first.decision !== 'rewarm') {
      throw new Error(`expected the first-ever launch of a pack to re-warm, got: ${first.decision}`);
    }
  });

  registry.define(/^the pack is relaunched with the stable prefix content (.+)$/, (ctx, change) => {
    let stableText = ctx.baselineStableText;
    let modelRoutingText = ctx.baselineModelRoutingText;
    if (change === 'constitution-changed') {
      stableText = 'BL519_BASELINE_STABLE_TEXT_V2_CHANGED';
    } else if (change === 'model-routing-changed') {
      modelRoutingText = 'window coder claude coder --model claude-opus-4-8';
    } else if (change !== 'unchanged') {
      throw new Error(`unrecognized Examples <change> value: "${change}"`);
    }
    ctx.result = decideAndRecordWarm(ctx.stateDir, ctx.packName, modelRoutingText, stableText);
  });

  registry.define(/^the warm step (.+)$/, (ctx, warmOutcome) => {
    const expected = warmOutcome === 'reuses the still-warm cache' ? 'reuse-cache'
      : warmOutcome === 're-warms the new prefix' ? 'rewarm'
      : null;
    if (!expected) {
      throw new Error(`unrecognized Examples <warm-outcome> value: "${warmOutcome}"`);
    }
    if (ctx.result.decision !== expected) {
      throw new Error(`expected warm decision "${expected}" for outcome "${warmOutcome}", got: ${ctx.result.decision}`);
    }
    fs.rmSync(ctx.stateDir, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
