const assert = require('node:assert/strict');
const { parseClaudeCliSuccess, claudeCliFailureResult } = require('../out/benchmark/claudeCliExecutor');

test('parseClaudeCliSuccess reads cost, tokens, duration and session id from a full result', () => {
  const stdout = JSON.stringify({
    is_error: false,
    duration_ms: 4200,
    total_cost_usd: 0.031,
    session_id: 'sess-1',
    usage: { input_tokens: 100, output_tokens: 40 },
  });
  assert.deepEqual(parseClaudeCliSuccess(stdout, 9999), {
    success: true,
    costUsd: 0.031,
    tokens: { inputTokens: 100, outputTokens: 40 },
    durationMs: 4200,
    sessionId: 'sess-1',
  });
});

test('parseClaudeCliSuccess reports success: false when the CLI itself flags is_error', () => {
  const stdout = JSON.stringify({ is_error: true, duration_ms: 10 });
  assert.equal(parseClaudeCliSuccess(stdout, 0).success, false);
});

test('parseClaudeCliSuccess falls back to the measured duration when duration_ms is missing', () => {
  const stdout = JSON.stringify({});
  const result = parseClaudeCliSuccess(stdout, 777);
  assert.equal(result.durationMs, 777);
});

test('parseClaudeCliSuccess treats missing cost/usage as null rather than 0 or a crash', () => {
  const stdout = JSON.stringify({});
  const result = parseClaudeCliSuccess(stdout, 0);
  assert.equal(result.costUsd, null);
  assert.equal(result.tokens, null);
});

test('parseClaudeCliSuccess defaults missing usage sub-fields to 0', () => {
  const stdout = JSON.stringify({ usage: {} });
  const result = parseClaudeCliSuccess(stdout, 0);
  assert.deepEqual(result.tokens, { inputTokens: 0, outputTokens: 0 });
});

test('claudeCliFailureResult carries an Error instance message', () => {
  const result = claudeCliFailureResult(new Error('boom'), 55);
  assert.deepEqual(result, { success: false, costUsd: null, tokens: null, durationMs: 55, error: 'boom' });
});

test('claudeCliFailureResult stringifies a non-Error throw rather than crashing', () => {
  const result = claudeCliFailureResult('raw string failure', 12);
  assert.equal(result.error, 'raw string failure');
  assert.equal(result.success, false);
});
