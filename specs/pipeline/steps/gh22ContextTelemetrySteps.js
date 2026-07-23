'use strict';

// GH-22 Slice 1: step handlers for "Context telemetry capture — recorder
// and query CLI". Drives the REAL context_telemetry_cli.bb — never
// re-implements validation/normalization/summary decisions in JS. Each
// scenario gets its own isolated state dir via CONTEXT_TELEMETRY_STATE_DIR
// (the CLI's test-isolation seam, mirroring MODEL_STEWARD_STATE_DIR) so
// acceptance runs never mutate this repo's real .swarmforge/telemetry/.
//
// No wall-clock reads anywhere here — every timestamp is a fixed fixture
// string built from a constant epoch plus an explicit offset, never
// Date.now(), so a re-run is byte-for-byte deterministic.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');

const BASE_EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');

function isoAt(offsetMs) {
  return new Date(BASE_EPOCH_MS + offsetMs).toISOString().replace(/\.000Z$/, 'Z');
}

function cli(stateDir, args) {
  return execFileSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: stateDir }
  });
}

function cliResult(stateDir, args) {
  try {
    return { exitCode: 0, stdout: cli(stateDir, args), stderr: '' };
  } catch (err) {
    if (typeof err.status === 'number') {
      return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
    }
    throw err;
  }
}

function record(stateDir, event) {
  const args = ['record'];
  for (const [flag, key] of Object.entries({
    '--agent': 'agent',
    '--role': 'role',
    '--session-id': 'session_id',
    '--timestamp': 'timestamp',
    '--input-tokens': 'input_tokens',
    '--output-tokens': 'output_tokens',
    '--context-utilization-pct': 'context_utilization_pct',
    '--compaction': 'compaction',
    '--provider': 'provider',
    '--model': 'model'
  })) {
    if (event[key] !== undefined) args.push(flag, String(event[key]));
  }
  return cliResult(stateDir, args);
}

