'use strict';

// BL-923: step handlers for "Role dwell counts occupied time, not the sum
// of parcel windows". Drives the real buildClosingCeremonyPacket against
// in-memory fixture ledger events - never a reimplementation of the
// occupied-time fold under test. No filesystem fixture needed: the module
// under test is pure over an events array.

const assert = require('node:assert/strict');
const path = require('node:path');

const { buildClosingCeremonyPacket } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'quality', 'closingCeremony'));

const FEATURE = 'Role dwell counts occupied time, not the sum of parcel windows';
const SHIFT_KEY = '2026-08-08';
const ROLE = 'hardender';

function transitionEvent(role, atIso, processingMs) {
  return {
    ticket: 'BL-9001',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: atIso,
    role,
    data: { processingMs },
  };
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough. Each layout's expectedMs is computed
// here, once, alongside the windows that produce it - the single source of
// truth the "Then" step checks against, not a re-derivation from the
// <expected> column's own prose.
const LAYOUTS = {
  'two parcels sharing one window': {
    windows: [
      { atIso: '2026-08-08T09:00:10.000Z', processingMs: 10000 },
      { atIso: '2026-08-08T09:00:10.000Z', processingMs: 10000 },
    ],
    expectedLabel: "that one window's duration",
    expectedMs: 10000,
  },
  'three parcels sharing one window': {
    windows: [
      { atIso: '2026-08-08T09:00:10.000Z', processingMs: 10000 },
      { atIso: '2026-08-08T09:00:10.000Z', processingMs: 10000 },
      { atIso: '2026-08-08T09:00:10.000Z', processingMs: 10000 },
    ],
    expectedLabel: "that one window's duration",
    expectedMs: 10000,
  },
  'two parcels in disjoint windows': {
    windows: [
      { atIso: '2026-08-08T09:00:10.000Z', processingMs: 10000 },
      { atIso: '2026-08-08T09:05:10.000Z', processingMs: 10000 },
    ],
    expectedLabel: 'the sum of both windows',
    expectedMs: 20000,
  },
  'two parcels in overlapping windows': {
    // window A: [09:00:00, 09:00:40) - 40000ms up to 09:00:40
    // window B: [09:00:20, 09:01:10) - 50000ms up to 09:01:10
    // joint span: 09:00:00 -> 09:01:10 = 70000ms, not 40000+50000=90000ms
    windows: [
      { atIso: '2026-08-08T09:00:40.000Z', processingMs: 40000 },
      { atIso: '2026-08-08T09:01:10.000Z', processingMs: 50000 },
    ],
    expectedLabel: 'the span they jointly occupied',
    expectedMs: 70000,
  },
};

const KNOWN_EXPECTED_LABELS = new Set(Object.values(LAYOUTS).map((l) => l.expectedLabel));

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a shift ledger whose stage-transition events each carry one parcel's occupancy window at a role$/,
    (ctx) => {
      ctx.events = [];
    },
    FEATURE
  );

  // ── Scenario Outline: dwell counts occupied time ────────────────────────
  registry.defineScoped(
    /^a role whose parcel windows are (.+)$/,
    (ctx, token) => {
      const layout = LAYOUTS[token];
      if (!layout) {
        throw new Error(`unknown layout token: ${token}`);
      }
      ctx.role = ROLE;
      ctx.events.push(...layout.windows.map((w) => transitionEvent(ROLE, w.atIso, w.processingMs)));
      ctx.expectedMs = layout.expectedMs;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the coordinator builds the closing packet$/,
    (ctx) => {
      ctx.packet = buildClosingCeremonyPacket(SHIFT_KEY, ctx.events);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that role's dwell total is (.+)$/,
    (ctx, token) => {
      if (!KNOWN_EXPECTED_LABELS.has(token)) {
        throw new Error(`unknown expected token: ${token}`);
      }
      const hotspot = ctx.packet.dwellHotspots.find((h) => h.role === ctx.role);
      assert.ok(hotspot, `expected a dwell hotspot for role ${ctx.role}, got: ${JSON.stringify(ctx.packet.dwellHotspots)}`);
      assert.equal(hotspot.totalMs, ctx.expectedMs, `expected ${ctx.role}'s dwell to be ${ctx.expectedMs}ms (${token}), got ${hotspot.totalMs}ms`);
    },
    FEATURE
  );

  // ── Scenario: hypothesis ranks by occupied time, not summed windows ────
  registry.defineScoped(
    /^a shift where a batch role's summed parcel windows exceed a serial role's total but its occupied time does not$/,
    (ctx) => {
      // hardender: three parcels sharing one 6000ms window - summed would be 18000ms.
      ctx.events = [
        transitionEvent('hardender', '2026-08-08T09:00:06.000Z', 6000),
        transitionEvent('hardender', '2026-08-08T09:00:06.000Z', 6000),
        transitionEvent('hardender', '2026-08-08T09:00:06.000Z', 6000),
        // QA: one parcel, a disjoint 10000ms window - genuinely occupied longer.
        transitionEvent('QA', '2026-08-08T10:00:10.000Z', 10000),
      ];
    },
    FEATURE
  );

  registry.defineScoped(
    /^the dwell hotspots rank roles by occupied time$/,
    (ctx) => {
      assert.deepEqual(ctx.packet.dwellHotspots, [
        { role: 'QA', totalMs: 10000 },
        { role: 'hardender', totalMs: 6000 },
      ]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the dwell-derived hypothesis names the serial role$/,
    (ctx) => {
      assert.ok(
        ctx.packet.hypotheses.some((h) => h.startsWith('Longest dwell this shift: QA')),
        `expected the QA dwell hypothesis, got: ${JSON.stringify(ctx.packet.hypotheses)}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
