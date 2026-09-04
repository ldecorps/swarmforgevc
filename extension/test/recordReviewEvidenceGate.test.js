'use strict';

// BL-1362 scenario 04 / invariant 1: the commit the tool reports satisfies the
// REAL review-forward evidence gate, and the gate is not weakened - naming the
// bare received hash is still refused.
//
// Drives swarmforge/scripts/review_forward_evidence_gate_lib.bb through its own
// probe (specs/pipeline/steps/lib/bl1362ReviewEvidenceGateProbe.bb), never a
// restatement of the rule here: the claim is about the gate's verdict, so only
// the gate can make it.

const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recordReviewEvidence } = require('../out/tools/record-review-evidence');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROBE = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1362ReviewEvidenceGateProbe.bb');
const TASK = 'BL-9362-a-fixture-review-pass';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('the recorded commit passes the gate, while the bare received hash is still refused', () => {
  const root = mkTmpDir('sfvc-bl1362-gate-');
  try {
    copySeededRepoInto(root);
    fs.mkdirSync(path.join(root, 'backlog', 'evidence'), { recursive: true });
    const received = git(root, ['rev-parse', '--short=10', 'HEAD']).trim();

    const result = recordReviewEvidence({
      root,
      ticket: 'BL-9362',
      role: 'cleaner',
      none: true,
      items: [],
      date: '20260904',
    });

    const out = execFileSync('bb', [PROBE, root, received, result.commit, TASK], {
      encoding: 'utf8',
      timeout: 300000,
    });
    const verdicts = JSON.parse(out.trim().split('\n').pop());

    assert.equal(
      verdicts.blockedForwardingRecorded,
      false,
      'the gate refused a forward naming the commit this tool just recorded'
    );
    assert.equal(
      verdicts.blockedForwardingReceived,
      true,
      'the gate no longer refuses the bare received hash - it has been weakened'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
