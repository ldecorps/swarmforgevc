'use strict';

// BL-910: step handlers for "The morning-briefing burndown carries a
// projected ETA when the backlog is actually shrinking, and says why when it
// is not". Drives the REAL projection (projectNotDoneEta) and the REAL chart
// renderer (buildNotDoneBurndownSvg) from extension/out - never a
// reimplementation. The clock is pinned so calendar dates are deterministic.

const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics');
const { projectNotDoneEta, NOT_SHRINKING_REASON } = require(path.join(OUT, 'notDoneBurndown'));
const { buildNotDoneBurndownSvg } = require(path.join(OUT, 'notDoneBurndownChart'));

const FEATURE_NAME =
  'The morning-briefing burndown carries a projected ETA when the backlog is actually shrinking, and says why when it is not';

const NOW = Date.parse('2026-08-10T15:00:00+02:00');
const DAY = 24 * 60 * 60 * 1000;

// Scenario Outline cells validated against explicit KNOWN_VALUES
// (engineering article's Scenario Outline rule) - a mutated cell fails
// loudly here, never silently passes through.
const KNOWN_PROJECTION_ROWS = new Map([
  ['100|6|4', 50],
  ['30|5|2', 10],
  ['7|3.5|3', 14],
]);
const KNOWN_NOT_SHRINKING_RATES = new Set(['4|6', '5|5', '0|0']);

function knownRateKey(close, mint) {
  return `${Number(close)}|${Number(mint)}`;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(/^the burndown reports (\d+) open tickets$/, (ctx, open) => {
    ctx.openN = Number(open);
  });

  scoped(/^a close rate of ([\d.]+) per day and a mint rate of ([\d.]+) per day$/, (ctx, close, mint) => {
    ctx.closePerDay = Number(close);
    ctx.mintPerDay = Number(mint);
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the burndown is rendered$/, (ctx) => {
    const { openN, closePerDay, mintPerDay } = ctx;
    const series = {
      windowDays: 7,
      open0: openN,
      openN,
      net: 0,
      totalClosed: 0,
      totalFiled: 0,
      closePerDay,
      mintPerDay,
      series: [
        { dayMs: NOW - DAY, label: '08-09', remaining: openN, filed: 0, closed: 0 },
        { dayMs: NOW, label: '08-10', remaining: openN, filed: 0, closed: 0 },
      ],
      projection: projectNotDoneEta(openN, closePerDay, mintPerDay, NOW),
    };
    ctx.svg = buildNotDoneBurndownSvg(series);
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^a projected ETA of (\d+) days is shown$/, (ctx, days) => {
    const key = `${ctx.openN}|${Number(ctx.closePerDay)}|${Number(ctx.mintPerDay)}`;
    if (!KNOWN_PROJECTION_ROWS.has(key)) {
      throw new Error(`BL-910: unrecognized projection row "${key}" - not in KNOWN_VALUES`);
    }
    assert.equal(
      Number(days),
      KNOWN_PROJECTION_ROWS.get(key),
      `Examples row ${key} names ${days} days but KNOWN_VALUES says ${KNOWN_PROJECTION_ROWS.get(key)}`
    );
    assert.match(ctx.svg, new RegExp(`Projected clear \\(all open tickets\\): \\d{4}-\\d{2}-\\d{2} · ~${days}d`));
  });

  scoped(/^no projected date is shown$/, (ctx) => {
    assert.doesNotMatch(ctx.svg, /\d{4}-\d{2}-\d{2}/, 'a date appears on a not-shrinking chart');
    assert.doesNotMatch(ctx.svg, /Infinity|NaN|never/i, 'a fabricated placeholder appears');
  });

  scoped(/^the reason the backlog is not shrinking is shown$/, (ctx) => {
    const key = knownRateKey(ctx.closePerDay, ctx.mintPerDay);
    if (!KNOWN_NOT_SHRINKING_RATES.has(key)) {
      throw new Error(`BL-910: unrecognized not-shrinking rates "${key}" - not in KNOWN_VALUES`);
    }
    assert.ok(ctx.svg.includes(NOT_SHRINKING_REASON), `reason not rendered: expected "${NOT_SHRINKING_REASON}"`);
  });

  scoped(/^the subtitle still reports (\d+) open tickets$/, (ctx, open) => {
    assert.match(ctx.svg, new RegExp(`Open \\d+ → ${open} `), 'the open count left the subtitle');
  });

  scoped(
    /^the subtitle still reports a close rate of ([\d.]+) per day and a mint rate of ([\d.]+) per day$/,
    (ctx, close, mint) => {
      assert.match(ctx.svg, new RegExp(`Close ${Number(close).toFixed(1)}/d · Mint ${Number(mint).toFixed(1)}/d`));
    }
  );

  scoped(/^the projected ETA is labelled as covering all open tickets$/, (ctx) => {
    assert.match(ctx.svg, /Projected clear \(all open tickets\):/);
  });

  scoped(/^the projected ETA is not presented as a milestone forecast$/, (ctx) => {
    assert.doesNotMatch(ctx.svg, /milestone|p50|p85/i, 'the projection reads as a milestone forecast');
  });

  scoped(/^the heading still calls the chart a burndown$/, (ctx) => {
    assert.match(ctx.svg, /Backlog burndown/);
  });
}

module.exports = { registerSteps };
