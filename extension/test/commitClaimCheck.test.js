'use strict';

const assert = require('node:assert/strict');
const { findUnsupportedCommitClaims, evaluateCommitClaims } = require('../out/tools/commitClaimCheck');

// ── findUnsupportedCommitClaims: the verb-scoped grammar ────────────────

test('flags a backticked identifier claimed as restored that never appears in the patch', () => {
  const message = 'Restore the `deliver!` close paren dropped by BL-611.';
  const patch = 'diff --git a/src/other.ts b/src/other.ts\n+export function unrelated() {}\n';
  const result = findUnsupportedCommitClaims(message, patch);
  assert.equal(result.length, 1);
  assert.equal(result[0].identifier, 'deliver!');
});

test('does not flag a claimed identifier that does appear in the patch', () => {
  const message = 'Restore the deliver! close paren dropped by BL-611.';
  const patch = 'diff --git a/src/x.ts b/src/x.ts\n+function deliver!() {}\n';
  assert.deepEqual(findUnsupportedCommitClaims(message, patch), []);
});

test('does not flag an identifier merely named in passing, with no change verb attached', () => {
  const message = 'See deliver! for context on the affected callers.';
  const patch = 'diff --git a/src/x.ts b/src/x.ts\n+export function unrelatedChange() {}\n';
  assert.deepEqual(findUnsupportedCommitClaims(message, patch), []);
});

test('flags a snake_case identifier claimed as added but absent from the patch', () => {
  const message = 'Add harness_env_scrub_lib to close the leak.';
  const patch = 'diff --git a/src/x.ts b/src/x.ts\n+export const x = 1;\n';
  const result = findUnsupportedCommitClaims(message, patch);
  assert.equal(result.length, 1);
  assert.equal(result[0].identifier, 'harness_env_scrub_lib');
});

test('does not flag a snake_case identifier that appears in the patch changed-path list', () => {
  const message = 'Fix harness_env_scrub_lib.bb so the guard actually runs.';
  const patch = 'diff --git a/swarmforge/scripts/harness_env_scrub_lib.bb b/swarmforge/scripts/harness_env_scrub_lib.bb\n';
  assert.deepEqual(findUnsupportedCommitClaims(message, patch), []);
});

test('flags a camelCase identifier claimed as renamed but absent from the patch', () => {
  const message = 'Rename runSweep to something clearer.';
  const patch = 'diff --git a/src/x.ts b/src/x.ts\n+export const y = 1;\n';
  const result = findUnsupportedCommitClaims(message, patch);
  assert.equal(result.length, 1);
  assert.equal(result[0].identifier, 'runSweep');
});

test('does not flag a camelCase identifier merely mentioned as unaffected ("callers of X are unaffected")', () => {
  const message = 'Fix the leak; callers of runSweep are unaffected by this change.';
  const patch = 'diff --git a/src/other.ts b/src/other.ts\n+export function leakFix() {}\n';
  // "callers of runSweep are unaffected" has no change verb governing runSweep -
  // it is context, not a claim - but "Fix the leak" is its own, separate sentence
  // that carries no code-shaped token at all, so nothing here should be flagged.
  assert.deepEqual(findUnsupportedCommitClaims(message, patch), []);
});

test('flags a path/filename claimed as removed but absent from the patch (and the camelCase basename it also embeds)', () => {
  const message = 'Delete extension/src/tools/deadCode.ts, it is unused.';
  const patch = 'diff --git a/README.md b/README.md\n+typo fix\n';
  const result = findUnsupportedCommitClaims(message, patch);
  const identifiers = result.map((claim) => claim.identifier);
  assert.ok(identifiers.includes('extension/src/tools/deadCode.ts'));
});

test('ignores tool/protocol vocabulary and ticket ids stripped before judging (BL-729 measured false-positive classes)', () => {
  // "run_acceptance.sh" is a real snake_case token, but the sentence naming
  // it here attaches no change verb, so it is never collected as a claim.
  const message = 'BL-729: implement the gate per required_wiring; see run_acceptance.sh for the harness.';
  const patch = 'diff --git a/src/x.ts b/src/x.ts\n+export const y = 1;\n';
  assert.deepEqual(findUnsupportedCommitClaims(message, patch), []);
});

