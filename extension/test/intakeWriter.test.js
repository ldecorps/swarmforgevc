const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  intakeFileRelPath,
  renderIntakeMarkdown,
  githubBaseFromRemoteUrl,
  githubPermalink,
  filedIntakeConfirmationText,
  submitIntake,
} = require('../out/bridge/intakeWriter');
const { readVocabulary, seedVocabularyIfMissing } = require('../out/bridge/intakeVocabularyStore');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

const DRAFT = {
  actor: 'the human',
  action: 'file a new intake from my phone',
  goal: 'keep the backlog in one ubiquitous language',
  scenarios: 'Given some state\nWhen something happens\nThen some other state',
};

test('intakeFileRelPath slugifies the goal and stamps the date', () => {
  const rel = intakeFileRelPath(DRAFT, new Date('2026-09-30T12:00:00Z'));
  assert.equal(rel, path.join('backlog', 'INTAKE-keep-the-backlog-in-one-ubiquitous-language-20260930.md'));
});

test('intakeFileRelPath falls back to "intake" when the goal slugifies to nothing', () => {
  // A goal built entirely of characters slugify() strips (punctuation,
  // emoji) yields an empty slug - hand-verified this is load-bearing:
  // removing the `|| 'intake'` fallback in intakeFileRelPath survives
  // every OTHER existing test in this file (each uses a goal with real
  // alphanumeric content).
  const rel = intakeFileRelPath({ ...DRAFT, goal: '!!! 🎉 ???' }, new Date('2026-09-30T12:00:00Z'));
  assert.equal(rel, path.join('backlog', 'INTAKE-intake-20260930.md'));
});

// BL-1732 hardener: QA bounce D1's own suite (submitIntake's two-collision
// test) only ever occupies the BASE path before asking for the next one,
// so it cannot tell a correctly-incrementing suffix from one hand-mutated
// to hardcode "-2" forever - hand-verified: that exact mutant survives
// the whole existing suite. With three prior collisions (base and -2
// both already taken), a hardcoded "-2" would keep returning an
// already-occupied path forever (an infinite loop in production, not
// just a wrong answer) - this test drives the walk far enough to require
// the suffix to actually GROW past 2.
test('intakeFileRelPath walks the suffix past -2 when both the base and -2 are already taken', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const base = path.join('backlog', 'INTAKE-keep-the-backlog-in-one-ubiquitous-language-20260930.md');
  const second = path.join('backlog', 'INTAKE-keep-the-backlog-in-one-ubiquitous-language-20260930-2.md');
  const taken = new Set([base, second]);
  const rel = intakeFileRelPath(DRAFT, now, (p) => taken.has(p));
  assert.equal(rel, path.join('backlog', 'INTAKE-keep-the-backlog-in-one-ubiquitous-language-20260930-3.md'));
});

test('renderIntakeMarkdown holds the narrative and the scenario, no rule section when blank', () => {
  const md = renderIntakeMarkdown(DRAFT);
  assert.match(md, /As the human, I want to file a new intake from my phone, so I can keep the backlog in one ubiquitous language\./);
  assert.match(md, /Given some state/);
  assert.ok(!md.includes('## Rule'));
});

