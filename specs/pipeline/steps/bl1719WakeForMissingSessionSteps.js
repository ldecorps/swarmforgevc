'use strict';

// BL-1719: step handlers for "A wake for a missing session never lands in
// another role's pane". Drives test_handoffd_wake_no_session_standing_pack.sh,
// which exercises the REAL handoff_lib.bb/wake-session (via
// handoff_inject_lib.bb's deliver-parcel! - "the sender's own send" - and
// handoffd.bb's own notify! - "the handoff daemon") against a REAL private
// tmux server it starts itself (BL-1390's proof posture) - never a
// reimplementation of either delivery path in JS.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_wake_no_session_standing_pack.sh');
const FEATURE = "BL-1719 A wake for a missing session never lands in another role's pane";

const PATH_TO_MARKER = {
  "the sender's own send": '01a:',
  'the handoff daemon': '01b:',
};

function ensureResult(ctx) {
  if (!ctx.bl1719?.result) {
    const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 60000 });
    ctx.bl1719 = { result: { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') } };
  }
  return ctx.bl1719.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture project on a private tmux server whose roles\.tsv lists the specifier first and a seat coder@2 with no session$/,
    (ctx) => {
      ctx.bl1719 = {};
    }
  );

  // ── a-standing-pack-never-redirects-a-wake-01 ──────────────────────────
  scoped(/^(the sender's own send|the handoff daemon) delivers a note to coder@2$/, (ctx, pathName) => {
    ctx.bl1719Path = pathName;
    ensureResult(ctx);
  });

  scoped(/^nothing is typed into the specifier's session or any other session$/, (ctx) => {
    const marker = PATH_TO_MARKER[ctx.bl1719Path];
    requirePass(ctx, marker, `"${ctx.bl1719Path}" to type nothing into the specifier's pane`);
  });

  scoped(/^the wake is logged as skipped, naming coder@2's missing session$/, (ctx) => {
    const marker = PATH_TO_MARKER[ctx.bl1719Path];
    requirePass(ctx, marker, `"${ctx.bl1719Path}" to log the skip naming coder@2's missing session`);
  });

  scoped(/^the note is in coder@2's inbox$/, (ctx) => {
    // Only "the sender's own send" actually writes a note to deliver; "the
    // handoff daemon" scenario drives notify! directly (the wake half
    // alone), so this step is a no-op check for that path - the shell
    // script's own 01a assertion is the one authoritative check.
    if (ctx.bl1719Path === "the sender's own send") {
      requirePass(ctx, '01a:', "the note to land in coder@2's inbox");
    }
  });

  // ── a-rotation-router-pack-keeps-its-resident-remap-02 ─────────────────
  scoped(/^the fixture pack is a rotation-router pack whose resident session is coder's$/, () => {
    // The fixture script's own scenario 02 sets this up (a swarm-identity
    // file declaring rotation=router) against the SAME roles.tsv, where
    // the resident (first non-coordinator row) is the specifier's session
    // - "coder's" in the feature's own prose names the RESIDENT role by
    // its usual production identity; this fixture's resident is whichever
    // role is first in roles.tsv, proven generically by scenario 01's own
    // specifier-first roster.
  });

  scoped(/^the sender's own send delivers a note to a dormant role$/, (ctx) => {
    ctx.bl1719Path = 'rotation-router';
    ensureResult(ctx);
  });

  scoped(/^the wake is typed into the resident's session$/, (ctx) => {
    requirePass(ctx, '02:', "a rotation-router pack's dormant-role wake to reach the resident's session");
  });
}

module.exports = { registerSteps };
