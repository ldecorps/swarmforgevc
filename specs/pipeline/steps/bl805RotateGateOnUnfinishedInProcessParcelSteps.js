'use strict';

// BL-805: step handlers for "resident-invoked rotation is gated on a
// drained in_process box". Drives test_rotate_to_role_stuck_parcel_gate.sh,
// which exercises the REAL rotate_to_role.sh / handoff_lib.bb against a
// disposable fixture git repo (fake tmux) - never a parallel reimplementation
// of the gate logic.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_rotate_to_role_stuck_parcel_gate.sh');
const FEATURE = 'BL-805 resident-invoked rotation is gated on a drained in_process box';

const BOX_STATE_TO_SCENARIO = {
  'a handoff file': 'handoff-present',
  'no files': 'empty',
  'only a claim-progress sidecar file': 'sidecar-only',
};

function runGateTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl805?.result) {
    ctx.bl805 = { ...(ctx.bl805 || {}), result: runGateTest() };
  }
  return ctx.bl805.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^a fixture project root with a \.swarmforge directory$/, (ctx) => {
    ctx.bl805 = {};
  }, FEATURE);

  registry.defineScoped(/^the active-role marker names a departing role with a mailbox$/, () => {
    // Fixture background, established by test_rotate_to_role_stuck_parcel_gate.sh
    // itself (mono-router-active-role marker + roles.tsv) for every scenario.
  }, FEATURE);

  // BL-805: the three "inbox in_process contains ..." Givens are one
  // parameterized step family over distinct box states, not three
  // divergently-worded steps - IR-DRY's possible-synonym check is resolved
  // by this single step definition (see the ticket's own notes).
  registry.defineScoped(
    /^the departing role's inbox in_process contains (a handoff file|no files|only a claim-progress sidecar file)$/,
    (ctx, boxState) => {
      const scenario = BOX_STATE_TO_SCENARIO[boxState];
      ctx.bl805 = { ...(ctx.bl805 || {}), scenario };
    },
    FEATURE
  );

  registry.defineScoped(/^the rotation force override is set$/, (ctx) => {
    ctx.bl805 = { ...(ctx.bl805 || {}), forceOverride: true };
  }, FEATURE);

  registry.defineScoped(/^the resident invokes the rotation entry$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the handoff daemon rotates the resident through its own rotation path$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the rotation is refused with a nonzero exit$/, (ctx) => {
    requirePass(ctx, '01:', 'refusal with a nonzero exit while the departing role holds an unfinished parcel');
  }, FEATURE);

  registry.defineScoped(/^the refusal names done_with_current\.sh as the required step$/, (ctx) => {
    requirePass(ctx, '01:', 'the refusal naming done_with_current.sh');
  }, FEATURE);

  registry.defineScoped(/^the pane is not respawned$/, (ctx) => {
    requirePass(ctx, '01:', 'no respawn-pane call on refusal');
  }, FEATURE);

  registry.defineScoped(/^the rotation proceeds$/, (ctx) => {
    const marker = {
      empty: '02:',
      'sidecar-only': '03:',
      'handoff-present': ctx.bl805?.forceOverride ? '05:' : '04:',
    }[ctx.bl805?.scenario];
    if (!marker) {
      throw new Error(`BL-805: unrecognized scenario for "the rotation proceeds": ${JSON.stringify(ctx.bl805)}`);
    }
    requirePass(ctx, marker, 'the rotation to proceed');
  }, FEATURE);

  registry.defineScoped(/^a warning names the stuck parcel left behind$/, (ctx) => {
    requirePass(ctx, '05:', 'a loud warning naming the stuck parcel left behind');
  }, FEATURE);
}

module.exports = { registerSteps };