test('renderIntakeMarkdown carries a non-blank rule field', () => {
  const md = renderIntakeMarkdown({ ...DRAFT, rule: 'a submitted intake is never silently dropped' });
  assert.match(md, /## Rule\n\na submitted intake is never silently dropped/);
});

test('renderIntakeMarkdown omits the rule section for a whitespace-only rule', () => {
  const md = renderIntakeMarkdown({ ...DRAFT, rule: '   \n  ' });
  assert.ok(!md.includes('## Rule'));
});

test('githubBaseFromRemoteUrl normalizes SSH and HTTPS GitHub remotes', () => {
  assert.equal(githubBaseFromRemoteUrl('git@github.com:acme/repo.git'), 'https://github.com/acme/repo');
  assert.equal(githubBaseFromRemoteUrl('https://github.com/acme/repo.git'), 'https://github.com/acme/repo');
});

test('githubBaseFromRemoteUrl returns undefined for a non-GitHub or blank remote', () => {
  assert.equal(githubBaseFromRemoteUrl('git@gitlab.com:acme/repo.git'), undefined);
  assert.equal(githubBaseFromRemoteUrl(''), undefined);
  assert.equal(githubBaseFromRemoteUrl(undefined), undefined);
});

test('githubPermalink joins base, sha and path', () => {
  assert.equal(
    githubPermalink('https://github.com/acme/repo', 'abc123', 'backlog/INTAKE-x-20260930.md'),
    'https://github.com/acme/repo/blob/abc123/backlog/INTAKE-x-20260930.md'
  );
});

test('filedIntakeConfirmationText falls back to the plain path with no GitHub remote', () => {
  assert.equal(
    filedIntakeConfirmationText('backlog/INTAKE-x-20260930.md', 'abc123', undefined),
    'Filed for the swarm: backlog/INTAKE-x-20260930.md'
  );
});

test('filedIntakeConfirmationText includes the permalink with a GitHub remote', () => {
  const text = filedIntakeConfirmationText('backlog/INTAKE-x-20260930.md', 'abc123', 'git@github.com:acme/repo.git');
  assert.match(text, /https:\/\/github\.com\/acme\/repo\/blob\/abc123\/backlog\/INTAKE-x-20260930\.md$/);
});

function mkGitRoot() {
  const root = mkTmpDir('sfvc-intake-writer-');
  copySeededRepoInto(root);
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed script closure'], { cwd: root });
  return root;
}

test('submitIntake writes and commits the INTAKE file and the promoted vocabulary together', async () => {
  const root = mkGitRoot();
  seedVocabularyIfMissing(root);
  const draft = { ...DRAFT, goal: 'sleep through the night', newValues: { goal: 'sleep through the night' } };
  const result = await submitIntake(root, draft, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(fs.existsSync(path.join(root, result.relPath)));
    assert.match(result.confirmationText, /^Filed for the swarm: /);
    const log = execFileSync('git', ['log', '-1', '--name-only', '--pretty=format:'], { cwd: root, encoding: 'utf8' });
    assert.match(log, /INTAKE-sleep-through-the-night/);
    assert.match(log, /backlog\/vocabulary\/intake-narrative\.yaml/);
  }
  assert.ok(readVocabulary(root).goal.includes('sleep through the night'));
});

// BL-1732 QA bounce D1: a second same-day intake sharing a goal (a
// 5-value seeded dropdown - not a rare collision) used to name the exact
// same path as the first and silently overwrite it; both submits were
// reported as filed, but only the second survived on disk.
test('submitIntake D1: two same-day intakes sharing a goal each get their own file, neither overwritten', async () => {
  const root = mkGitRoot();
  seedVocabularyIfMissing(root);
  const now = new Date('2026-09-30T12:00:00Z');
  const first = { ...DRAFT, actor: 'the human', goal: 'keep the backlog in one ubiquitous language' };
  const second = { ...DRAFT, actor: 'the operator', goal: 'keep the backlog in one ubiquitous language' };
  const r1 = await submitIntake(root, first, now);
  const r2 = await submitIntake(root, second, now);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.notEqual(r1.relPath, r2.relPath, 'expected two distinct paths, never a silent overwrite');
  assert.ok(fs.existsSync(path.join(root, r1.relPath)), `expected ${r1.relPath} to still exist`);
  assert.ok(fs.existsSync(path.join(root, r2.relPath)), `expected ${r2.relPath} to exist`);
  const firstText = fs.readFileSync(path.join(root, r1.relPath), 'utf8');
  const secondText = fs.readFileSync(path.join(root, r2.relPath), 'utf8');
  assert.match(firstText, /As the human,/);
  assert.match(secondText, /As the operator,/);
});

// BL-1732 QA bounce D2 (invariant 1): a value added via "add new" then
// abandoned - the dropdown switched back to an existing value before
// Submit - must never join the shared vocabulary. newValues carrying a
// value that is NOT the draft's own chosen value for that slot is exactly
// this stale-leftover shape (the client bug this bounce also fixes).
test('submitIntake D2: an abandoned newValues entry (not the draft\'s own chosen value) never joins the shared vocabulary', async () => {
  const root = mkGitRoot();
  seedVocabularyIfMissing(root);
  const draft = {
    ...DRAFT,
    goal: 'keep the backlog in one ubiquitous language', // the draft's ACTUAL chosen (seeded) goal
    newValues: { goal: 'an abandoned added value' }, // stale - never actually used
  };
  const result = await submitIntake(root, draft, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.ok, true);
  assert.ok(!readVocabulary(root).goal.includes('an abandoned added value'), 'expected the abandoned value to never join the shared vocabulary');
});

test('submitIntake reports failure without a .git directory, and leaves no committed trace claim', async () => {
  const root = mkTmpDir('sfvc-intake-writer-nogit-');
  seedVocabularyIfMissing(root);
  const result = await submitIntake(root, DRAFT, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.ok, false);
});

// BL-1732 QA bounce D3: a refused Submit (no commit possible) used to
// leave the INTAKE file on disk at the backlog root - where the
// specifier drains it as a real intake - and the value it added stayed
// in the shared vocabulary, even though the form reported "Refused".
test('submitIntake D3: a failed commit leaves no INTAKE file and an unchanged (pre-existing) vocabulary', async () => {
  const root = mkTmpDir('sfvc-intake-writer-nogit-vocab-');
  seedVocabularyIfMissing(root);
  const before = readVocabulary(root);
  const draft = { ...DRAFT, goal: 'sleep through the night', newValues: { goal: 'sleep through the night' } };
  const result = await submitIntake(root, draft, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.ok, false);
  const files = fs.readdirSync(path.join(root, 'backlog')).filter((f) => f.startsWith('INTAKE-'));
  assert.deepEqual(files, [], `expected no INTAKE file left behind, found: ${files}`);
  assert.deepEqual(readVocabulary(root), before, 'expected the vocabulary restored to exactly its pre-submit content');
});

// BL-1732 QA bounce D3: when the vocabulary file did not exist at all
// before the failed submit (first-ever call, no prior seed), the failure
// path must remove the file it wrote rather than leaving a promoted one
// behind - "restore to before" when before was "no file".
test('submitIntake D3: a failed commit with no pre-existing vocabulary file leaves none behind', async () => {
  const root = mkTmpDir('sfvc-intake-writer-nogit-novocab-');
  const draft = { ...DRAFT, goal: 'sleep through the night', newValues: { goal: 'sleep through the night' } };
  const result = await submitIntake(root, draft, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'vocabulary', 'intake-narrative.yaml')), false);
});
