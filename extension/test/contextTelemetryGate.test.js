const { mkTmpDir } = require('./helpers/tmpDir');
const { installExecutable } = require('./helpers/sharedBin');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listTelemetryAgents, summarizeTelemetryForAgent } = require('../out/bridge/contextTelemetryGate');

function mkTmp() {
  return mkTmpDir('sfvc-context-telemetry-gate-');
}

// GH-23 architect bounce: `bb` missing from PATH (or exiting non-zero) must
// degrade this dashboard to its own empty state, not throw inside the
// bridge server's request handler.
function withPath(overridePath, fn) {
  const originalPath = process.env.PATH;
  process.env.PATH = overridePath;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function installFakeFailingBb(dir) {
  installExecutable(path.join(dir, 'bb'), '#!/bin/sh\necho "boom" >&2\nexit 1\n');
}

test('listTelemetryAgents returns an empty list when bb is missing from PATH', () => {
  const target = mkTmp();
  const emptyBinDir = mkTmp();

  const result = withPath(emptyBinDir, () => listTelemetryAgents(target));

  assert.deepEqual(result, []);
});

test('summarizeTelemetryForAgent returns the CLI-shaped empty summary when bb is missing from PATH', () => {
  const target = mkTmp();
  const emptyBinDir = mkTmp();

  const result = withPath(emptyBinDir, () => summarizeTelemetryForAgent(target, 'coder'));

  assert.deepEqual(result, {
    agent: 'coder',
    session_id: null,
    event_count: 0,
    compaction_count: 0,
    avg_context_utilization_pct: null,
    time_to_first_compaction_ms: null,
    provider: null,
    model: null,
    latest_input_tokens: null,
    latest_output_tokens: null,
    latest_tool_output_tokens: null,
    latest_prompt_engine_tokens: null,
    latest_system_prompt_tokens: null,
    latest_history_tokens: null,
    latest_estimated_cost_usd: null,
  });
});

test('listTelemetryAgents returns an empty list when the bb CLI exits non-zero', () => {
  const target = mkTmp();
  const fakeBinDir = mkTmp();
  installFakeFailingBb(fakeBinDir);

  const result = withPath(`${fakeBinDir}${path.delimiter}${process.env.PATH}`, () => listTelemetryAgents(target));

  assert.deepEqual(result, []);
});

test('summarizeTelemetryForAgent returns the empty summary when the bb CLI exits non-zero', () => {
  const target = mkTmp();
  const fakeBinDir = mkTmp();
  installFakeFailingBb(fakeBinDir);

  const result = withPath(`${fakeBinDir}${path.delimiter}${process.env.PATH}`, () =>
    summarizeTelemetryForAgent(target, 'architect')
  );

  assert.equal(result.agent, 'architect');
  assert.equal(result.event_count, 0);
});

test('listTelemetryAgents still returns the real agent list when bb succeeds (regression)', () => {
  const target = mkTmp();

  const result = listTelemetryAgents(target);

  assert.deepEqual(result, []);
});
