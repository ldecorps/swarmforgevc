const { mkTmpDir } = require('./helpers/tmpDir');
const { installExecutable } = require('./helpers/sharedBin');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { listTelemetryAgents, summarizeTelemetryForAgent } = require('../out/bridge/contextTelemetryGate');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');

function mkTargetDir() {
  return mkTmpDir('sfvc-context-telemetry-gate-');
}

function recordEvent(telemetryDir, overrides = {}) {
  const event = {
    agent: 'coder',
    role: 'coder',
    'session-id': 's1',
    timestamp: '2026-07-09T08:00:00Z',
    'input-tokens': '100',
    'output-tokens': '50',
    'context-utilization-pct': '40',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    ...overrides,
  };
  const args = ['record'];
  for (const [flag, value] of Object.entries(event)) {
    args.push(`--${flag}`, String(value));
  }
  execFileSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDir },
  });
}

function telemetryDirFor(targetPath) {
  return path.join(targetPath, '.swarmforge', 'telemetry');
}

// ── happy path — real bb CLI, real recorded events ──────────────────────

test('listTelemetryAgents returns the distinct agents recorded for the target', () => {
  const targetPath = mkTargetDir();
  recordEvent(telemetryDirFor(targetPath), { agent: 'coder' });
  recordEvent(telemetryDirFor(targetPath), { agent: 'architect', 'session-id': 's2' });

  const agents = listTelemetryAgents(targetPath);

  assert.deepEqual(agents, ['architect', 'coder']);
});

test('listTelemetryAgents returns an empty list when nothing has been recorded for the target', () => {
  const targetPath = mkTargetDir();

  assert.deepEqual(listTelemetryAgents(targetPath), []);
});

test('summarizeTelemetryForAgent aggregates real recorded events for that agent only', () => {
  const targetPath = mkTargetDir();
  recordEvent(telemetryDirFor(targetPath), {
    agent: 'coder',
    'session-id': 's1',
    timestamp: '2026-07-09T08:00:00Z',
    'input-tokens': '100',
    'output-tokens': '50',
  });
  recordEvent(telemetryDirFor(targetPath), {
    agent: 'coder',
    'session-id': 's1',
    timestamp: '2026-07-09T08:05:00Z',
    'input-tokens': '200',
    'output-tokens': '80',
    compaction: 'true',
  });
  // A different agent's event must not leak into coder's summary.
  recordEvent(telemetryDirFor(targetPath), { agent: 'architect', 'session-id': 's2' });

  const summary = summarizeTelemetryForAgent(targetPath, 'coder');

  assert.equal(summary.event_count, 2);
  assert.equal(summary.compaction_count, 1);
  assert.equal(summary.time_to_first_compaction_ms, 5 * 60 * 1000);
  assert.equal(summary.provider, 'anthropic');
  assert.equal(summary.model, 'claude-sonnet-5');
  assert.equal(summary.latest_input_tokens, 200);
  assert.equal(summary.latest_output_tokens, 80);
});

test('summarizeTelemetryForAgent for an agent with no recorded events returns the zero/empty-state shape, not a crash', () => {
  const targetPath = mkTargetDir();
  recordEvent(telemetryDirFor(targetPath), { agent: 'coder' });

  const summary = summarizeTelemetryForAgent(targetPath, 'nobody-recorded-this-agent');

  assert.equal(summary.event_count, 0);
  assert.equal(summary.compaction_count, 0);
  assert.equal(summary.avg_context_utilization_pct, null);
  assert.equal(summary.time_to_first_compaction_ms, null);
  assert.equal(summary.provider, null);
  assert.equal(summary.model, null);
});

// ── CLI failure fallback (GH-23 hardening: guarded execFileSync) ────────

function withFakeBbOnPath(scriptContent, fn) {
  const binDir = mkTmpDir('sfvc-context-telemetry-fakebin-');
  installExecutable(path.join(binDir, 'bb'), scriptContent);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

test('listTelemetryAgents returns [] (not a throw) when the bb CLI exits non-zero', () => {
  const targetPath = mkTargetDir();
  withFakeBbOnPath('#!/bin/sh\nexit 1\n', () => {
    assert.deepEqual(listTelemetryAgents(targetPath), []);
  });
});

test('listTelemetryAgents returns [] when the bb CLI prints output that is not valid JSON', () => {
  const targetPath = mkTargetDir();
  withFakeBbOnPath('#!/bin/sh\necho "not json"\n', () => {
    assert.deepEqual(listTelemetryAgents(targetPath), []);
  });
});

test('listTelemetryAgents returns [] when the bb CLI returns valid JSON missing the agents key', () => {
  const targetPath = mkTargetDir();
  withFakeBbOnPath('#!/bin/sh\necho \'{"unexpected":true}\'\n', () => {
    assert.deepEqual(listTelemetryAgents(targetPath), []);
  });
});

test('listTelemetryAgents returns [] (not a throw) when the bb CLI returns a non-object JSON value that is not falsy — the "in" operator would crash on a bare number without the typeof guard', () => {
  const targetPath = mkTargetDir();
  withFakeBbOnPath('#!/bin/sh\necho \'42\'\n', () => {
    assert.deepEqual(listTelemetryAgents(targetPath), []);
  });
});

test('summarizeTelemetryForAgent returns the full null-filled fallback shape (not a throw) when the bb CLI exits non-zero', () => {
  const targetPath = mkTargetDir();
  withFakeBbOnPath('#!/bin/sh\nexit 1\n', () => {
    const summary = summarizeTelemetryForAgent(targetPath, 'coder');
    assert.deepEqual(summary, {
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
});

test('summarizeTelemetryForAgent falls back when the bb CLI returns a JSON value that is not an object (e.g. a bare number)', () => {
  const targetPath = mkTargetDir();
  withFakeBbOnPath('#!/bin/sh\necho \'42\'\n', () => {
    const summary = summarizeTelemetryForAgent(targetPath, 'coder');
    assert.equal(summary.event_count, 0);
    assert.equal(summary.agent, 'coder');
  });
});
