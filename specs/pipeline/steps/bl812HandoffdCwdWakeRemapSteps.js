'use strict';

// BL-812: handoffd receives its project root on argv, but handoff-lib used
// to resolve target-root-scoped state (roles.tsv, mono-router-active-role,
// tmux-socket, launch scripts) from process cwd via `git rev-parse
// --git-common-dir`. Under a foreign daemon cwd every one of those reads
// silently resolved against the wrong root, so the resident looked absent
// and chase degraded to waking a session mono-router never creates.
//
// Drives test_handoffd_bl812_cwd_invariant_root_resolution.sh, which
// exercises the REAL handoff_lib.bb (via bl812_root_probe.bb, never a
// reimplementation) from a genuinely separate process with a foreign cwd:
//   - scenarios 01a-01e: the five root-scoped reads (Scenario Outline)
//   - scenario 02: wake-session remaps a dormant role to the resident
//   - scenario 03: wake-session is identical from the project cwd and a
//     foreign cwd
//   - scenario 04: rotate-resident-to! (the exact respawn action chase
//     performs once it has decided to poke a role - the decision logic
//     itself is untouched by BL-812, which fixes only root resolution)
//     respawns the resident onto the target role's launch script, and no
//     send-literal (chase-wake-error's failure mode) is ever attempted
//     against the nonexistent dormant session
//   - scenario 05: the regression guard - a caller that never calls
//     set-project-root! (rotate_to_role.bb, operator_runtime.bb,
//     operator_lib.bb) still resolves via git-common-dir, unchanged

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_bl812_cwd_invariant_root_resolution.sh'
);
const FEATURE = 'BL-812 handoffd cwd breaks mono-router wake remap';

const READ_TO_MARKER = {
  'the mono-router resident session': '01a:',
  'the mono-router home role': '01b:',
  'the mono-router active role': '01c:',
  'the tmux socket path': '01d:',
  'the launch script for architect': '01e:',
};

function ensureResult(ctx) {
  if (!ctx.bl812?.result) {
    const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
    ctx.bl812 = {
      ...(ctx.bl812 || {}),
      result: { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') },
    };
  }
  return ctx.bl812.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a mono-router project root whose roles\.tsv names the coordinator and the resident session "([^"]+)"$/,
    (ctx) => { ctx.bl812 = {}; },
    FEATURE
  );
  registry.defineScoped(/^that project root has a launch script for every pipeline role$/, () => {}, FEATURE);
  registry.defineScoped(/^handoffd is started with that project root as its argv project-root$/, () => {}, FEATURE);
  registry.defineScoped(/^handoffd's process cwd is a directory outside that project root$/, () => {}, FEATURE);

  // ── Scenario Outline 01: root-scoped state resolves from argv root ─────
  registry.defineScoped(/^handoffd resolves (.+)$/, (ctx, readName) => {
    const st = ctx.bl812 = ctx.bl812 || {};
    st.currentRead = readName;
  }, FEATURE);

  // Shared by both the Scenario Outline (currentRead set by "handoffd
  // resolves <root_scoped_read>") and scenario 05's own "it resolves to
  // swarmforge-coder" - scenario 05 never sets currentRead, so its absence
  // is exactly how this handler tells the two apart.
  registry.defineScoped(/^it resolves to (.+)$/, (ctx, expected) => {
    const readName = ctx.bl812?.currentRead;
    if (!readName) {
      requirePass(ctx, '05:', `the regression-guard resolution to return ${expected}`);
      return;
    }
    const marker = READ_TO_MARKER[readName];
    if (!marker) {
      throw new Error(`BL-812: unrecognized root-scoped read: ${JSON.stringify(readName)}`);
    }
    requirePass(ctx, marker, `"${readName}" to resolve to ${expected}`);
  }, FEATURE);

  registry.defineScoped(/^it does not resolve under handoffd's cwd$/, (ctx) => {
    const readName = ctx.bl812?.currentRead;
    const marker = READ_TO_MARKER[readName];
    if (marker) {
      requirePass(ctx, marker, `"${readName}" to avoid resolving under the foreign cwd`);
    }
    // Scenarios whose read has no cwd-substring assertion in the fixture
    // (home role / active role: bare role names, never a path) are covered
    // by the same PASS marker's expected-value check above - a bare role
    // name cannot "resolve under" a cwd path in the first place.
  }, FEATURE);

  // ── Scenario 02 ──────────────────────────────────────────────────────────
  registry.defineScoped(/^only the resident and coordinator tmux sessions exist$/, () => {}, FEATURE);

  registry.defineScoped(/^handoffd resolves the wake session for the architect session name$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the wake session is swarmforge-coder$/, (ctx) => {
    requirePass(ctx, '02:', "the architect session name's wake to remap to swarmforge-coder");
  }, FEATURE);

  registry.defineScoped(/^no wake is addressed to swarmforge-architect$/, (ctx) => {
    requirePass(ctx, '02:', 'no wake addressed to swarmforge-architect');
  }, FEATURE);

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the wake session for the hardender session name is resolved from the project root cwd$/,
    (ctx) => { ensureResult(ctx); },
    FEATURE
  );
  registry.defineScoped(
    /^the wake session for the hardender session name is resolved from a foreign cwd$/,
    (ctx) => { ensureResult(ctx); },
    FEATURE
  );
  registry.defineScoped(/^both resolutions return the same session name$/, (ctx) => {
    requirePass(ctx, '03:', 'the wake remap to be identical from the project cwd and a foreign cwd');
  }, FEATURE);

  // ── Scenario 04 ──────────────────────────────────────────────────────────
  registry.defineScoped(/^the architect inbox holds an actionable git_handoff$/, () => {}, FEATURE);
  registry.defineScoped(/^the mono-router active role is coder$/, () => {}, FEATURE);

  registry.defineScoped(/^the chase sweep pokes architect$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the resident pane is respawned with the project's architect launch script$/, (ctx) => {
    requirePass(ctx, '04:', "the resident pane to respawn running the project's architect.sh");
  }, FEATURE);

  registry.defineScoped(/^no chase-wake-error naming swarmforge-architect is logged for that poke$/, (ctx) => {
    requirePass(ctx, '04:', 'no chase-wake-error / send-literal attempt against swarmforge-architect');
  }, FEATURE);

  // ── Scenario 05 (regression guard) ─────────────────────────────────────
  registry.defineScoped(
    /^a separate resident-invoked rotation process that sets no explicit project root$/,
    () => {},
    FEATURE
  );
  registry.defineScoped(
    /^that process runs with its cwd inside the architect linked worktree of that project$/,
    () => {},
    FEATURE
  );
  registry.defineScoped(/^it resolves the mono-router resident session$/, (ctx) => {
    ensureResult(ctx);
  }, FEATURE);
  // "it resolves to swarmforge-coder" (scenario 05's Then) is handled by the
  // shared "it resolves to (.+)" registration above.
}

module.exports = { registerSteps };
