'use strict';

// BL-904: step handlers for "The sidecar's daemon restart count is
// measured, not assumed". Drives the real, compiled computeCostHealthSidecar
// (extension/out/notify/costHealthSidecar) against a real fixture directory
// carrying a real freshness-incidents.log (BL-675's format) - never a
// hand-built sidecar object. Fixture cleanup follows the guarded/terminal
// pattern BL-905's own bounce established (bl905HideChildlessEpicsReorderSteps.js)
// from the start, not reactively.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeCostHealthSidecar } = require('../../../extension/out/notify/costHealthSidecar');
const { freshnessIncidentLogPath, chaserTelemetryDir } = require('../../../extension/out/metrics/swarmMetrics');

const FEATURE = "The sidecar's daemon restart count is measured, not assumed";
const NOW_MS = Date.parse('2026-08-19T12:00:00Z');
const TODAY_EPOCH = Math.floor(Date.parse('2026-08-19T01:00:00Z') / 1000);
const DAY_SECONDS = 24 * 60 * 60;

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const AVAILABILITY_VALUES = new Set(['missing', 'unreadable']);

function parseAvailability(token) {
  if (!AVAILABILITY_VALUES.has(token)) {
    throw new Error(`unknown availability token: ${token}`);
  }
  return token;
}

function mkFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl904-'));
}

// BL-905 bounce precedent: this framework has no after-scenario hook, so
// cleanup is wired into the step handlers themselves. Idempotent.
function cleanupFixture(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
}

// Non-final step: releases the fixture on throw before rethrowing, so a
// Given/When that fails before a later step's own cleanup never leaks.
function guarded(fn) {
  return async (ctx, ...args) => {
    try {
      return await fn(ctx, ...args);
    } catch (err) {
      cleanupFixture(ctx);
      throw err;
    }
  };
}

// A step that is gherkin-LAST for EVERY scenario it appears in: cleans up
// unconditionally, success or throw.
function terminal(fn) {
  return async (ctx, ...args) => {
    try {
      return await fn(ctx, ...args);
    } finally {
      cleanupFixture(ctx);
    }
  };
}

// "the daemon restart count is (\d+)" is gherkin-LAST for scenarios 01/05
// but NOT for scenario 02 (one more step, "the count is reported as
// measured", follows it there). ctx.deferCleanup, set only by scenario
// 02's own Given, skips cleanup here so that scenario's OWN terminal step
// releases the fixture instead - same shape as BL-905's own bounce fix.
// Always cleans up on throw regardless of deferCleanup: a throw means the
// scenario is aborting either way.
function terminalMaybeDeferred(fn) {
  return async (ctx, ...args) => {
    let result;
    try {
      result = await fn(ctx, ...args);
    } catch (err) {
      cleanupFixture(ctx);
      throw err;
    }
    if (!ctx.deferCleanup) {
      cleanupFixture(ctx);
    }
    return result;
  };
}

function freshnessLine(epochSeconds, daemon, action) {
  return `epoch=${epochSeconds} daemon=${daemon} age_secs=999 threshold=600 action=${action}`;
}

function writeIncidentLog(root, lines) {
  const logPath = freshnessIncidentLogPath(root);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, lines.length > 0 ? lines.join('\n') + '\n' : '');
}

function writeChaserTelemetryLine(root, atIso, type) {
  const dir = chaserTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `chaser-${atIso.slice(0, 7)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type, role: 'coder', at: atIso })}\n`);
}

