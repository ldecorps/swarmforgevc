'use strict';

// BL-1778: step handlers for "a driver seat's give-up reverts only the
// attempt's own commits". Reuses BL-1697/1715's own fixture
// (makeLocalParcelDriverFixture) - the real driver (coder@2) via one bb
// CLI process per tick, a fake tmux, a real throwaway git checkout with
// the real `seat` script. Every claim-merge shape (a merge commit, a
// fast-forward, main then the received commit) is built with plain git
// calls in this file, never through `seat merge` (which is always
// --no-ff in production) - the fixture's own job is to exercise
// revert-attempt-commits! across every shape the driver's persisted
// postMergeHead can actually take, not to re-drive the real claim path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { makeLocalParcelDriverFixture } = require('../../../extension/test/helpers/localParcelDriverFixture');

const FEATURE = "BL-1778 A driver seat's give-up reverts only the attempt's own commits";

const CLAIM_MERGE_SHAPES = new Set([
  'the received commit as a merge commit',
  'the received commit as a fast-forward',
  'main and then the received commit',
]);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

// A commit representing main advancing on its own (independent of the
// claim's own received commit) - left on a throwaway branch, main itself
// untouched, so the caller decides exactly when (and how) to merge it in.
function makeMainAdvanceCommit(root) {
  git(root, ['checkout', '-q', '-b', 'main-advance-branch']);
  fs.writeFileSync(path.join(root, 'main-advanced.txt'), 'main advanced\n');
  git(root, ['add', 'main-advanced.txt']);
  git(root, ['commit', '-q', '-m', 'main: advance']);
  const sha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['branch', '-q', '-D', 'main-advance-branch']);
  return sha;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a fixture coder stage with a Claude seat "coder" and a driver seat "coder@2"$/, (ctx) => {
    ctx.fixture = makeLocalParcelDriverFixture({ driverRole: 'coder@2' });
    ctx.fixture.installDeliverRoleAnswerStub();
    ctx.fixture.writeRolesTsv([
      { role: 'coder', agent: 'claude' },
      { role: 'coder@2', agent: 'aider' },
    ]);
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => ctx.fixture.cleanup());
  });

  // ── Given: the claim's own merge shape ──────────────────────────────
  scoped(/^coder@2 claimed a parcel whose claim merged (.+)$/, (ctx, shape) => {
    assert.ok(CLAIM_MERGE_SHAPES.has(shape), `unknown claim-merge shape "${shape}"`);
    const { fixture } = ctx;
    const root = fixture.root;
    fixture.writeTicket({ editablePaths: ['editable.txt'] });

    if (shape === 'main and then the received commit') {
      const mainAdvanceSha = makeMainAdvanceCommit(root);
      git(root, ['merge', '--no-ff', '--no-edit', '-m', 'Merge main.', mainAdvanceSha]);
    }

    const senderSha = fixture.makeSenderCommit();
    ctx.senderSha = senderSha;

    if (shape === 'the received commit as a fast-forward') {
      git(root, ['merge', '--ff-only', senderSha]);
    } else {
      git(root, ['merge', '--no-ff', '--no-edit', '-m', 'merge sender', senderSha]);
    }
    ctx.postMergeHead = git(root, ['rev-parse', 'HEAD']);
  });

  // ── Given: the attempt's own still-failing commit ───────────────────
  scoped(/^coder@2's attempt committed changes that its gate still fails after the last fix turn$/, (ctx) => {
    const { fixture } = ctx;
    const root = fixture.root;
    fixture.modelLeavesItBroken(0);
    const specFiles = [fixture.ticketPath, fixture.featurePath];
    for (const p of specFiles) fs.chmodSync(p, 0o444);
    fixture.writeDriverState({
      phase: 'awaiting-model',
      ticket: 'BL-9',
      senderRole: 'specifier',
      postMergeHead: ctx.postMergeHead,
      commit: ctx.senderSha,
      priority: '50',
      startedAtMs: Date.now() - 1000,
      specFiles,
      specHashesBefore: Object.fromEntries(
        specFiles.map((p) => [p, execFileSync('sha256sum', [p]).toString().split(' ')[0]])
      ),
      editablePaths: ['editable.txt'],
      fixTurnsUsed: 1,
      fixTurnsLimit: 1,
      acceptancePath: fixture.featurePath,
    });
  });

  // ── When ─────────────────────────────────────────────────────────────
  function finishLastFixTurn(ctx) {
    ctx.tickResult = ctx.fixture.driveOneTick();
  }
  scoped(/^the driver finishes coder@2's last fix turn$/, (ctx) => finishLastFixTurn(ctx));
  scoped(/^the driver has finished coder@2's last fix turn$/, (ctx) => finishLastFixTurn(ctx));

  // ── Then: scenario 01 ────────────────────────────────────────────────
  scoped(/^coder@2's checkout has the tree it had right after the claim's merges$/, (ctx) => {
    const diff = git(ctx.fixture.root, ['diff', ctx.postMergeHead, 'HEAD', '--stat']);
    assert.equal(
      diff,
      '',
      `expected no tree diff from post-merge head:\n${diff}\n${ctx.tickResult.stdout}\n${ctx.tickResult.stderr}`
    );
  });

  scoped(/^no commit reachable from coder@2's post-merge head is reverted$/, (ctx) => {
    const subjects = git(ctx.fixture.root, ['log', '--format=%s', `${ctx.postMergeHead}..HEAD`])
      .split('\n')
      .filter(Boolean);
    const KNOWN_CLAIM_SUBJECTS = new Set(['Merge main.', 'merge sender', 'sender commit', 'main: advance']);
    for (const subj of subjects) {
      const m = subj.match(/^Revert "(.+)"$/);
      if (m) {
        assert.ok(
          !KNOWN_CLAIM_SUBJECTS.has(m[1]),
          `a claim-merge/received commit was reverted: "${subj}"\nall commits since post-merge head: ${JSON.stringify(subjects)}`
        );
      }
    }
    assert.ok(
      subjects.includes('Revert "model: attempt 0"'),
      `expected the attempt's own commit to be reverted, got: ${JSON.stringify(subjects)}`
    );
  });

  // ── Then: scenario 02 ────────────────────────────────────────────────
  scoped(
    /^coder@2's branch is merged into a branch that already holds that main and that received commit$/,
    (ctx) => {
      const root = ctx.fixture.root;
      // A sibling branch forked from the SAME post-merge head - by
      // construction it already holds exactly the main-advance and
      // received-commit content the claim merged, the same commits
      // coder@2's own branch carries as ancestors.
      git(root, ['branch', 'downstream', ctx.postMergeHead]);
      git(root, ['checkout', '-q', 'downstream']);
      const before = git(root, ['rev-parse', 'HEAD']);
      const result = spawnSync('git', ['merge', '--no-ff', '--no-edit', 'main'], { cwd: root, encoding: 'utf8' });
      ctx.downstreamMergeStatus = result.status;
      ctx.downstreamMergeOutput = result.stdout + result.stderr;
      ctx.downstreamMergeDiff = git(root, ['diff', before, 'HEAD', '--stat']);
      git(root, ['checkout', '-q', 'main']);
    }
  );

  scoped(/^the merge changes no file$/, (ctx) => {
    assert.equal(ctx.downstreamMergeStatus, 0, `downstream merge failed:\n${ctx.downstreamMergeOutput}`);
    assert.equal(
      ctx.downstreamMergeDiff,
      '',
      `downstream merge changed file(s):\n${ctx.downstreamMergeDiff}`
    );
  });

  // ── Then: scenario 03 ────────────────────────────────────────────────
  scoped(
    /^one outcome row records coder@2, its model, the ticket, "given-up", the failed condition and the fix turns used$/,
    (ctx) => {
      const rows = ctx.fixture.readOutcomes();
      assert.equal(rows.length, 1, `expected exactly one outcome row, got: ${JSON.stringify(rows)}`);
      const row = rows[0];
      assert.equal(row.seatId, 'coder@2', `unexpected seatId: ${JSON.stringify(row)}`);
      assert.equal(row.model, 'aider', `unexpected model: ${JSON.stringify(row)}`);
      assert.equal(row.ticket, 'BL-9', `unexpected ticket: ${JSON.stringify(row)}`);
      assert.equal(row.outcome, 'given-up', `unexpected outcome: ${JSON.stringify(row)}`);
      assert.ok(row.reason, `expected a failed condition, got: ${JSON.stringify(row)}`);
      assert.equal(row.fixTurnsUsed, 1, `unexpected fixTurnsUsed: ${JSON.stringify(row)}`);
    }
  );
}

module.exports = { registerSteps };
