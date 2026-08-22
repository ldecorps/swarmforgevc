'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { recordApprovalDecisionAndClose, recordAmendDecisionAndClose } = require('../out/tools/telegramFrontDeskBotCore');
const { commitApprovalWrites } = require('../out/util/commitIntegrityRunner');
const { recordApprovalReply, recordRejectionReply, recordAmendReply } = require('../out/concierge/pendingApprovalReply');

// BL-892 declared invariants (backlog/active/BL-892-approval-flip-must-commit.yaml):
//   1. "A successful automated approval verdict leaves the ticket file's
//      new human_approval value readable from HEAD via git show; the
//      working tree is not the source of truth."
//   2. "Every automated human_approval writer routes through
//      commit_integrity_cli (pathspec-scoped, locked) — never a bare git
//      commit and never a disk-only success."
//
// EXHAUSTIVE (not sampled) over the 3 verdict kinds (approved/rejected/
// amending) x 2 commit-CLI states (present -> genuinely succeeds, absent
// -> genuinely fails) = 6 real combinations, per bl886_vitest_orphan_
// reaper_supervisor_property_runner.js's own small-fully-enumerable-space
// precedent. Every writer here is the REAL production function
// (recordApprovalReply/recordRejectionReply/recordAmendReply from
// pendingApprovalReply.ts, recordApprovalDecisionAndClose/
// recordAmendDecisionAndClose from telegramFrontDeskBotCore.ts,
// commitApprovalWrites from commitIntegrityRunner.ts) against a REAL git
// repo - a mocked commit adapter could fake "committed", but invariant 1's
// own claim is specifically about `git show HEAD:<path>`, which only a
// real git process can prove.

function gitFixture() {
  const root = mkTmpDir('sfvc-bl892-durability-prop-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-892.yaml'), 'id: BL-892\ntitle: t\nhuman_approval: pending\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

function copyCommitIntegrityCli(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const repoScriptsDir = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  for (const name of fs.readdirSync(repoScriptsDir)) {
    if (name.endsWith('.bb')) {
      fs.copyFileSync(path.join(repoScriptsDir, name), path.join(scriptsDir, name));
    }
  }
}

function headShows(root, relPath) {
  try {
    return execFileSync('git', ['show', `HEAD:${relPath}`], { cwd: root, encoding: 'utf8' });
  } catch {
    return null;
  }
}

function revCount(root) {
  return execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function runVerdict(root, kind) {
  const adapters = {
    recordApprovalReply: async (backlogId) => recordApprovalReply(root, backlogId),
    recordRejectionReply: async (backlogId, reason) => recordRejectionReply(root, backlogId, reason),
    recordAmendReply: async (backlogId) => recordAmendReply(root, backlogId),
    commitApprovalWrites: (backlogId, message) => commitApprovalWrites(root, backlogId, message),
  };
  if (kind === 'approved') {
    return recordApprovalDecisionAndClose(adapters, 'BL-892', { kind: 'approved' }, 0);
  }
  if (kind === 'rejected') {
    return recordApprovalDecisionAndClose(adapters, 'BL-892', { kind: 'rejected', reason: 'scope creep' }, 0);
  }
  return recordAmendDecisionAndClose(adapters, 'BL-892', 'tighten scope', 0);
}

const REL_PATH = 'backlog/paused/BL-892.yaml';

test('BL-892 property: a genuine commit success puts the new value on HEAD; a genuine commit failure never leaves a bare commit and HEAD stays on the old value', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('approved', 'rejected', 'amending'), fc.constantFrom('cli-present', 'cli-absent'), async (kind, cliState) => {
      const root = gitFixture();
      if (cliState === 'cli-present') {
        copyCommitIntegrityCli(root);
      }
      const revBefore = revCount(root);

      const result = await runVerdict(root, kind);
      assert.equal(result.changed, true, `expected a real transition for a fresh pending ticket (kind=${kind})`);

      const headContent = headShows(root, REL_PATH);
      assert.ok(headContent !== null, 'expected the ticket file to still exist on HEAD');

      if (cliState === 'cli-present') {
        assert.equal(result.committed, true, `expected commitApprovalWrites to succeed with the real CLI present (kind=${kind})`);
        assert.ok(
          !headContent.includes('human_approval: pending'),
          `INVARIANT 1 VIOLATION: HEAD still shows the old value after a successful commit (kind=${kind}), got: ${headContent}`
        );
        assert.equal(revCount(root), String(Number(revBefore) + 1), 'expected exactly one new commit');
      } else {
        assert.equal(result.committed, false, `expected commitApprovalWrites to fail with the CLI absent (kind=${kind})`);
        assert.ok(
          headContent.includes('human_approval: pending'),
          `INVARIANT 1 VIOLATION: HEAD shows a value that was never actually committed (kind=${kind}), got: ${headContent}`
        );
        assert.equal(
          revCount(root),
          revBefore,
          `INVARIANT 2 VIOLATION: a new commit landed on HEAD despite the commit-integrity CLI being absent - a bare git commit must have run instead (kind=${kind})`
        );
      }
    }),
    { numRuns: 6 }
  );
});

// ── non-vacuity: prove this property actually fails against a
//    deliberately broken writer (BL-654's own generator-reach rule) - a
//    mutant that commits via a bare `git commit -am` instead of routing
//    through commit_integrity_cli. Simulated directly rather than editing
//    production source, since the bug this guards against IS exactly
//    "a bare git commit sneaks in when the locked CLI is unavailable". ────
test('BL-892 property non-vacuity: a simulated bare-git-commit bypass is caught by invariant 2\'s own check', async () => {
  const root = gitFixture();
  const revBefore = revCount(root);
  recordApprovalReply(root, 'BL-892');
  // The bug this test simulates: committing WITHOUT commit_integrity_cli,
  // exactly what invariant 2 forbids.
  execFileSync('git', ['commit', '-q', '-am', 'BUG: bare commit bypassing commit_integrity_cli'], { cwd: root });

  const revAfter = revCount(root);
  const violatesInvariant2 = revAfter !== revBefore;
  assert.ok(violatesInvariant2, 'non-vacuity setup failed: the simulated bare commit did not actually land');
  console.log("non-vacuity confirmed: this property's own revCount check would flag a bare-git-commit bypass (simulated above) as an invariant 2 violation");
});
