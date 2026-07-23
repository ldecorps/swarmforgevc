'use strict';

// BL-256: step handlers for "the daily briefing is enriched with
// pipeline-health observables and PWA deep links". Drives the REAL
// compiled modules (briefingDigest.ts, chase-trend-line.ts,
// pwaDeepLinks.ts) with FIXTURE telemetry - no live git history, no live
// daemon, no real email send, per the ticket's own TESTABLE-boundary
// constraint. Per-stage throughput/dwell (scenario 02) reuses BL-102's
// stage-dwell-report.js CLI UNCHANGED (no new code); its own computation
// correctness is already exhaustively covered by that ticket's own test
// suite, so this file only asserts the WIRING claim (handoffd.bb's
// briefing-email-sweep! actually calls it) - mirroring
// briefingEmailSteps.js's own "wiring-contract guard" pattern (checks
// WHERE the behavior lives, not a live run).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeMergedSince, computeBlockedTickets } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'briefingDigest')
);
const { formatMergedBlockedDigest } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'briefing-digest-line'));
const { computeChaseTrend, formatChaseTrendLine } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'chase-trend-line')
);
const { computeChaserTelemetry } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'swarmMetrics'));
const { buildTicketDeepLink } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'pwaDeepLinks'));

const HANDOFFD = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'handoffd.bb');

function mkFixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-enrichment-'));
  fs.mkdirSync(path.join(dir, '.swarmforge', 'telemetry'), { recursive: true });
  return dir;
}

function writeTelemetryEvent(dir, event) {
  fs.appendFileSync(path.join(dir, '.swarmforge', 'telemetry', 'chaser-2026-07.jsonl'), JSON.stringify(event) + '\n');
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a daily briefing generated from committed git-visible state and existing telemetry$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-10T12:00:00Z');
  });

  // ── what-merged-whats-blocked-01 ────────────────────────────────────
  registry.define(/^tickets merged since the last briefing and one blocked or stalled ticket$/, (ctx) => {
    const lifecycles = new Map([['BL-1', { ticketId: 'BL-1', specDateIso: '2026-07-08T00:00:00Z', closeDateIso: '2026-07-10T09:00:00Z' }]]);
    const windowsByRole = { coder: [{ ticketId: 'BL-2', startMs: ctx.nowMs - 20 * 60 * 60 * 1000, endMs: null }] };
    ctx.merged = computeMergedSince(lifecycles, Date.parse('2026-07-09T00:00:00Z'));
    ctx.blocked = computeBlockedTickets(windowsByRole, ctx.nowMs);
  });

  registry.define(/^the briefing is generated$/, (ctx) => {
    ctx.digestText = formatMergedBlockedDigest(ctx.merged || [], ctx.blocked || [], () => null);
  });

  registry.define(/^it lists the tickets merged since the last briefing$/, (ctx) => {
    if (!ctx.digestText.includes('BL-1')) {
      throw new Error(`expected merged ticket BL-1 to be listed, got: ${ctx.digestText}`);
    }
  });

  registry.define(/^it lists the blocked or stalled tickets needing attention$/, (ctx) => {
    if (!ctx.digestText.includes('BL-2')) {
      throw new Error(`expected blocked ticket BL-2 to be listed, got: ${ctx.digestText}`);
    }
  });

  // ── per-stage-throughput-dwell-02 ───────────────────────────────────
  registry.define(/^stage-dwell telemetry for the pipeline$/, () => {
    // Non-behavioral: this scenario reuses BL-102's own
    // stage-dwell-report.js CLI unchanged - its computation is already
    // exhaustively tested by that ticket's own suite. Asserted below as
    // a wiring claim, not re-simulated here.
  });

  registry.define(/^it reports each stage's dwell time and the pipeline throughput$/, () => {
    const handoffdSrc = fs.readFileSync(HANDOFFD, 'utf8');
    if (!/stage-dwell-report\.js/.test(handoffdSrc)) {
      throw new Error('expected handoffd.bb to wire stage-dwell-report.js into the briefing sweep');
    }
    if (!/:stage-dwell-section stage-dwell-briefing-section/.test(handoffdSrc)) {
      throw new Error("expected handoffd.bb to wire stage-dwell-briefing-section into briefing-email-sweep!'s adapters");
    }
  });

  // ── qa-bounce-chase-trends-03 ────────────────────────────────────────
  registry.define(/^chase\/nudge telemetry over the recent window$/, (ctx) => {
    const dir = mkFixtureRoot();
    writeTelemetryEvent(dir, { type: 'chase', role: 'coder', at: new Date(ctx.nowMs - 60000).toISOString() });
    writeTelemetryEvent(dir, { type: 'nudge', role: 'coder', at: new Date(ctx.nowMs - 120000).toISOString() });
    ctx.chaseCurrent = computeChaserTelemetry(dir, ['coder'], ctx.nowMs);
    ctx.chaseTrend = computeChaseTrend(dir, ['coder'], ctx.nowMs);
  });

  registry.define(/^it reports the chase\/nudge counts with their trend direction$/, (ctx) => {
    const text = formatChaseTrendLine(ctx.chaseCurrent, ctx.chaseTrend, ['coder']);
    if (!/chase\(s\)/.test(text) || !/nudge\(s\)/.test(text)) {
      throw new Error(`expected chase/nudge counts, got: ${text}`);
    }
    if (!['up', 'down', 'flat', 'unknown'].includes(ctx.chaseTrend.direction)) {
      throw new Error(`expected a trend direction to be computed, got: ${JSON.stringify(ctx.chaseTrend)}`);
    }
  });

  // ── deep-links-into-pwa-04 ───────────────────────────────────────────
  registry.define(/^a briefing item that has a corresponding PWA view$/, (ctx) => {
    const lifecycles = new Map([['BL-3', { ticketId: 'BL-3', specDateIso: '2026-07-08T00:00:00Z', closeDateIso: '2026-07-10T09:00:00Z' }]]);
    ctx.deepLinkMerged = computeMergedSince(lifecycles, Date.parse('2026-07-09T00:00:00Z'));
    ctx.pwaBaseUrl = 'https://example.github.io/dashboard/';
  });

  registry.define(/^that item includes a deep link to its PWA view$/, (ctx) => {
    const text = formatMergedBlockedDigest(ctx.deepLinkMerged, [], (id) => buildTicketDeepLink(ctx.pwaBaseUrl, id));
    if (!text.includes('https://example.github.io/dashboard/#ticket=BL-3')) {
      throw new Error(`expected a deep link to BL-3's PWA view, got: ${text}`);
    }
  });

  // ── graceful-missing-data-05 ─────────────────────────────────────────
  registry.define(/^an enrichment section whose telemetry is unavailable$/, (ctx) => {
    ctx.merged = [];
    ctx.blocked = [];
    ctx.chaseCurrent = {};
    ctx.chaseTrend = { series: [], currentValue: 0, priorValue: 0, delta: 0, direction: 'flat' };
  });

  registry.define(/^that section shows an explicit no-data note rather than being broken or omitted silently$/, (ctx) => {
    const digestText = formatMergedBlockedDigest(ctx.merged, ctx.blocked, () => null);
    if (!digestText.includes('none.')) {
      throw new Error(`expected an explicit no-data note in the digest, got: ${digestText}`);
    }
    const chaseText = formatChaseTrendLine(ctx.chaseCurrent, ctx.chaseTrend, ['coder']);
    if (!chaseText.includes('no chase or nudge activity')) {
      throw new Error(`expected an explicit no-data note in the chase trend, got: ${chaseText}`);
    }
  });
}

module.exports = { registerSteps };
