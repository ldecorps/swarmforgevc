'use strict';

// BL-911: step handlers for "a rotating role boots on a prompt composed
// from the current sources, not the one built at launch". Drives the REAL
// rotate_to_role.sh / handoff_lib.bb's rotate-resident-to! against a
// disposable fixture git repo (fake tmux) - never a parallel
// reimplementation of the recompose logic - via
// test_rotate_recomposes_role_prompt.sh, same established pattern as
// bl805RotateGateOnUnfinishedInProcessParcelSteps.js. The whole fixture
// runs ONCE per acceptance run (memoized on ctx) and every step below just
// checks for its own `PASS: NN:` marker in that one run's output.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_rotate_recomposes_role_prompt.sh');
const FEATURE = 'A rotating role boots on a prompt composed from the current sources, not the one built at launch';

// KNOWN_VALUES (engineering.prompt's Acceptance Pipeline rule): <source> and
// <driver> are this handler's lookup keys - an unrecognized value throws
// rather than silently falling through a scenario-SHAPE branch, so a
// mutated Examples cell fails loudly here instead of surviving.
const KNOWN_SOURCES = new Set(['the role prompt', 'an inlined constitution article', 'the pipeline article']);
const KNOWN_DRIVERS = new Set(['the resident', "the daemon's chase"]);

function knownSource(source) {
  if (!KNOWN_SOURCES.has(source)) {
    throw new Error(`BL-911: unrecognized source "${source}"`);
  }
  return source;
}

function knownDriver(driver) {
  if (!KNOWN_DRIVERS.has(driver)) {
    throw new Error(`BL-911: unrecognized driver "${driver}"`);
  }
  return driver;
}

function runFixture() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl911?.result) {
    ctx.bl911 = { ...(ctx.bl911 || {}), result: runFixture() };
  }
  return ctx.bl911.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}:`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

// Both Scenario Outlines' resident row exercise the identical physical
// rotation (recompose via the resident-invoked path) that the fixture's
// marker "01" proves - Outline 1's three <source> examples all land in the
// same one compose call, and Outline 2's "the resident" row is that same
// call viewed through the <driver> column. This is the IR-DRY-resolved
// sharing the ticket's own notes call out ("the resident and daemon
// rotations share one step text (and one handler)").
function markerFor(ctx) {
  if (ctx.bl911?.compositionFails) return '03';
  if (ctx.bl911?.noChange) return '04';
  if (ctx.bl911?.driver === "the daemon's chase") return '02';
  return '01';
}

function registerSteps(registry) {
  registry.defineScoped(/^a swarm whose roles were composed at an earlier commit$/, (ctx) => {
    ctx.bl911 = {};
  }, FEATURE);

  registry.defineScoped(/^"([^"]+)" carries a rule the running swarm was not composed with$/, (ctx, source) => {
    ctx.bl911 = { ...(ctx.bl911 || {}), source: knownSource(source) };
  }, FEATURE);

  registry.defineScoped(/^the sources for "([^"]+)" cannot be composed$/, (ctx, role) => {
    ctx.bl911 = { ...(ctx.bl911 || {}), role, compositionFails: true };
  }, FEATURE);

  registry.defineScoped(/^no source for "([^"]+)" has changed since the swarm was composed$/, (ctx, role) => {
    ctx.bl911 = { ...(ctx.bl911 || {}), role, noChange: true };
  }, FEATURE);

  registry.defineScoped(/^the rotation to "([^"]+)" is driven by "([^"]+)"$/, (ctx, role, driver) => {
    ctx.bl911 = { ...(ctx.bl911 || {}), role, driver: knownDriver(driver) };
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the prompt "([^"]+)" boots on carries that rule$/, (ctx) => {
    requirePass(ctx, markerFor(ctx), 'the recomposed prompt to carry the landed rule');
  }, FEATURE);

  registry.defineScoped(/^the prompt "([^"]+)" boots on carries everything it carried before$/, (ctx) => {
    requirePass(ctx, markerFor(ctx), 'the prompt to carry everything it carried before');
  }, FEATURE);

  registry.defineScoped(/^the rotation still completes$/, (ctx) => {
    requirePass(ctx, markerFor(ctx), 'the rotation to still complete despite a composition failure');
  }, FEATURE);

  registry.defineScoped(/^the composition failure is reported$/, (ctx) => {
    requirePass(ctx, markerFor(ctx), 'the composition failure to be reported');
  }, FEATURE);
}

module.exports = { registerSteps };
