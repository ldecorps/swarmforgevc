'use strict';

// BL-1720: step handlers for "A seat dropped mid-shift stays dropped".
// Drives test_retire_seat_stays_dropped.sh, which exercises the REAL
// retire_seat.sh (scenario 01), the REAL babysitter_check.sh (scenario 02),
// and the REAL reverse-hop-lib/reverse-recipients (scenario 03, via a
// thin probe) against a REAL private tmux server it starts itself
// (BL-1390's proof posture) - never a reimplementation of any of the
// three.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_retire_seat_stays_dropped.sh');
const FEATURE = "BL-1720 A seat dropped mid-shift stays dropped";

function ensureResult(ctx) {
  if (!ctx.bl1720?.result) {
    const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 60000 });
    ctx.bl1720 = { result: { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') } };
  }
  return ctx.bl1720.result;
}

function requirePass(ctx, description, matcher) {
  const { stdout } = ensureResult(ctx);
  if (!matcher.test(stdout)) {
    throw new Error(`expected ${description}:\n${stdout}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture swarm on a private tmux server whose roster lists coder and coder@2 in the master roles\.tsv, sessions\.tsv and every worktree copy$/,
    (ctx) => {
      ctx.bl1720 = {};
    }
  );

  // ── retiring-a-seat-reaches-every-roster-copy-01 ───────────────────────
  scoped(/^coder@2 is retired$/, (ctx) => {
    ensureResult(ctx);
  });

  scoped(/^no roles\.tsv, worktree copy included, and no sessions\.tsv lists coder@2$/, (ctx) => {
    requirePass(
      ctx,
      'no roles.tsv or sessions.tsv copy to list coder@2 after retirement',
      /PASS: 01: no roles\.tsv.*coder@2[\s\S]*PASS: 01: sessions\.tsv no longer lists coder@2/
    );
  });

  scoped(/^coder@2's session is gone$/, (ctx) => {
    requirePass(ctx, "coder@2's tmux session to be gone", /PASS: 01: coder@2's session is gone/);
  });

  // ── a-retired-seat-is-not-resurrected-02 ────────────────────────────────
  scoped(/^coder@2 has been retired$/, (ctx) => {
    ensureResult(ctx);
  });

  scoped(/^the babysitter's sweep runs$/, (ctx) => {
    ensureResult(ctx);
  });

  scoped(/^no session is created for coder@2$/, (ctx) => {
    requirePass(ctx, 'no session created for coder@2 by the babysitter sweep', /PASS: 02: no session is created for coder@2/);
  });

  // ── a-retired-seat-is-not-addressed-03 ─────────────────────────────────
  scoped(/^the architect's worktree sends a git_handoff forward under back-all$/, (ctx) => {
    ensureResult(ctx);
  });

  scoped(/^no copy of it is addressed to coder@2$/, (ctx) => {
    requirePass(
      ctx,
      'no back-all copy from architect addressed to coder@2',
      /PASS: 03: no copy of a back-all send from architect's worktree is addressed to coder@2/
    );
  });
}

module.exports = { registerSteps };
