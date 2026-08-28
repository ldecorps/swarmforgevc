const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { isUnauthorizedResurrection, decideRecoveryFilter, decideQuarantineLift } = require('../out/quality/bounceResurrectionVerdict');
const { gatherBounceResurrectionFacts, filterRecoveryPaths, quarantineLiftCheck } = require('../out/metrics/bounceResurrectionGitAdapter');
const { appendBounceRecordIfNew } = require('../out/metrics/bounceStore');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// BL-1211: a recovery from a sibling branch must never resurrect content a
// bounce revert deliberately removed, and the quarantine-lift check must
// be able to refuse on content that CAME BACK (not only content that went
// missing). Authorship, not byte-identity, is the discriminator - a
// pipeline-role commit ("By <role>." trailer, never "coordinator")
// reintroducing the exact bounced bytes still lifts.

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(root, file, content, message, byline) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', `${message}\n\nBy ${byline}.`]);
  return git(root, ['rev-parse', 'HEAD']);
}

// ── pure verdict layer ──────────────────────────────────────────────────

test('BL-1211: isUnauthorizedResurrection is true only for byte-identical content with no authorization', () => {
  assert.equal(
    isUnauthorizedResurrection({ ticket: 'BL-1', path: 'a', bouncedContent: 'x', candidateContent: 'x', authoredBackBy: null }),
    true
  );
  assert.equal(
    isUnauthorizedResurrection({ ticket: 'BL-1', path: 'a', bouncedContent: 'x', candidateContent: 'y', authoredBackBy: null }),
    false,
    'different content is never a finding, regardless of authorship'
  );
  assert.equal(
    isUnauthorizedResurrection({
      ticket: 'BL-1',
      path: 'a',
      bouncedContent: 'x',
      candidateContent: 'x',
      authoredBackBy: { commit: 'deadbeef01', role: 'coder' },
    }),
    false,
    'byte-identical content WITH authorization lifts, per the 2026-08-28 amendment'
  );
});

test('BL-1211: decideRecoveryFilter holds back only unauthorized resurrections', () => {
  const decisions = decideRecoveryFilter([
    { ticket: 'BL-1', path: 'reverted.ts', bouncedContent: 'x', candidateContent: 'x', authoredBackBy: null },
    { ticket: 'BL-1', path: 'other.ts', bouncedContent: 'x', candidateContent: 'y', authoredBackBy: null },
  ]);
  assert.deepEqual(decisions, [
    { path: 'reverted.ts', restore: false },
    { path: 'other.ts', restore: true },
  ]);
});

test('BL-1211: decideQuarantineLift refuses and names every ticket with an unauthorized resurrection', () => {
  const verdict = decideQuarantineLift([
    { ticket: 'BL-1189', path: 'a.ts', bouncedContent: 'x', candidateContent: 'x', authoredBackBy: null },
  ]);
  assert.equal(verdict.granted, false);
  assert.deepEqual(verdict.refusedTickets, ['BL-1189']);
  assert.deepEqual(verdict.refusedPaths, ['a.ts']);
});

test('BL-1211: decideQuarantineLift grants and cites authorization when every match is authorized', () => {
  const verdict = decideQuarantineLift([
    { ticket: 'BL-1189', path: 'a.ts', bouncedContent: 'x', candidateContent: 'x', authoredBackBy: { commit: 'cafe01', role: 'coder' } },
  ]);
  assert.equal(verdict.granted, true);
  assert.deepEqual(verdict.authorizedBy, [{ commit: 'cafe01', role: 'coder' }]);
});

// ── real-git fixture layer ──────────────────────────────────────────────

// The incident shape: a role branch bounces a ticket, reverts it (or, as
// happened live, restores pre-bounce content via a plain commit), then a
// coordinator recovery restores it wholesale from a sibling. Built as two
// branches diverging from a shared seed, mirroring bounceRevertCheck.test.js's
// own mkBounceFixture.
function mkIncidentFixture() {
  const root = mkTmpDir('sfvc-bl1211-');
  copySeededRepoInto(root);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  const bounced = commitFile(root, 'src/thing.ts', 'bounced content\n', 'BL-1189: adds thing.ts', 'coder');
  commitFile(root, 'src/thing.ts', 'pre-bounce content\n', 'BL-1189: revert bounced content out of architect branch', 'architect');
  return { root, bounced };
}

function mkSiblingWithBouncedContent(root) {
  git(root, ['checkout', '-q', '-b', 'swarmforge-hardender', 'main']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'thing.ts'), 'bounced content\n');
  git(root, ['add', 'src/thing.ts']);
  git(root, ['commit', '-q', '-m', 'hardender: unrelated work\n\nBy hardener.']);
  git(root, ['checkout', '-q', 'swarmforge-architect']);
}