function readLog(stateDir) {
  const file = path.join(stateDir, 'context-events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventsFor(stateDir, agent) {
  return readLog(stateDir).filter((e) => e.agent === agent);
}

function defaultEvent(overrides) {
  return {
    agent: 'coder',
    role: 'coder',
    session_id: 'sess-fixture',
    timestamp: isoAt(0),
    input_tokens: 1000,
    output_tokens: 100,
    context_utilization_pct: 10,
    compaction: 'false',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    ...overrides
  };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────────
  registry.define(/^the context-telemetry recorder CLI is available$/, () => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`expected the context telemetry CLI at ${CLI}`);
    }
  });

  registry.define(/^the telemetry log is empty$/, (ctx) => {
    ctx.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh22-context-telemetry-'));
    ctx.nextTimestampOffsetMs = 0;
    if (readLog(ctx.stateDir).length !== 0) {
      throw new Error('expected a freshly created state dir to have an empty telemetry log');
    }
  });

  // ── record-invocation-event-01 ────────────────────────────────────────────
  registry.define(
    /^I record an invocation event for agent "([^"]+)" with (\d+) input tokens, (\d+) output tokens, context utilisation (\d+)%, and no compaction$/,
    (ctx, agent, inputTokens, outputTokens, utilPct) => {
      ctx.agent = agent;
      ctx.lastRecorded = {
        input_tokens: Number(inputTokens),
        output_tokens: Number(outputTokens),
        context_utilization_pct: Number(utilPct)
      };
      const result = record(ctx.stateDir, defaultEvent({
        agent,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        context_utilization_pct: utilPct,
        compaction: 'false'
      }));
      if (result.exitCode !== 0) {
        throw new Error(`expected the record command to succeed, got exit ${result.exitCode}: ${result.stderr}`);
      }
    }
  );

  registry.define(/^the telemetry log contains one event for "([^"]+)" with those values$/, (ctx, agent) => {
    const events = eventsFor(ctx.stateDir, agent);
    if (events.length !== 1) {
      throw new Error(`expected exactly one event for "${agent}", got ${events.length}`);
    }
    const [event] = events;
    if (event.input_tokens !== ctx.lastRecorded.input_tokens) {
      throw new Error(`expected input_tokens ${ctx.lastRecorded.input_tokens}, got ${event.input_tokens}`);
    }
    if (event.output_tokens !== ctx.lastRecorded.output_tokens) {
      throw new Error(`expected output_tokens ${ctx.lastRecorded.output_tokens}, got ${event.output_tokens}`);
    }
    if (event.context_utilization_pct !== ctx.lastRecorded.context_utilization_pct) {
      throw new Error(`expected context_utilization_pct ${ctx.lastRecorded.context_utilization_pct}, got ${event.context_utilization_pct}`);
    }
    if (event.compaction !== false) {
      throw new Error(`expected compaction:false, got ${event.compaction}`);
    }
  });

  // ── compaction-marks-time-to-first-02 ─────────────────────────────────────
  registry.define(
    /^agent "([^"]+)" has one prior recorded event at time "([^"]+)" with no compaction$/,
    (ctx, agent, label) => {
      ctx.agent = agent;
      ctx.times = ctx.times || {};
      ctx.times[label] = isoAt(0);
      const result = record(ctx.stateDir, defaultEvent({ agent, timestamp: ctx.times[label], compaction: 'false' }));
      if (result.exitCode !== 0) {
        throw new Error(`expected the prior event to record successfully, got exit ${result.exitCode}: ${result.stderr}`);
      }
    }
  );

  registry.define(
    /^I record a second event for "([^"]+)" at time "([^"]+)" that is marked as a compaction$/,
    (ctx, agent, label) => {
      ctx.times[label] = isoAt(5000);
      const result = record(ctx.stateDir, defaultEvent({ agent, timestamp: ctx.times[label], compaction: 'true' }));
      if (result.exitCode !== 0) {
        throw new Error(`expected the compaction event to record successfully, got exit ${result.exitCode}: ${result.stderr}`);
      }
    }
  );

  registry.define(/^the summary for "([^"]+)" reports (\d+) compaction$/, (ctx, agent, count) => {
    ctx.summary = JSON.parse(cli(ctx.stateDir, ['summary', '--agent', agent]));
    if (ctx.summary.compaction_count !== Number(count)) {
      throw new Error(`expected compaction_count ${count} for "${agent}", got ${ctx.summary.compaction_count}`);
    }
  });

  registry.define(
    /^reports a time-to-first-compaction equal to the elapsed time between "([^"]+)" and "([^"]+)"$/,
    (ctx, labelA, labelB) => {
      const expectedMs = Date.parse(ctx.times[labelB]) - Date.parse(ctx.times[labelA]);
      if (ctx.summary.time_to_first_compaction_ms !== expectedMs) {
        throw new Error(`expected time_to_first_compaction_ms ${expectedMs}, got ${ctx.summary.time_to_first_compaction_ms}`);
      }
    }
  );

  // ── summary-aggregates-per-agent-03 ────────────────────────────────────────
  registry.define(
    /^agent "([^"]+)" has (\d+) recorded events with context utilisation (\d+)%, (\d+)%, and (\d+)%, and one marked as a compaction$/,
    (ctx, agent, count, u1, u2, u3) => {
      ctx.agent = agent;
      const utils = [u1, u2, u3];
      if (utils.length !== Number(count)) {
        throw new Error(`expected ${count} utilisation values, got ${utils.length}`);
      }
      utils.forEach((pct, index) => {
        const result = record(ctx.stateDir, defaultEvent({
          agent,
          timestamp: isoAt(index * 1000),
          context_utilization_pct: pct,
          // The last event is the one marked as a compaction.
          compaction: index === utils.length - 1 ? 'true' : 'false'
        }));
        if (result.exitCode !== 0) {
          throw new Error(`expected event ${index} to record successfully, got exit ${result.exitCode}: ${result.stderr}`);
        }
      });
    }
  );

  registry.define(/^I query the telemetry summary for "([^"]+)"$/, (ctx, agent) => {
    ctx.summary = JSON.parse(cli(ctx.stateDir, ['summary', '--agent', agent]));
  });

  registry.define(/^it reports (\d+) compaction$/, (ctx, count) => {
    if (ctx.summary.compaction_count !== Number(count)) {
      throw new Error(`expected compaction_count ${count}, got ${ctx.summary.compaction_count}`);
    }
  });

  registry.define(/^reports an average context utilisation of (\d+)%$/, (ctx, pct) => {
    if (ctx.summary.avg_context_utilization_pct !== Number(pct)) {
      throw new Error(`expected avg_context_utilization_pct ${pct}, got ${ctx.summary.avg_context_utilization_pct}`);
    }
  });

  // ── malformed-record-rejected-04 / missing-required-field-rejected-05 ────
  registry.define(/^the telemetry log has (\d+) valid events? for agent "([^"]+)"$/, (ctx, count, agent) => {
    ctx.agent = agent;
    for (let i = 0; i < Number(count); i += 1) {
      const result = record(ctx.stateDir, defaultEvent({ agent, timestamp: isoAt(i * 1000) }));
      if (result.exitCode !== 0) {
        throw new Error(`expected fixture event ${i} for "${agent}" to record successfully, got exit ${result.exitCode}: ${result.stderr}`);
      }
    }
  });

  registry.define(/^I attempt to record an event for "([^"]+)" with a non-numeric input-token count$/, (ctx, agent) => {
    ctx.lastResult = record(ctx.stateDir, defaultEvent({ agent, input_tokens: 'not-a-number', timestamp: isoAt(9000) }));
  });

  registry.define(/^I attempt to record an event for "([^"]+)" with no timestamp$/, (ctx, agent) => {
    const event = defaultEvent({ agent });
    delete event.timestamp;
    ctx.lastResult = record(ctx.stateDir, event);
  });

  registry.define(/^the record command fails with a validation error$/, (ctx) => {
    if (ctx.lastResult.exitCode === 0) {
      throw new Error('expected the record command to exit non-zero');
    }
    if (!ctx.lastResult.stderr.trim()) {
      throw new Error('expected the record command to print a validation error to stderr');
    }
  });

  registry.define(/^the telemetry log still contains exactly (\d+) events? for "([^"]+)"$/, (ctx, count, agent) => {
    const events = eventsFor(ctx.stateDir, agent);
    if (events.length !== Number(count)) {
      throw new Error(`expected exactly ${count} events for "${agent}", got ${events.length}`);
    }
  });
}

module.exports = { registerSteps };
