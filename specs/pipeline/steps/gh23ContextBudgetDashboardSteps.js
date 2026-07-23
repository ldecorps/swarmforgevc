'use strict';

// GH-23 Slice 1: step handlers for "Context Budget dashboard on the
// SwarmForge Telegram Mini App console". Drives the REAL bridge server
// (extension/out/bridge/bridgeServer, mirroring bl538's paused-pager steps)
// over HTTP, and records real telemetry fixture events through GH-22's own
// context_telemetry_cli.bb (mirroring gh22ContextTelemetrySteps) rather than
// writing the JSONL log by hand - this ticket must never re-derive GH-22's
// aggregation in JS or in a step handler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');

const FEATURE = 'Context Budget dashboard on the SwarmForge Telegram Mini App console';
const TOKEN = 'context-budget-token';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');

const BASE_EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');

function isoAt(offsetMs) {
  return new Date(BASE_EPOCH_MS + offsetMs).toISOString().replace(/\.000Z$/, 'Z');
}

function mkFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-gh23-'));
}

function record(stateDir, overrides) {
  const event = {
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
    ...overrides,
  };
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
    '--model': 'model',
  })) {
    args.push(flag, String(event[key]));
  }
  execFileSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: stateDir },
  });
  return event;
}

function stateDirFor(ctx) {
  return path.join(ctx.root, '.swarmforge', 'telemetry');
}

async function withBridge(ctx, fn) {
  const handle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

async function fetchDashboardState(ctx, agent) {
  await withBridge(ctx, async (handle) => {
    const base = `http://127.0.0.1:${handle.port}`;
    const htmlRes = await fetch(`${base}/context-budget`);
    assert.equal(htmlRes.status, 200);
    ctx.html = await htmlRes.text();
    const qs = new URLSearchParams();
    if (ctx.token !== null) {
      qs.set('token', ctx.token);
    }
    if (agent) {
      qs.set('agent', agent);
    }
    const stateRes = await fetch(`${base}/context-budget-state?${qs.toString()}`);
    ctx.stateStatus = stateRes.status;
    if (stateRes.status === 200) {
      ctx.state = await stateRes.json();
    }
  });
}

function registerSteps(registry) {
  registry.defineScoped(/^the SwarmForge bridge Mini App is reachable with my allowlisted console token$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.token = TOKEN;
  }, FEATURE);

  registry.defineScoped(/^the console menu at \/console is available$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /context-budget/i);
    });
  }, FEATURE);

  registry.defineScoped(/^I do not have an allowlisted console token$/, (ctx) => {
    ctx.token = null;
  }, FEATURE);

  registry.defineScoped(
    /^agent "([^"]+)" has (\d+) recorded telemetry events? including (\d+) compaction$/,
    (ctx, agent, count, compactionCount) => {
      const n = Number(count);
      const compactions = Number(compactionCount);
      ctx.lastRecorded = null;
      for (let i = 0; i < n; i += 1) {
        ctx.lastRecorded = record(stateDirFor(ctx), {
          agent,
          timestamp: isoAt(i * 1000),
          input_tokens: 1000 + i,
          output_tokens: 100 + i,
          context_utilization_pct: 10 + i,
          compaction: i >= n - compactions ? 'true' : 'false',
        });
      }
    },
    FEATURE
  );

  registry.defineScoped(/^agent "([^"]+)" has zero recorded telemetry events$/, () => {}, FEATURE);

  registry.defineScoped(
    /^agents "([^"]+)" and "([^"]+)" each have at least one recorded telemetry event$/,
    (ctx, agentA, agentB) => {
      record(stateDirFor(ctx), { agent: agentA, timestamp: isoAt(0) });
      record(stateDirFor(ctx), { agent: agentB, timestamp: isoAt(1000) });
    },
    FEATURE
  );

  registry.defineScoped(
    /^I open the Context Budget dashboard from the console menu for "([^"]+)"$/,
    (ctx, agent) => fetchDashboardState(ctx, agent),
    FEATURE
  );

  registry.defineScoped(
    /^I open the Context Budget dashboard for "([^"]+)"$/,
    (ctx, agent) => fetchDashboardState(ctx, agent),
    FEATURE
  );

  registry.defineScoped(/^I request the \/context-budget page$/, (ctx) => fetchDashboardState(ctx, null), FEATURE);

  registry.defineScoped(
    /^I switch the agent picker to "([^"]+)"$/,
    (ctx, agent) => fetchDashboardState(ctx, agent),
    FEATURE
  );

  registry.defineScoped(/^the page shows "([^"]+)"'s provider and model$/, (ctx, agent) => {
    assert.equal(ctx.state.agent, agent);
    assert.ok(ctx.state.summary.provider);
    assert.ok(ctx.state.summary.model);
  }, FEATURE);

  registry.defineScoped(/^shows the number of compactions$/, (ctx) => {
    assert.equal(typeof ctx.state.summary.compaction_count, 'number');
    assert.ok(ctx.state.summary.compaction_count >= 1);
  }, FEATURE);

  registry.defineScoped(/^shows the context utilisation percentage$/, (ctx) => {
    assert.equal(typeof ctx.state.summary.avg_context_utilization_pct, 'number');
  }, FEATURE);

  registry.defineScoped(/^shows the token counts recorded for "([^"]+)"$/, (ctx, agent) => {
    assert.equal(ctx.state.agent, agent);
    assert.equal(ctx.state.summary.latest_input_tokens, ctx.lastRecorded.input_tokens);
    assert.equal(ctx.state.summary.latest_output_tokens, ctx.lastRecorded.output_tokens);
  }, FEATURE);

  registry.defineScoped(
    /^the page shows a message that no telemetry has been recorded yet for "([^"]+)"$/,
    (ctx, agent) => {
      assert.equal(ctx.stateStatus, 200);
      assert.equal(ctx.state.agent, agent);
      assert.equal(ctx.state.summary.event_count, 0);
      assert.match(ctx.html, /No telemetry recorded yet for/);
    },
    FEATURE
  );

  registry.defineScoped(/^does not show a data table or an error$/, (ctx) => {
    assert.equal(ctx.stateStatus, 200);
    assert.equal('error' in ctx.state, false);
  }, FEATURE);

  registry.defineScoped(/^the page now shows "([^"]+)"'s summary instead of "([^"]+)"'s$/, (ctx, nextAgent) => {
    assert.equal(ctx.state.agent, nextAgent);
  }, FEATURE);

  registry.defineScoped(/^access is denied$/, (ctx) => {
    assert.equal(ctx.stateStatus, 401);
  }, FEATURE);
}

module.exports = { registerSteps };
