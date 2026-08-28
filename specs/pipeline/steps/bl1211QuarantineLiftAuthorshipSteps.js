'use strict';

// BL-1211: step handlers for "restoring a collapsed branch never
// resurrects content a bounce deliberately removed". Drives the REAL
// filterRecoveryPaths/quarantineLiftCheck
// (extension/out/metrics/bounceResurrectionGitAdapter) against real git
// fixtures - same fixture conventions as bounceRevertCheck.test.js
// (BL-954/BL-1208).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1211 restoring a collapsed branch never resurrects content a bounce deliberately removed';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ADAPTER = path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'bounceResurrectionGitAdapter');
const STORE = path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'bounceStore');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(root, file, content, message, byline) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', `${message}\n\nBy ${byline}.`]);
  return git(root, ['rev-parse', 'HEAD']);
}

function mkFixtureRoot() {
  const root = fs.realpathSync(mkSocketFixtureRoot('bl1211-acceptance-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'bl1211@example.com']);
  git(root, ['config', 'user.name', 'bl1211']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  return root;
}

function cleanupFixtureRoot(ctx) {
  const st = ctx.bl1211;
  if (!st || !st.root) return;
  releaseSocketFixtureRoot(st.root);
  fs.rmSync(st.root, { recursive: true, force: true });
  ctx.bl1211 = null;
}

function loadModules() {
  delete require.cache[require.resolve(ADAPTER)];
  delete require.cache[require.resolve(STORE)];
  return { ...require(ADAPTER), ...require(STORE) };
}

function recordBounce(st) {
  st.appendBounceRecordIfNew(st.root, {
    ticket: st.ticket,
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: st.bouncedCommit,
    by: 'architect',
    at: new Date().toISOString(),
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a review branch that bounced a ticket and reverted that ticket's content out$/, (ctx) => {
    const mods = loadModules();
    const root = mkFixtureRoot();
    const bouncedCommit = commitFile(root, 'src/thing.ts', 'bounced content\n', 'BL-1189: adds thing.ts', 'coder');
    commitFile(root, 'src/thing.ts', 'pre-bounce content\n', 'BL-1189: revert bounced content out of architect branch', 'architect');
    ctx.bl1211 = {
      root,
      ticket: 'BL-1189',
      bouncedCommit,
      filterRecoveryPaths: mods.filterRecoveryPaths,
      quarantineLiftCheck: mods.quarantineLiftCheck,
      appendBounceRecordIfNew: mods.appendBounceRecordIfNew,
    };
    recordBounce(ctx.bl1211);
  });

  // ── scenario 01: recovery filtering ──────────────────────────────────────

  scoped(/^the sibling branch still holds the reverted content$/, (ctx) => {
    const st = ctx.bl1211;
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-hardender', 'main']);
    commitFile(st.root, 'src/thing.ts', 'bounced content\n', 'hardender: unrelated work', 'hardener');
    commitFile(st.root, 'src/unrelated.ts', 'unrelated\n', 'hardender: also adds unrelated.ts', 'hardener');
    git(st.root, ['checkout', '-q', 'swarmforge-architect']);
  });

  scoped(/^the branch is recovered from that sibling$/, (ctx) => {
    const st = ctx.bl1211;
    st.decisions = st.filterRecoveryPaths(st.root, 'architect', 'swarmforge-hardender', ['src/thing.ts', 'src/unrelated.ts']);
  });

  scoped(/^the reverted content is still absent from the recovered branch$/, (ctx) => {
    const st = ctx.bl1211;
    const thing = st.decisions.find((d) => d.path === 'src/thing.ts');
    assert.equal(thing.restore, false, `expected the reverted content held back, got: ${JSON.stringify(thing)}`);
  });

  scoped(/^every other file the recovery was meant to restore is present$/, (ctx) => {
    const st = ctx.bl1211;
    try {
      const unrelated = st.decisions.find((d) => d.path === 'src/unrelated.ts');
      assert.equal(unrelated.restore, true, `expected the unrelated path restored, got: ${JSON.stringify(unrelated)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenarios 02-05: the quarantine lift check ───────────────────────────

  scoped(/^the recovered branch has an empty deletion diff against its siblings$/, () => {
    // Declarative in this feature - the fixture branches this file builds
    // never delete any sibling path, so the deletion-diff half of the
    // ORIGINAL lift check is empty by construction throughout; the point
    // of this feature is the check's SECOND half (content that came back).
  });

  scoped(/^it carries content identical to what a revert on it removed$/, (ctx) => {
    const st = ctx.bl1211;
    commitFile(st.root, 'src/thing.ts', 'bounced content\n', 'recovery: restore thing.ts from hardender', 'coordinator');
  });

  scoped(/^no commit after that revert authored the content back$/, () => {
    // Declarative - the immediately-preceding step's own commit is
    // authored "By coordinator.", which findAuthoredBackBy never accepts
    // as authorization (Article 1.1: coordinator authors no pipeline
    // work).
  });

  scoped(/^the quarantine lift check runs$/, (ctx) => {
    const st = ctx.bl1211;
    st.verdict = st.quarantineLiftCheck(st.root, 'architect');
  });

  scoped(/^the lift is refused$/, (ctx) => {
    const st = ctx.bl1211;
    assert.equal(st.verdict.granted, false, `expected the lift refused, got: ${JSON.stringify(st.verdict)}`);
  });

  scoped(/^the refusal names the ticket whose bounced content came back$/, (ctx) => {
    const st = ctx.bl1211;
    try {
      assert.deepEqual(st.verdict.refusedTickets, ['BL-1189'], `expected the refusal to name BL-1189, got: ${JSON.stringify(st.verdict)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 03 ───────────────────────────────────────────────────────

  scoped(/^it carries no content that a revert on it removed$/, () => {
    // Declarative - this scenario's Background already reverted BL-1189's
    // content and nothing further resurrects it; the branch is simply
    // left as-is (a clean recovery with nothing to refuse).
  });

  // Shared, identically-worded step text across scenarios 03, 04, AND 05
  // (registered once here) - scenario 05 has a further step after it, so
  // this handler must NOT clean up the fixture; scenarios 03/04's roots
  // are reaped by mkSocketFixtureRoot's own process-exit backstop (BL-948)
  // instead of an explicit cleanup call here (same pattern as BL-1208's
  // step file for an identical duplicate-registration shape).
  scoped(/^the lift is granted$/, (ctx) => {
    const st = ctx.bl1211;
    assert.equal(st.verdict.granted, true, `expected the lift granted, got: ${JSON.stringify(st.verdict)}`);
  });

  // ── scenario 04 ───────────────────────────────────────────────────────

  scoped(/^the branch has merged new work that answers the bounce$/, (ctx) => {
    const st = ctx.bl1211;
    commitFile(st.root, 'src/thing.ts', 'a genuinely different re-fix\n', 'fix(BL-1189): re-fix with new content', 'coder');
  });

  scoped(/^that work differs from the content the revert removed$/, () => {
    // Declarative - the preceding step's content ("a genuinely different
    // re-fix") is, by construction, not byte-identical to the bounced
    // version ("bounced content").
  });

  // ── scenario 05 ───────────────────────────────────────────────────────

  scoped(/^a commit after the revert reinstated the removed content deliberately$/, (ctx) => {
    const st = ctx.bl1211;
    st.reinstatedCommit = commitFile(st.root, 'src/thing.ts', 'bounced content\n', 'fix(BL-1189): reinstate verbatim, confirmed correct', 'coder');
  });

  scoped(/^the reinstated content is byte-identical to what the revert removed$/, () => {
    // Declarative - both steps above write the literal same bytes,
    // "bounced content\n", by construction.
  });

  scoped(/^the lift cites the commit that authored the content back$/, (ctx) => {
    const st = ctx.bl1211;
    try {
      assert.equal(st.verdict.authorizedBy.length, 1, `expected exactly one authorization, got: ${JSON.stringify(st.verdict)}`);
      assert.equal(st.verdict.authorizedBy[0].commit, st.reinstatedCommit);
      assert.equal(st.verdict.authorizedBy[0].role, 'coder');
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });
}

module.exports = { registerSteps };
