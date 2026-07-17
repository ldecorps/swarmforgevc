const assert = require('node:assert/strict');
const path = require('node:path');
const {
  parseReviewVerdict,
  reviewPrompt,
  rolePromptPath,
  pipelineReviewForceResultFromEnv,
  createPipelineReviewOracle,
} = require('../out/benchmark/pipelineReviewOracle');

// ── parseReviewVerdict (pure) ───────────────────────────────────────────

test('parseReviewVerdict reads ACCEPT from a real CLI JSON result', () => {
  const stdout = JSON.stringify({ is_error: false, result: 'Looks good.\nPIPELINE_ORACLE_VERDICT: ACCEPT' });
  assert.equal(parseReviewVerdict(stdout), 'ACCEPT');
});

test('parseReviewVerdict reads REVISED when the role fixed something', () => {
  const stdout = JSON.stringify({ is_error: false, result: 'Fixed a naming issue.\nPIPELINE_ORACLE_VERDICT: REVISED' });
  assert.equal(parseReviewVerdict(stdout), 'REVISED');
});

test('parseReviewVerdict reads REJECT when the role names a blocking issue', () => {
  const stdout = JSON.stringify({ is_error: false, result: 'Breaks the build.\nPIPELINE_ORACLE_VERDICT: REJECT' });
  assert.equal(parseReviewVerdict(stdout), 'REJECT');
});

test('parseReviewVerdict treats a CLI-level is_error as REJECT, never a silent ACCEPT', () => {
  const stdout = JSON.stringify({ is_error: true, result: 'PIPELINE_ORACLE_VERDICT: ACCEPT' });
  assert.equal(parseReviewVerdict(stdout), 'REJECT');
});

test('parseReviewVerdict treats a missing verdict marker as REJECT', () => {
  const stdout = JSON.stringify({ is_error: false, result: 'I looked at it but forgot to conclude.' });
  assert.equal(parseReviewVerdict(stdout), 'REJECT');
});

test('parseReviewVerdict treats unparseable JSON as REJECT rather than throwing', () => {
  assert.equal(parseReviewVerdict('not json at all'), 'REJECT');
});

test('parseReviewVerdict treats an empty result field as REJECT', () => {
  const stdout = JSON.stringify({ is_error: false });
  assert.equal(parseReviewVerdict(stdout), 'REJECT');
});

// ── reviewPrompt (pure) ──────────────────────────────────────────────────

test('reviewPrompt embeds the role prompt text, the task id, the stage name, and every verdict option', () => {
  const prompt = reviewPrompt('architect', 'You are the architect...', { id: 'coder-task-01' });
  assert.match(prompt, /You are the architect\.\.\./);
  assert.match(prompt, /coder-task-01/);
  assert.match(prompt, /as the architect role/);
  assert.match(prompt, /PIPELINE_ORACLE_VERDICT: ACCEPT/);
  assert.match(prompt, /PIPELINE_ORACLE_VERDICT: REVISED/);
  assert.match(prompt, /PIPELINE_ORACLE_VERDICT: REJECT/);
});

// ── rolePromptPath (pure) ────────────────────────────────────────────────

test('rolePromptPath resolves under <repoRoot>/swarmforge/roles/<stage>.prompt', () => {
  assert.equal(rolePromptPath('/some/repo', 'hardender'), path.join('/some/repo', 'swarmforge', 'roles', 'hardender.prompt'));
});

// ── pipelineReviewForceResultFromEnv / createPipelineReviewOracle's own
//    E2E test seam - no real `claude` subprocess is ever spawned under it ──

const ENV_KEY = 'RUN_ROLE_BENCHMARK_ORACLE_FORCE_RESULT';

function withEnv(key, value, fn) {
  const previous = process.env[key];
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('pipelineReviewForceResultFromEnv returns null when the env var is unset', () => {
  withEnv(ENV_KEY, undefined, () => {
    assert.equal(pipelineReviewForceResultFromEnv(), null);
  });
});

test('pipelineReviewForceResultFromEnv parses the forced result when set', () => {
  withEnv(ENV_KEY, JSON.stringify({ survived: false, bounces: 3 }), () => {
    assert.deepEqual(pipelineReviewForceResultFromEnv(), { survived: false, bounces: 3 });
  });
});

test('createPipelineReviewOracle short-circuits to the forced result and never spawns a real subprocess', async () => {
  const oracle = createPipelineReviewOracle('/does/not/exist/as/a/repo', 'sonnet');
  const result = await withEnv(ENV_KEY, JSON.stringify({ survived: true, bounces: 1 }), () =>
    oracle.review('/does/not/exist/as/a/diff/dir', { id: 'task-x' })
  );
  // A real invocation would fail loudly (role prompt files under a
  // nonexistent repo root, no real `claude` binary guaranteed in CI) - the
  // forced result short-circuiting BEFORE any of that proves the seam
  // genuinely bypasses the real path, not merely that the real path
  // happens to also produce this value.
  assert.deepEqual(result, { survived: true, bounces: 1 });
});
