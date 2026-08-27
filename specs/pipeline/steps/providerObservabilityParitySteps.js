'use strict';

// BL-208: step handlers for the provider-observability-parity feature.
// Drives the real compiled TS telemetry surface
// (extension/out/metrics/swarmMetrics.js) - computeProviderTelemetry is the
// same chaser-*.jsonl reader as computeChaserTelemetry, grouped by the
// `provider` field instead of `role`, so an operator/metrics reader can
// compare providers without a per-brand branch.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  computeChaserTelemetry,
  computeProviderTelemetry,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'swarmMetrics.js'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl208-'));
}

function writeTelemetryLine(target, event) {
  const dir = path.join(target, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'chaser-2026-07.jsonl'), JSON.stringify(event) + '\n');
}

function registerSteps(registry) {
  // ── common-fields-01 ─────────────────────────────────────────────────
  registry.define(/^at least two different providers are active$/, (ctx) => {
    ctx.target = mkTmp();
    ctx.providers = ['claude', 'aider'];
  });

  registry.define(/^their telemetry is recorded$/, (ctx) => {
    writeTelemetryLine(ctx.target, { type: 'chase', role: 'coder', provider: 'claude', handoffId: 'a.handoff', count: 1, at: '2026-07-09T10:00:00Z' });
    writeTelemetryLine(ctx.target, { type: 'chase', role: 'architect', provider: 'aider', handoffId: 'b.handoff', count: 1, at: '2026-07-09T10:05:00Z' });
    ctx.now = Date.parse('2026-07-09T12:00:00Z');
    ctx.byProvider = computeProviderTelemetry(ctx.target, ctx.providers, ctx.now, 7);
  });

  registry.define(/^each provider's records carry the same core field keys with the same shapes$/, (ctx) => {
    const keySets = ctx.providers.map((p) => Object.keys(ctx.byProvider[p]).sort().join(','));
    if (new Set(keySets).size !== 1) {
      throw new Error(`expected every provider's record to share the same field keys, got: ${keySets.join(' | ')}`);
    }
    const expectedShape = ['chases', 'deadLetters', 'nudges', 'recentDailyRate', 'respawns'].join(',');
    if (keySets[0] !== expectedShape) {
      throw new Error(`expected the common field shape ${expectedShape}, got ${keySets[0]}`);
    }
  });

  // ── brand-agnostic-read-02 ───────────────────────────────────────────
  registry.define(/^telemetry from multiple providers$/, (ctx) => {
    ctx.target = mkTmp();
    ctx.providers = ['claude', 'aider'];
    // Two DIFFERENT roles both configured with the "claude" brand - proves
    // aggregation keys off the common provider field, not the per-role one.
    writeTelemetryLine(ctx.target, { type: 'chase', role: 'coder', provider: 'claude', handoffId: 'a.handoff', count: 1, at: '2026-07-09T10:00:00Z' });
    writeTelemetryLine(ctx.target, { type: 'nudge', role: 'cleaner', provider: 'claude', handoffId: 'b.handoff', count: 1, at: '2026-07-09T10:05:00Z' });
    writeTelemetryLine(ctx.target, { type: 'chase', role: 'architect', provider: 'aider', handoffId: 'c.handoff', count: 1, at: '2026-07-09T10:10:00Z' });
    ctx.now = Date.parse('2026-07-09T12:00:00Z');
  });

  registry.define(/^a metrics or operator reader aggregates it$/, (ctx) => {
    ctx.byProvider = computeProviderTelemetry(ctx.target, ctx.providers, ctx.now, 7);
  });

  registry.define(/^it compares providers using the common fields, with no per-brand branch$/, (ctx) => {
    // computeProviderTelemetry itself has no per-brand branch (it groups by
    // whatever string the `provider` field holds); this asserts that the
    // one call above already reflects both coder's and cleaner's events
    // under the single "claude" bucket, with nothing brand-specific in the
    // step itself either.
    if (ctx.byProvider.claude.chases !== 1 || ctx.byProvider.claude.nudges !== 1) {
      throw new Error(`expected coder's chase and cleaner's nudge to both land under "claude", got ${JSON.stringify(ctx.byProvider.claude)}`);
    }
    if (ctx.byProvider.aider.chases !== 1) {
      throw new Error(`expected architect's chase to land under "aider", got ${JSON.stringify(ctx.byProvider.aider)}`);
    }
  });

  // ── empty-reads-zero-03 ──────────────────────────────────────────────
  registry.define(/^a provider that has emitted no telemetry yet$/, (ctx) => {
    ctx.target = mkTmp();
    ctx.provider = 'codex';
  });

  registry.define(/^the observability surface is queried$/, (ctx) => {
    ctx.byProvider = computeProviderTelemetry(ctx.target, [ctx.provider], Date.now(), 7);
    // Cross-checked against computeChaserTelemetry's own established
    // empty-reads-zero behavior (telemetry-05) - same shape, same zero
    // default, proving this isn't a second, divergent implementation.
    ctx.byRole = computeChaserTelemetry(ctx.target, ['some-role'], Date.now(), 7);
  });

  registry.define(/^its metrics read as zero or empty without error$/, (ctx) => {
    const expectedZero = { chases: 0, nudges: 0, deadLetters: 0, respawns: 0, recentDailyRate: 0 };
    if (JSON.stringify(ctx.byProvider[ctx.provider]) !== JSON.stringify(expectedZero)) {
      throw new Error(`expected an all-zero bucket for an untouched provider, got ${JSON.stringify(ctx.byProvider[ctx.provider])}`);
    }
    if (JSON.stringify(ctx.byRole['some-role']) !== JSON.stringify(expectedZero)) {
      throw new Error('expected computeChaserTelemetry to agree on the same all-zero shape');
    }
  });
}

module.exports = { registerSteps };
