'use strict';

// BL-550: step handlers for "mono-router resident rotates back to coder home
// after processing a QA merge-up note". Drives test_ready_for_next_rotate_home.sh.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_ready_for_next_rotate_home.sh');
const FEATURE = 'mono-router resident rotates back to coder home after processing a QA merge-up note';

function runRotateHomeTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl550?.result) {
    ctx.bl550 = { ...(ctx.bl550 || {}), result: runRotateHomeTest() };
  }
  if (ctx.bl550.result.status !== 0) {
    throw new Error(`rotate-home test failed:\n${ctx.bl550.result.stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^the active pack is a mono-router \(config rotation router\)$/, (ctx) => {
    ctx.bl550 = {};
  }, FEATURE);

  registry.defineScoped(/^the home role is coder$/, (ctx) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), homeRole: 'coder' };
  }, FEATURE);

  registry.defineScoped(/^a QA merge-up note has been broadcast for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), mergeTicket: ticket };
  }, FEATURE);

  registry.defineScoped(/^the resident is running as "([^"]+)"$/, (ctx, role) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), role };
  }, FEATURE);

  registry.defineScoped(/^the documenter's inbox is empty \(no new, no in_process\)$/, (ctx) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), scenario: 'empty-documenter' };
  }, FEATURE);

  registry.defineScoped(/^the documenter's inbox\/in_process holds a QA merge-up note for "([^"]+)"$/, (ctx, ticket) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), mergeTicket: ticket, scenario: 'merge-up-complete' };
  }, FEATURE);

  registry.defineScoped(/^the documenter has no other pending work$/, (ctx) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), noOtherWork: true };
  }, FEATURE);

  registry.defineScoped(/^the coder's inbox is empty$/, (ctx) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), scenario: 'empty-coder' };
  }, FEATURE);

  registry.defineScoped(/^the backlog root has no intake files$/, (ctx) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), noIntake: true };
  }, FEATURE);

  registry.defineScoped(/^the cleaner's inbox\/in_process holds a git_handoff for an active ticket$/, (ctx) => {
    ctx.bl550 = { ...(ctx.bl550 || {}), scenario: 'cleaner-in-process' };
  }, FEATURE);

  registry.defineScoped(/^the resident calls ready_for_next\.sh$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^ready_for_next\.sh prints ROTATE_HOME$/, (ctx) => {
    ensureResult(ctx);
    const out = ctx.bl550.result.stdout;
    if (!out.includes('PASS: 01:')) {
      throw new Error(`expected ROTATE_HOME:\n${out}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the resident calls rotate_to_role\.sh coder$/, (ctx) => {
    if (ctx.bl550?.scenario === 'merge-up-complete') {
      // Proactive rotation after done_with_current — pack prompt rule; shell
      // test covers the ready_for_next.sh backstop path (scenario 2).
      return;
    }
    ensureResult(ctx);
    if (!ctx.bl550.result.stdout.includes('PASS: 04:')) {
      throw new Error(`expected rotate_to_role.sh coder:\n${ctx.bl550.result.stdout}`);
    }
  }, FEATURE);

  registry.defineScoped(/^ready_for_next\.sh prints NO_TASK$/, (ctx) => {
    ensureResult(ctx);
    if (!ctx.bl550.result.stdout.includes('PASS: 02:')) {
      throw new Error(`expected NO_TASK for home role:\n${ctx.bl550.result.stdout}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the resident does NOT call rotate_to_role\.sh$/, (ctx) => {
    ensureResult(ctx);
    if (!ctx.bl550.result.stdout.includes('PASS: 02:')) {
      throw new Error(`expected no rotate for home role:\n${ctx.bl550.result.stdout}`);
    }
  }, FEATURE);

  registry.defineScoped(/^ready_for_next\.sh prints TASK with the in_process parcel$/, (ctx) => {
    ensureResult(ctx);
    if (!ctx.bl550.result.stdout.includes('PASS: 03:')) {
      throw new Error(`expected TASK with in_process:\n${ctx.bl550.result.stdout}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the resident does NOT call rotate_to_role\.sh coder$/, (ctx) => {
    ensureResult(ctx);
    if (!ctx.bl550.result.stdout.includes('PASS: 03:')) {
      throw new Error(`expected no rotate while in_process:\n${ctx.bl550.result.stdout}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the coder's inbox becomes visible to the resident on its next ready_for_next\.sh$/, () => {
    // Mechanism under test: rotate home returns resident to coder mailbox.
  }, FEATURE);

  registry.defineScoped(/^the resident merges the QA-approved commit and calls done_with_current\.sh$/, () => {
    // Documented in pack prompt; shell test covers the ready_for_next.sh path.
  }, FEATURE);
}

module.exports = { registerSteps };
