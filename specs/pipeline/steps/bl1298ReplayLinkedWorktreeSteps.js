'use strict';

// BL-1298: the land step's tip-pure replay must run from the worktree the
// caller is actually standing in.
//
// `.git` is a DIRECTORY only in the MAIN checkout. In a linked worktree - the
// only place a pipeline role ever works - it is a FILE holding `gitdir: ...`,
// so a scratch path built by joining ".git" onto the root named a child of a
// regular file and `git worktree add` failed outright. Measured 2026-08-30
// landing BL-1295 from `.worktrees/QA`, whose `.git` is a 54-byte ASCII file.
//
// The same failed attempt also leaked its scratch branch: `git worktree add
// -b` creates the branch and only THEN fails to make the checkout (verified
// against git directly), and the create-failure path returned without
// deleting it. The retry then failed for a reason the first attempt did not
// have, sending its reader after the wrong defect.
//
// Every scenario runs the REAL land_step_cli.bb over a REAL repository with a
// REAL bare origin and a REAL linked worktree, through
// lib/bl1298ReplayWorktreeFixtureCli.sh, and invokes it with NO repo-root
// argument - the master-checkout third argument is exactly the undocumented
// workaround this ticket removes the need for. A fixture that mocked the git
// layer could not exhibit the defect at all: it is entirely about what git
// reports for a path on disk.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1298ReplayWorktreeFixtureCli.sh');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TMP_PREFIX = 'bl1298-';

// The ticket's own path in the fixture, and the sibling's. The replayed tree
// must hold the first and not the second.
const OWN_PATH = 'own.txt';
const SIBLING_PATH = 'sib.txt';

// The feature's words for a checkout, and the fixture mode each one names.
// Validated explicitly rather than passed through: an Examples row the
// fixture does not understand must fail loudly, never run something else.
const CHECKOUTS = {
  'the main checkout': 'main-checkout',
  'a linked worktree': 'linked-worktree',
};

function modeForCheckout(word) {
  const mode = CHECKOUTS[word];
  if (!mode) {
    throw new Error(
      `unknown checkout "${word}" - known values: ${Object.keys(CHECKOUTS).join(', ')}`
    );
  }
  return mode;
}

// A killed run traps nothing, so fixture roots are swept by prefix BEFORE the
// run as well as removed in a finally after it (BL-971).
function sweepStaleFixtureRoots() {
  const dir = os.tmpdir();
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(TMP_PREFIX)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

function runLandStep(mode) {
  sweepStaleFixtureRoots();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, mode], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    // The fixture registers a linked worktree inside `work`; removing the
    // tree removes the whole repository with it, so nothing survives to be
    // pruned later.
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a repository whose approved commit is entangled with an unlanded sibling$/,
    (ctx) => {
      // The fixture builds this shape for every mode, so the Background
      // records what the scenario is entitled to assume rather than building
      // a second repository the When would then ignore.
      ctx.bl1298 = { entangledSibling: 'BL-9002', ownPath: OWN_PATH };
    }
  );

  // ── 01 ───────────────────────────────────────────────────────────────
  registry.define(/^the land step is invoked from (.+)$/, (ctx, checkout) => {
    ctx.bl1298.mode = modeForCheckout(checkout);
    ctx.bl1298.checkout = checkout;
  });

  registry.define(/^the land step replays the ticket's own paths onto origin\/main$/, (ctx) => {
    ctx.bl1298.result = runLandStep(ctx.bl1298.mode);
  });

  registry.define(/^the replay reports a tip-pure commit for the ticket$/, (ctx) => {
    const r = ctx.bl1298.result;
    assert.equal(
      r.action,
      'LAND_REPLAY',
      `the land step invoked from ${ctx.bl1298.checkout} did not replay: ${r.out}`
    );
    assert.equal(r.exit, 0, `the land step exited ${r.exit}: ${r.out}`);
    assert.notEqual(r.replayCommit, '', 'the replay reported no commit');
    // Tip-pure means the commit sits directly on origin/main, so the
    // entangled tip is not an ancestor of what QA would land.
    assert.equal(
      r.replayParent,
      r.originMain,
      'the replay commit is not parented on origin/main, so it is not tip-pure'
    );
  });

  registry.define(/^the replayed tree holds exactly the ticket's own paths$/, (ctx) => {
    const paths = ctx.bl1298.result.replayedPaths;
    assert.deepEqual(
      paths,
      [OWN_PATH],
      `the replayed tree from ${ctx.bl1298.checkout} holds ${JSON.stringify(paths)}`
    );
    assert.ok(
      !paths.includes(SIBLING_PATH),
      "the replayed tree carries the unlanded sibling's path"
    );
  });

  // ── 02 ───────────────────────────────────────────────────────────────
  registry.define(/^the replay cannot create its scratch checkout$/, (ctx) => {
    ctx.bl1298.mode = 'create-fails';
  });

  registry.define(/^the land step reports the failure$/, (ctx) => {
    ctx.bl1298.result = runLandStep(ctx.bl1298.mode);
    const r = ctx.bl1298.result;
    // Non-vacuity: the scenario is only about a FAILED create, so a run that
    // succeeded proves nothing about what a failure leaves behind.
    assert.equal(r.action, 'LAND_ESCALATE', `expected a failure, got: ${r.out}`);
    assert.match(
      r.firstReason,
      /could not create worktree/,
      `the failure is not the create failure under test: ${r.firstReason}`
    );
  });

  registry.define(
    /^no scratch branch for that ticket and commit remains in the repository$/,
    (ctx) => {
      assert.equal(
        ctx.bl1298.result.branchAfter,
        '',
        `a scratch branch survived the failed replay: ${ctx.bl1298.result.branchAfter}`
      );
    }
  );

  // ── 03 ───────────────────────────────────────────────────────────────
  registry.define(/^a replay for the ticket has already failed once$/, (ctx) => {
    ctx.bl1298.mode = 'retry-after-failure';
  });

  registry.define(
    /^the land step is invoked again with the same ticket and commit$/,
    (ctx) => {
      // The fixture runs BOTH attempts: it fails the first, removes the first
      // attempt's cause, and runs the second.
      ctx.bl1298.result = runLandStep(ctx.bl1298.mode);
      assert.match(
        ctx.bl1298.result.firstReason,
        /could not create worktree/,
        `the first attempt did not fail for the reason under test: ${ctx.bl1298.result.firstReason}`
      );
    }
  );

  registry.define(/^the reported reason is the first attempt's reason$/, (ctx) => {
    const r = ctx.bl1298.result;
    // The first attempt's reason has been removed, so the retry has nothing
    // left to fail for. A retry that still fails is failing for a reason the
    // first attempt did not have - the leaked scratch branch - which is
    // precisely the defect: whoever reads the second message is sent chasing
    // the wrong thing.
    assert.equal(
      r.secondExit,
      0,
      `the retry failed for a reason the first attempt did not have: ${r.secondReason}`
    );
  });
}

module.exports = { registerSteps };