test('BL-1211 scenario 01: a recovery from a sibling holds back the reverted bounce content, restores everything else', () => {
  const { root, bounced } = mkIncidentFixture();
  mkSiblingWithBouncedContent(root);
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1189',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bounced,
    by: 'architect',
    at: new Date().toISOString(),
  });
  // Another, UNRELATED path the sibling also carries - must survive the filter untouched.
  fs.writeFileSync(path.join(root, 'src', 'unrelated.ts'), 'unrelated\n');
  git(root, ['add', 'src/unrelated.ts']);
  git(root, ['checkout', '-q', 'swarmforge-hardender']);
  git(root, ['add', 'src/unrelated.ts']);
  git(root, ['commit', '-q', '-m', 'hardender: also adds unrelated.ts\n\nBy hardener.']);
  git(root, ['checkout', '-q', 'swarmforge-architect']);

  const decisions = filterRecoveryPaths(root, 'architect', 'swarmforge-hardender', ['src/thing.ts', 'src/unrelated.ts']);

  const thing = decisions.find((d) => d.path === 'src/thing.ts');
  const unrelated = decisions.find((d) => d.path === 'src/unrelated.ts');
  assert.equal(thing.restore, false, 'the reverted bounce content must be held back');
  assert.equal(unrelated.restore, true, 'every other restored path must still be present');
});

test('BL-1211 scenario 02: the lift check refuses a branch carrying content a bounce removed, naming the ticket', () => {
  const { root, bounced } = mkIncidentFixture();
  // Resurrect it directly on the branch (simulating the recovery having
  // already run, wholesale, without the filter).
  commitFile(root, 'src/thing.ts', 'bounced content\n', 'recovery: restore thing.ts from hardender', 'coordinator');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1189',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bounced,
    by: 'architect',
    at: new Date().toISOString(),
  });

  const verdict = quarantineLiftCheck(root, 'architect');

  assert.equal(verdict.granted, false);
  assert.deepEqual(verdict.refusedTickets, ['BL-1189']);

  // Non-vacuity: remove the resurrection, confirm it now passes.
  commitFile(root, 'src/thing.ts', 'still pre-bounce content\n', 'keep the revert', 'architect');
  const verdict2 = quarantineLiftCheck(root, 'architect');
  assert.equal(verdict2.granted, true);
});

test('BL-1211 scenario 03: a clean recovered branch (no resurrected bounce content) lifts', () => {
  const root = mkTmpDir('sfvc-bl1211-clean-');
  copySeededRepoInto(root);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  commitFile(root, 'src/ordinary.ts', 'ordinary work\n', 'BL-1: ordinary commit', 'architect');

  const verdict = quarantineLiftCheck(root, 'architect');

  assert.equal(verdict.granted, true);
  assert.deepEqual(verdict.refusedTickets, []);
});

test('BL-1211 scenario 04: a genuine re-fix with DIFFERENT content is not mistaken for the reverted bounce content', () => {
  const { root, bounced } = mkIncidentFixture();
  commitFile(root, 'src/thing.ts', 'a genuinely different re-fix\n', 'fix(BL-1189): re-fix with new content', 'coder');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1189',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bounced,
    by: 'architect',
    at: new Date().toISOString(),
  });

  const verdict = quarantineLiftCheck(root, 'architect');

  assert.equal(verdict.granted, true);
});

test('BL-1211 scenario 05: a verbatim reinstatement deliberately authored by a pipeline role still lifts, and cites that commit', () => {
  const { root, bounced } = mkIncidentFixture();
  const reinstated = commitFile(root, 'src/thing.ts', 'bounced content\n', 'fix(BL-1189): reinstate verbatim, confirmed correct', 'coder');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1189',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bounced,
    by: 'architect',
    at: new Date().toISOString(),
  });

  const verdict = quarantineLiftCheck(root, 'architect');

  assert.equal(verdict.granted, true);
  assert.equal(verdict.authorizedBy.length, 1);
  assert.equal(verdict.authorizedBy[0].commit, reinstated);
  assert.equal(verdict.authorizedBy[0].role, 'coder');

  // Non-vacuity: remove the authorizing commit from the fixture history by
  // building the same content WITHOUT it (a coordinator-authored commit
  // instead) - confirm it is then refused.
  const rootUnauthorized = mkIncidentFixture().root;
  commitFile(rootUnauthorized, 'src/thing.ts', 'bounced content\n', 'recovery: restore', 'coordinator');
  appendBounceRecordIfNew(rootUnauthorized, {
    ticket: 'BL-1189',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bounced,
    by: 'architect',
    at: new Date().toISOString(),
  });
  const verdictUnauthorized = quarantineLiftCheck(rootUnauthorized, 'architect');
  assert.equal(verdictUnauthorized.granted, false);
});

// ── cross-check: recovery filtering is what makes the lift check pass ────

test('BL-1211: filtering the recovery is what makes the lift check pass, not independent luck', () => {
  const { root, bounced } = mkIncidentFixture();
  mkSiblingWithBouncedContent(root);
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1189',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: bounced,
    by: 'architect',
    at: new Date().toISOString(),
  });

  const decisions = filterRecoveryPaths(root, 'architect', 'swarmforge-hardender', ['src/thing.ts']);
  assert.equal(decisions[0].restore, false);

  // Apply the filter's own decision (do NOT restore src/thing.ts) and
  // confirm the branch, unchanged, still lifts.
  const verdictAfterFilteredRecovery = quarantineLiftCheck(root, 'architect');
  assert.equal(verdictAfterFilteredRecovery.granted, true);

  // Now show the OTHER side: applying the UNFILTERED recovery (restoring
  // it anyway) makes the lift check correctly refuse.
  commitFile(root, 'src/thing.ts', 'bounced content\n', 'recovery: restore thing.ts from hardender (unfiltered)', 'coordinator');
  const verdictAfterUnfilteredRecovery = quarantineLiftCheck(root, 'architect');
  assert.equal(verdictAfterUnfilteredRecovery.granted, false);
});
