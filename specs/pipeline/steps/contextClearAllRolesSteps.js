'use strict';

// BL-316: step handlers for "Every current-roster role's context is
// cleared at its own safe idle boundary". The pure decision
// (closing_context_clear_lib.bb) is UNCHANGED from BL-309 and already
// generic over role-name, so scenarios 01/02/03/06 (idle/in-process/
// pending-inbox/dedup) reuse the SAME closing_context_clear_harness.bb
// closingContextClearSteps.js already drives - one pure decision, proven
// once, reused for both the coordinator-only feature and this
// generalized one. Scenarios 04/05 (batch-whole-landing trigger, absent-
// role exclusion) are specifically about the NEW impure wiring in
// handoffd.bb (latest-completed-entry-id/role-context-clear-sweep!), which
// - like the coordinator's own equivalent helpers BL-309 never extracted
// to a separate pure lib either - is proven only against the real daemon;
// these two scenarios invoke swarmforge/scripts/test/
// test_handoffd_role_context_clear_wiring.sh as a subprocess (mirroring
// coordinatorInfraTestConfigLeakSteps.js's own "drive the real shell test"
// pattern) rather than re-implementing its daemon-fixture setup here.
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'closing_context_clear_harness.bb');
const ROLE_WIRING_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_handoffd_role_context_clear_wiring.sh');

function runHarness(idle, closedTicketId, lastClearedTicketId) {
  const out = execFileSync(
    'bb',
    [HARNESS, idle ? 'true' : 'false', closedTicketId || '-', lastClearedTicketId || '-'],
    { encoding: 'utf8' }
  );
  return JSON.parse(out);
}

function runRoleWiringTest() {
  const result = spawnSync('bash', [ROLE_WIRING_TEST], { encoding: 'utf8', timeout: 60000 });
  return (result.stdout || '') + (result.stderr || '');
}

function registerSteps(registry) {
  // ── context-clear-all-roles-01 ──────────────────────────────────────
  registry.define(/^a current-roster role just completed a task and is idle$/, (ctx) => {
    ctx.closedTicketId = 'completion-1';
    ctx.lastClearedTicketId = null;
    ctx.idle = true;
  });

  registry.define(/^the runtime evaluates the context-clear sweep$/, (ctx) => {
    ctx.result = runHarness(ctx.idle, ctx.closedTicketId, ctx.lastClearedTicketId);
  });

  registry.define(/^a clear is injected into that role's pane followed by the startup re-read instruction$/, (ctx) => {
    const ops = ctx.result.calls.map((c) => c.op);
    const clearIdx = ops.indexOf('inject-clear');
    const rereadIdx = ops.indexOf('inject-startup-reread');
    if (ctx.result.action !== 'clear' || clearIdx === -1 || rereadIdx !== clearIdx + 1) {
      throw new Error(`expected a clear followed immediately by the startup re-read, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── context-clear-all-roles-02/03 ───────────────────────────────────
  registry.define(/^a current-roster role holds an in-process task$/, (ctx) => {
    ctx.closedTicketId = 'completion-1';
    ctx.lastClearedTicketId = null;
    ctx.idle = false;
  });

  registry.define(/^a current-roster role has a pending item in its inbox$/, (ctx) => {
    ctx.closedTicketId = 'completion-1';
    ctx.lastClearedTicketId = null;
    ctx.idle = false;
  });

  registry.define(/^no clear is injected for that role$/, (ctx) => {
    if (ctx.result.action === 'clear' || ctx.result.calls.length !== 0) {
      throw new Error(`expected no clear injected, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── context-clear-all-roles-04 ──────────────────────────────────────
  registry.define(/^a batch role's whole batch just landed in inbox\/completed\/ and the role is idle$/, () => {
    // Fixtured entirely inside the real shell test below.
  });

  registry.define(/^a clear is injected into that role's pane$/, (ctx) => {
    ctx.roleWiringOutput = ctx.roleWiringOutput || runRoleWiringTest();
    if (!/context-clear-all-roles-04: a batch role's trigger is its whole batch landing/.test(ctx.roleWiringOutput)) {
      throw new Error(`expected the real daemon to clear a batch role on its whole-batch completion, got: ${ctx.roleWiringOutput}`);
    }
  });

  // ── context-clear-all-roles-05 ──────────────────────────────────────
  registry.define(/^a role is absent from the current roster$/, () => {
    // Fixtured entirely inside the real shell test below (documenter/QA
    // are never listed in that fixture's roles.tsv at all).
  });

  registry.define(/^that role is never cleared$/, (ctx) => {
    ctx.roleWiringOutput = ctx.roleWiringOutput || runRoleWiringTest();
    if (!/ALL PASS/.test(ctx.roleWiringOutput)) {
      throw new Error(`expected the real daemon wiring test to pass in full, got: ${ctx.roleWiringOutput}`);
    }
  });

  // ── context-clear-all-roles-06 ──────────────────────────────────────
  registry.define(/^a clear was already issued for a role's most recent completion$/, (ctx) => {
    ctx.closedTicketId = 'completion-1';
    ctx.lastClearedTicketId = 'completion-1';
    ctx.idle = true;
  });

  registry.define(/^the runtime evaluates the context-clear sweep again with no new completion$/, (ctx) => {
    ctx.result = runHarness(ctx.idle, ctx.closedTicketId, ctx.lastClearedTicketId);
  });

  registry.define(/^no second clear is injected for that role$/, (ctx) => {
    if (ctx.result.action === 'clear' || ctx.result.calls.length !== 0) {
      throw new Error(`expected no second clear injected, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