test('strips trailers (By <role>., Co-authored-by:) before judging, so a trailer never itself becomes a claim', () => {
  const message = 'Restore deliver! in the handler.\n\nBy coder.\nCo-authored-by: Someone <someone@example.com>\n';
  const patch = 'diff --git a/src/x.ts b/src/x.ts\n+function deliver!() {}\n';
  assert.deepEqual(findUnsupportedCommitClaims(message, patch), []);
});

test('a bang-suffixed identifier does not fracture sentence splitting the way a real sentence boundary would', () => {
  // If "!" were treated as a sentence terminator, "restore a deliver!" and
  // "close paren dropped by BL-611" would land in different sentences,
  // severing the verb ("restore") from the token that follows it in the
  // fragment that keeps the verb ("close" is itself a change verb, but the
  // second fragment carries no code-shaped token here) - the real intent is
  // one governing verb over one claimed identifier, in the same sentence.
  const message = 'Restore a deliver! close paren dropped by BL-611.';
  const patch = 'diff --git a/src/other.ts b/src/other.ts\n+export function unrelated() {}\n';
  const result = findUnsupportedCommitClaims(message, patch);
  assert.equal(result.length, 1);
  assert.equal(result[0].identifier, 'deliver!');
});

test('the control measurement from BL-636: deliver! unsupported, role-mail-row (backticked) supported in the same commit', () => {
  const message =
    'Restore a `deliver!` close paren dropped by BL-611 that blocked one-shot handoffd flags under streaming eval, and wire `role-mail-row` through the renderer.';
  const patch = [
    'diff --git a/extension/src/panel/roleMailRow.ts b/extension/src/panel/roleMailRow.ts',
    '+export function roleMailRow() {}',
    '+// role-mail-row role-mail-row role-mail-row',
  ].join('\n');
  const result = findUnsupportedCommitClaims(message, patch);
  assert.equal(result.length, 1);
  assert.equal(result[0].identifier, 'deliver!');
});

// ── evaluateCommitClaims: walking every commit, stopping at the first miss ─

function commit(sha, message, patchText) {
  return { sha, message, patchText };
}

test('evaluateCommitClaims reports every commit checked when none carry an unsupported claim', () => {
  const commits = [
    commit('c1', 'Add helper.', 'diff --git a/x.ts b/x.ts\n+helper\n'),
    commit('c2', 'Fix bug in parser.', 'diff --git a/y.ts b/y.ts\n+bug fix in parser\n'),
    commit('c3', 'Document the change.', 'diff --git a/z.md b/z.md\n+docs\n'),
  ];
  const result = evaluateCommitClaims(commits);
  assert.equal(result.commitsChecked, 3);
  assert.equal(result.unsupported, undefined);
});

test('evaluateCommitClaims names the FIRST offending commit, not a later one, even when a later commit also has an unsupported claim', () => {
  const commits = [
    commit('c1-first', 'Restore firstToken! in the handler.', 'diff --git a/x.ts b/x.ts\n+nothing relevant\n'),
    commit('c2-clean', 'Fix parser.', 'diff --git a/y.ts b/y.ts\n+fix parser\n'),
    commit('c3-also-bad', 'Add secondToken! too.', 'diff --git a/z.ts b/z.ts\n+nothing relevant either\n'),
  ];
  const result = evaluateCommitClaims(commits);
  assert.equal(result.unsupported.commit, 'c1-first');
  assert.equal(result.unsupported.identifier, 'firstToken!');
});

test('evaluateCommitClaims still reports commitsChecked as the full run length on a refusal (every commit up to and including it was in fact examined)', () => {
  const commits = [
    commit('c1', 'Fix parser.', 'diff --git a/y.ts b/y.ts\n+fix parser\n'),
    commit('c2-bad', 'Add missingToken! here.', 'diff --git a/z.ts b/z.ts\n+irrelevant\n'),
    commit('c3', 'Document.', 'diff --git a/z.md b/z.md\n+docs\n'),
  ];
  const result = evaluateCommitClaims(commits);
  assert.equal(result.commitsChecked, 3);
  assert.equal(result.unsupported.commit, 'c2-bad');
});

test('evaluateCommitClaims on an empty commit list checks zero commits and finds nothing unsupported', () => {
  const result = evaluateCommitClaims([]);
  assert.equal(result.commitsChecked, 0);
  assert.equal(result.unsupported, undefined);
});
