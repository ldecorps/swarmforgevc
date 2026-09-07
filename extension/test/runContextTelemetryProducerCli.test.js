'use strict';

// BL-1477: run-context-telemetry-producer.js is the CLI entry point
// handoffd.bb's context-telemetry-producer-sweep! shells out to every
// cycle. The constraints section is explicit that an operator tunes the
// cap and deadline through THIS file's own env reads, never by editing the
// daemon - so both must be independently testable in-process.
const assert = require('node:assert/strict');
const {
  formatProducerResult,
  resolveCapPerTick,
  resolveDeadlineMs,
} = require('../out/tools/run-context-telemetry-producer');
const {
  DEFAULT_CONTEXT_TELEMETRY_CAP_PER_TICK,
  DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS,
} = require('../out/metrics/contextTelemetryProducer');

function withEnv(vars, fn) {
  const keys = Object.keys(vars);
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
  }
  try {
    for (const key of keys) {
      if (vars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = vars[key];
      }
    }
    fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test('formatProducerResult reports SKIPPED when nothing was derived and no tail was torn', () => {
  const out = formatProducerResult({ recorded: 0, skippedDuplicates: 0, agents: [], remaining: 0, tornTailLine: null });
  assert.equal(out, 'SKIPPED no transcript usage to ingest');
});

test('formatProducerResult names recorded/agent/remaining counts', () => {
  const out = formatProducerResult({
    recorded: 3,
    skippedDuplicates: 1,
    agents: ['coder', 'cleaner'],
    remaining: 7,
    tornTailLine: null,
  });
  assert.equal(out, 'RECORDED 3 event(s) for 2 agent(s), 7 remaining');
});

test('formatProducerResult names a dropped torn tail even when nothing new was recorded', () => {
  const out = formatProducerResult({
    recorded: 0,
    skippedDuplicates: 0,
    agents: [],
    remaining: 0,
    tornTailLine: 4,
  });
  assert.equal(out, 'RECORDED 0 event(s) for 0 agent(s), 0 remaining (torn tail dropped at line 4)');
});

test('resolveDeadlineMs defaults with no env overrides set', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_DEADLINE_MS: undefined, SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () => {
    assert.equal(resolveDeadlineMs(), DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS);
  });
});

test('resolveDeadlineMs honours a smaller explicit override', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_DEADLINE_MS: '5000', SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () => {
    assert.equal(resolveDeadlineMs(), 5000);
  });
});

test('resolveDeadlineMs clamps to one quarter of the supervisor sweep budget, never exceeding it', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_DEADLINE_MS: '90000', SUPERVISOR_IN_SWEEP_BUDGET_MS: '40000' }, () => {
    assert.equal(resolveDeadlineMs(), 10000);
  });
});

test('resolveDeadlineMs falls back to the default on an unparseable or non-positive override', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_DEADLINE_MS: 'not-a-number', SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () => {
    assert.equal(resolveDeadlineMs(), DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS);
  });
  withEnv({ CONTEXT_TELEMETRY_TICK_DEADLINE_MS: '-5', SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () => {
    assert.equal(resolveDeadlineMs(), DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS);
  });
});

test('resolveCapPerTick defaults with no env override set', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_CAP: undefined }, () => {
    assert.equal(resolveCapPerTick(), DEFAULT_CONTEXT_TELEMETRY_CAP_PER_TICK);
  });
});

test('resolveCapPerTick honours an explicit override', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_CAP: '20' }, () => {
    assert.equal(resolveCapPerTick(), 20);
  });
});

test('resolveCapPerTick falls back to the default on an unparseable or non-positive override', () => {
  withEnv({ CONTEXT_TELEMETRY_TICK_CAP: 'lots' }, () => {
    assert.equal(resolveCapPerTick(), DEFAULT_CONTEXT_TELEMETRY_CAP_PER_TICK);
  });
  withEnv({ CONTEXT_TELEMETRY_TICK_CAP: '0' }, () => {
    assert.equal(resolveCapPerTick(), DEFAULT_CONTEXT_TELEMETRY_CAP_PER_TICK);
  });
});
