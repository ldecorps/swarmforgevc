'use strict';

// BL-273: step handlers for "live per-agent token burn-rate meter on the
// holistic UI". burn-rate-01/02 drive the REAL pure
// computeBurnRateTokensPerHour (out/metrics/burnRate.js) directly with
// fixture records and a fixed injected nowMs - no real clock, matching the
// ticket's own testable-core constraint. burn-rate-03 drives the REAL
// bridge server (out/bridge/bridgeServer.js, mirroring gatesListSteps.js's
// own startBridge pattern) to prove the live endpoint is token-gated.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { computeBurnRateTokensPerHour, DEFAULT_BURN_RATE_WINDOW_MS } = require(path.join(EXT_DIR, 'out', 'metrics', 'burnRate'));
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));

const NOW_MS = Date.parse('2026-07-09T08:15:00Z');

function usageRecord(overrides = {}) {
  return {
    messageId: 'm1',
    timestampMs: NOW_MS - 5 * 60 * 1000,
    model: 'claude-sonnet-5',
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    ...overrides,
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-burn-rate-'));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^each role's transcript usage records carry a timestamp and token counts$/, () => {
    // Documents the shape (TranscriptUsageRecord: messageId, timestampMs,
    // model, usage) - each scenario's own Given below builds its fixture.
  });

  registry.define(/^the burn-rate is evaluated over a recent rolling window at a fixed injected instant$/, (ctx) => {
    ctx.nowMs = NOW_MS;
    ctx.windowMs = DEFAULT_BURN_RATE_WINDOW_MS;
  });

  // ── burn-rate-01 ────────────────────────────────────────────────────
  registry.define(/^a role consumed tokens during the window$/, (ctx) => {
    ctx.records = [usageRecord({ usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 } })];
    ctx.expectedWindowTokens = 165;
  });

  registry.define(/^the per-agent burn-rate is computed$/, (ctx) => {
    ctx.rate = computeBurnRateTokensPerHour(ctx.records, ctx.nowMs, ctx.windowMs);
  });

  registry.define(
    /^that role's rate is the total of its input, output, and cache tokens in the window, extrapolated to tokens per hour$/,
    (ctx) => {
      const expected = ctx.expectedWindowTokens / (ctx.windowMs / (60 * 60 * 1000));
      if (ctx.rate !== expected) {
        throw new Error(`expected a rate of ${expected} tokens/hr, got ${ctx.rate}`);
      }
    }
  );

  // ── burn-rate-02 ────────────────────────────────────────────────────
  registry.define(/^a role was idle during the window$/, (ctx) => {
    ctx.records = [];
  });

  registry.define(/^that role's rate is zero tokens per hour$/, (ctx) => {
    if (ctx.rate !== 0) {
      throw new Error(`expected a zero rate for an idle role, got ${ctx.rate}`);
    }
  });

  // ── burn-rate-03 ────────────────────────────────────────────────────
  registry.define(/^an unauthorized request is made to the burn-rate endpoint$/, async (ctx) => {
    const target = mkTmp();
    const handle = await startBridge(target, path.join(target, 'runs.jsonl'), 'aps-burn-rate-token');
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/burn-rate`);
      ctx.status = res.status;
    } finally {
      handle.stop();
    }
  });

  registry.define(/^the request is rejected$/, (ctx) => {
    if (ctx.status !== 401) {
      throw new Error(`expected the unauthorized burn-rate request to be rejected (401), got ${ctx.status}`);
    }
  });
}

module.exports = { registerSteps };
