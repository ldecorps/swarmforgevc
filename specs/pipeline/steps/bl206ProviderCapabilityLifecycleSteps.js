'use strict';

// BL-1945 (BL-206 stamp-off): step handlers for "Fork orchestration
// branches on provider capabilities with a uniform lifecycle". Drives the
// REAL agent_runtime_lib.bb / prompt_engine_lib.bb capability model and
// lifecycle-verb functions via specs/pipeline/steps/lib/
// bl206AgentRuntimeCli.bb - the exact shim shape this ticket's own
// description directs, mirroring swarmforge/scripts/test/
// agent_runtime_test_runner.bb's own already-landed BL-206 assertions.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'bl206AgentRuntimeCli.bb');

function runCli(...args) {
  const out = execFileSync('bb', [CLI, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

const FEATURE = 'Fork orchestration branches on provider capabilities with a uniform lifecycle';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── capability-branching-01 ─────────────────────────────────────────
  scoped(/^a provider lacks a capability another provider has$/, (ctx) => {
    // aider (:parcel-driver true, :wake-style :shell-run-script) lacks
    // claude's capability shape entirely - a real, shipped asymmetry.
    ctx.withCapability = 'aider';
    ctx.withoutCapability = 'claude';
  });

  scoped(/^orchestration decides behavior for that provider$/, (ctx) => {
    ctx.withCapabilitySteps = runCli('wake-steps', ctx.withCapability);
    ctx.withoutCapabilitySteps = runCli('wake-steps', ctx.withoutCapability);
    // The "decided from the flag, not the brand" half of the claim:
    // declaring a synthetic provider with claude's OWN capability flags
    // must get claude's own decision, byte for byte.
    ctx.syntheticCopyOfWithoutSteps = runCli('wake-steps-as-synthetic-copy-of', ctx.withoutCapability, 'bl206-synthetic-claude-copy');
  });

  scoped(/^the decision reads the provider's capability flag, not its brand name$/, (ctx) => {
    assert.notDeepEqual(
      ctx.withCapabilitySteps,
      ctx.withoutCapabilitySteps,
      `expected ${ctx.withCapability} and ${ctx.withoutCapability} to decide different wake steps (different capability flags)`
    );
    assert.deepEqual(
      ctx.syntheticCopyOfWithoutSteps,
      ctx.withoutCapabilitySteps,
      `expected a synthetic provider declaring ${ctx.withoutCapability}'s own capability flags to decide identically to ${ctx.withoutCapability} - proof the decision reads the flag, not the literal brand name`
    );
  });

  // ── new-provider-is-capabilities-02 ─────────────────────────────────
  scoped(/^a new provider is declared with its capability flags$/, (ctx) => {
    ctx.newProviderResult = runCli('synthetic-provider-steps');
  });

  scoped(/^orchestration runs its lifecycle$/, () => {
    // The Given step above already ran the full lifecycle (wake-steps,
    // bootstrap-steps, needs-tmux-bootstrap) for the synthetic provider -
    // this step names the moment, nothing further to trigger.
  });

  scoped(/^no core orchestration function is edited to accommodate it$/, (ctx) => {
    // Proven structurally, not by diffing source: the synthetic provider
    // was declared ONLY as a capability-map entry (see the CLI shim's own
    // with-redefs), and the SAME unedited functions already produced a
    // coherent result for it - a chat-message wake, no tmux bootstrap
    // needed (embedded style), matching every other :chat-message/:embedded
    // provider's own shape with zero code change.
    const result = ctx.newProviderResult;
    assert.deepEqual(result.wakeSteps, [
      { op: 'send-literal', text: 'You have new handoff mail. If idle, run ready_for_next.sh.' },
      { op: 'submit' },
    ]);
    assert.deepEqual(result.bootstrapSteps, []);
    assert.ok(!result.needsTmuxBootstrap);
  });

  // ── lifecycle-verbs-03 ───────────────────────────────────────────────
  const VERB_TO_OP = { health: 'capture-pane', stop: 'kill-pane', respawn: 'respawn-pane' };

  scoped(/^a supported provider$/, (ctx) => {
    ctx.supportedProvider = 'claude';
  });

  scoped(/^orchestration requests the (health|stop|respawn) step for it$/, (ctx, verb) => {
    ctx.requestedVerb = verb;
    ctx.verbSteps = runCli('lifecycle-step', verb, ctx.supportedProvider);
  });

  scoped(/^a step is produced for that provider without brand-specific branching$/, (ctx) => {
    assert.ok(Array.isArray(ctx.verbSteps) && ctx.verbSteps.length > 0, `expected at least one step for ${ctx.requestedVerb}`);
    assert.equal(ctx.verbSteps[0].op, VERB_TO_OP[ctx.requestedVerb]);
    // "without brand-specific branching": the same verb call for a totally
    // different provider produces the identical step - proof there is no
    // per-agent branch inside health-steps/stop-steps/respawn-steps at all.
    const otherProviderSteps = runCli('lifecycle-step', ctx.requestedVerb, 'aider');
    assert.deepEqual(ctx.verbSteps, otherProviderSteps);
  });
}

module.exports = { registerSteps };