function emitSidecar(ctx) {
  ctx.sidecar = computeCostHealthSidecar(ctx.root, [{ role: 'coder', worktreePath: ctx.root }], NOW_MS);
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  // Deliberately does NOT write the incident log file - "missing" is the
  // natural default state a scenario's own Given then customizes (or
  // leaves as-is for scenario 04's "missing" row).
  registry.defineScoped(
    /^a freshness incident log fixture$/,
    guarded((ctx) => {
      ctx.root = mkFixture();
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the cost and health sidecar is emitted from that fixture$/,
    guarded((ctx) => {
      emitSidecar(ctx);
    }),
    FEATURE
  );

  // ── Scenarios 01/02: restart vs escalate counting ────────────────────
  registry.defineScoped(
    /^the log records (\d+) restart actions and (\d+) escalate actions$/,
    guarded((ctx, restartCountStr, escalateCountStr) => {
      const restartCount = Number(restartCountStr);
      const escalateCount = Number(escalateCountStr);
      // Scenario 02 alone has one more fs-dependent step after the shared
      // "the daemon restart count is (\d+)" step below.
      if (restartCount === 0) {
        ctx.deferCleanup = true;
      }
      const lines = [];
      for (let i = 0; i < restartCount; i++) {
        lines.push(freshnessLine(TODAY_EPOCH + i, 'handoffd', 'restart'));
      }
      for (let i = 0; i < escalateCount; i++) {
        lines.push(freshnessLine(TODAY_EPOCH + 10000 + i, 'handoffd', 'escalate'));
      }
      writeIncidentLog(ctx.root, lines);
    }),
    FEATURE
  );

  // ── Shared When across every scenario ────────────────────────────────
  registry.defineScoped(
    /^the sidecar is emitted$/,
    guarded((ctx) => {
      emitSidecar(ctx);
    }),
    FEATURE
  );

  // Gherkin-terminal for scenarios 01/05; deferred for scenario 02.
  registry.defineScoped(
    /^the daemon restart count is (\d+)$/,
    terminalMaybeDeferred((ctx, countStr) => {
      assert.equal(ctx.sidecar.reliability.daemonRestarts.value, Number(countStr));
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the count is reported as measured$/,
    terminal((ctx) => {
      assert.notEqual(ctx.sidecar.reliability.daemonRestarts.trend.currentValue, null, 'expected a measured (non-null) currentValue');
      assert.ok(ctx.sidecar.reliability.daemonRestarts.trend.series.length > 0, 'expected a non-empty trend series');
    }),
    FEATURE
  );

  // ── Scenario 03: a real trend once history exists ────────────────────
  registry.defineScoped(
    /^the log spans enough days to establish a trend$/,
    guarded((ctx) => {
      writeIncidentLog(ctx.root, [
        freshnessLine(TODAY_EPOCH - 2 * DAY_SECONDS, 'handoffd', 'restart'),
        freshnessLine(TODAY_EPOCH - 1 * DAY_SECONDS, 'handoffd', 'restart'),
        freshnessLine(TODAY_EPOCH, 'handoffd', 'restart'),
        freshnessLine(TODAY_EPOCH + 1, 'handoffd', 'restart'),
        freshnessLine(TODAY_EPOCH + 2, 'handoffd', 'restart'),
      ]);
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the daemon restart series is populated$/,
    guarded((ctx) => {
      assert.ok(
        ctx.sidecar.reliability.daemonRestarts.trend.series.length >= 2,
        `expected a multi-day series, got ${ctx.sidecar.reliability.daemonRestarts.trend.series.length} point(s)`
      );
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the trend direction is not unknown$/,
    terminal((ctx) => {
      assert.notEqual(ctx.sidecar.reliability.daemonRestarts.trend.direction, 'unknown');
    }),
    FEATURE
  );

  // ── Scenario 04 (Outline): an unavailable log ────────────────────────
  registry.defineScoped(
    /^the incident log is (.+)$/,
    guarded((ctx, token) => {
      const availability = parseAvailability(token);
      const logPath = freshnessIncidentLogPath(ctx.root);
      if (availability === 'missing') {
        fs.rmSync(logPath, { force: true });
      } else {
        // unreadable: the log PATH exists but as a directory, so
        // fs.readFileSync throws rather than returning content.
        fs.mkdirSync(logPath, { recursive: true });
      }
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the count is reported as unavailable$/,
    guarded((ctx) => {
      assert.equal(ctx.sidecar.reliability.daemonRestarts.trend.currentValue, null);
      assert.deepEqual(ctx.sidecar.reliability.daemonRestarts.trend.series, []);
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the count is distinguishable from a measured zero$/,
    terminal((ctx) => {
      // A measured zero (BL-904 invariant 2's OTHER side) always carries a
      // non-null currentValue and a non-empty series - this case must
      // structurally differ, never merely coincide with value:0.
      assert.equal(ctx.sidecar.reliability.daemonRestarts.value, 0);
      assert.equal(ctx.sidecar.reliability.daemonRestarts.trend.currentValue, null);
      assert.equal(ctx.sidecar.reliability.daemonRestarts.trend.series.length, 0);
    }),
    FEATURE
  );

  // ── Scenario 05: a malformed record does not discard the good ones ──────
  registry.defineScoped(
    /^the log records 3 restart actions followed by a truncated line$/,
    guarded((ctx) => {
      writeIncidentLog(ctx.root, [
        freshnessLine(TODAY_EPOCH, 'handoffd', 'restart'),
        freshnessLine(TODAY_EPOCH + 1, 'handoffd', 'restart'),
        freshnessLine(TODAY_EPOCH + 2, 'handoffd', 'restart'),
        `epoch=${TODAY_EPOCH + 3} daemon=handoffd age_secs=999 thresho`,
      ]);
    }),
    FEATURE
  );

  // ── Scenario 06: every reliability field is derived, not literal ────────
  registry.defineScoped(
    /^no reliability field reports a value that is independent of its source$/,
    terminal((ctx) => {
      const before = ctx.sidecar; // from Background's untouched, all-empty fixture
      const atIso = new Date(NOW_MS - 60 * 60 * 1000).toISOString();
      writeChaserTelemetryLine(ctx.root, atIso, 'chase');
      writeChaserTelemetryLine(ctx.root, atIso, 'nudge');
      writeChaserTelemetryLine(ctx.root, atIso, 'respawn');
      writeChaserTelemetryLine(ctx.root, atIso, 'dead-letter');
      writeIncidentLog(ctx.root, [freshnessLine(TODAY_EPOCH, 'handoffd', 'restart')]);
      const after = computeCostHealthSidecar(ctx.root, [{ role: 'coder', worktreePath: ctx.root }], NOW_MS);
      for (const field of ['chases', 'nudges', 'respawns', 'failedDeliveries', 'daemonRestarts']) {
        assert.notEqual(
          after.reliability[field].value,
          before.reliability[field].value,
          `expected reliability.${field} to change when its own source data changed - a literal value would not`
        );
      }
    }),
    FEATURE
  );
}

module.exports = { registerSteps };
