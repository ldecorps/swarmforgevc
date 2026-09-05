'use strict';

// BL-1411: step handlers for "a forward built on an amended acceptance
// contract is refused at the send". Every scenario drives the REAL send
// path - swarm_handoff.sh over a real two-checkout git fixture, via
// lib/bl1411ContractFreshnessGateCli.sh - never the gate lib in isolation.
// Mirrors bl1192TaskScopeGateCli.sh/bl1240UnregisteredTestGateCli.sh's own
// convention: a gate that decides correctly and is not wired in refuses
// nothing, and a scenario that called the decision directly would report
// green for exactly that (BL-1235).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1411 A forward built on an amended acceptance contract is refused at the send';
const CLI = path.join(__dirname, 'lib', 'bl1411ContractFreshnessGateCli.sh');

function run(mode) {
  const out = execFileSync('bash', [CLI, mode], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository whose main branch carries ticket BL-9001 and its acceptance feature file$/, (ctx) => {
    ctx.bl1411 = {};
  });

  scoped(/^a sender worktree branched from main holding a commit for BL-9001$/, (ctx) => {
    ctx.bl1411.mode = 'unchanged';
  });

  // ── 01 (Background alone is enough) ─────────────────────────────────────
  scoped(/^the sender sends a git_handoff for BL-9001 naming that commit$/, (ctx) => {
    const st = ctx.bl1411;
    assert.ok(st.mode, 'the scenario set no fixture mode');
    st.result = run(st.mode);
  });

  scoped(/^the handoff is queued$/, (ctx) => {
    const { result } = ctx.bl1411;
    assert.equal(result.exitCode, 0, `expected the handoff queued, got: ${JSON.stringify(result)}`);
    assert.equal(result.delivered, true, `expected delivery, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the output carries no contract-amended refusal$/, (ctx) => {
    const { result } = ctx.bl1411;
    assert.ok(
      !result.stderr.includes('CONTRACT_AMENDED_SINCE_BASE'),
      `expected no contract-amended refusal, got: ${result.stderr}`
    );
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^main amended BL-9001's acceptance feature file after the sender branched$/, (ctx) => {
    ctx.bl1411.mode = 'amended';
  });

  scoped(/^the handoff is not queued$/, (ctx) => {
    const { result } = ctx.bl1411;
    assert.notEqual(result.exitCode, 0, `expected the handoff refused, got: ${JSON.stringify(result)}`);
    assert.equal(result.delivered, false, `expected no delivery, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the refusal names the amending commit, the feature path and the remedy to merge main and send again$/, (ctx) => {
    const { result } = ctx.bl1411;
    assert.match(result.stderr, /CONTRACT_AMENDED_SINCE_BASE/, `missing marker: ${result.stderr}`);
    assert.match(result.stderr, /HANDOFF_NOT_QUEUED/, `missing HANDOFF_NOT_QUEUED: ${result.stderr}`);
    assert.match(result.stderr, /specs\/features\/BL-9001-fixture\.feature/, `missing path: ${result.stderr}`);
    assert.match(result.stderr, /amended on main by [0-9a-f]{7,}/, `missing amending commit: ${result.stderr}`);
    assert.match(result.stderr, /merge main .* send again/i, `missing remedy: ${result.stderr}`);
  });

  // ── 03 (Scenario Outline) — one exact literal per Examples row, per the
  // Scenario Outline handler rule (explicit KNOWN_VALUES, never a
  // passthrough/catch-all regex). ────────────────────────────────────────
  scoped(/^the sender's own commit rewrote the feature file's header and main is untouched$/, (ctx) => {
    ctx.bl1411 = ctx.bl1411 || {};
    ctx.bl1411.mode = 'own-header-rewrite';
  });

  scoped(/^main amended the feature file and the sender merged main before committing$/, (ctx) => {
    ctx.bl1411 = ctx.bl1411 || {};
    ctx.bl1411.mode = 'merged-first';
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^BL-9001's acceptance path does not exist on main$/, (ctx) => {
    ctx.bl1411.mode = 'path-absent';
  });

  scoped(/^the output states that the contract freshness check was not evaluated and why$/, (ctx) => {
    const { result } = ctx.bl1411;
    assert.match(
      result.stderr,
      /CONTRACT_FRESHNESS_NOT_EVALUATED:.*is absent on main/,
      `expected a not-evaluated line naming the reason: ${result.stderr}`
    );
  });
}

module.exports = { registerSteps };
