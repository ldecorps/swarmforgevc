const assert = require('node:assert/strict');
const fc = require('fast-check');
const { projectNotDoneEta, NOT_SHRINKING_REASON } = require('../out/metrics/notDoneBurndown');
const { buildNotDoneBurndownSvg } = require('../out/metrics/notDoneBurndownChart');

// BL-910 declared invariants (coder-authored per BL-654), quantified over
// every close/mint pair rather than the example table:
//
//   Invariant 1: "A projected date is shown only when the measured net burn
//   is strictly positive - a growing or flat backlog renders the reason,
//   never a date, an infinity, or a placeholder." The exactly-equal boundary
//   is drawn BY CONSTRUCTION (mode 'equal' copies close's tenths into mint),
//   because that is the case an example table is most likely to miss - the
//   ticket's own words.
//
//   Invariant 2: "The projection never contradicts the counts printed
//   beside it: the ETA shown is recomputable from the open count, close
//   rate and mint rate on the same chart." Checked END TO END: the numbers
//   are parsed back out of the rendered SVG's own subtitle and the shown
//   day count must equal ceil(openN / (closeShown - mintShown)) - hidden
//   precision the reader cannot see must not leak into the answer, which is
//   why the sub-tenth noise lane exists (rates that PRINT identically must
//   project identically).
//
// Non-vacuity proven at authoring time (2026-08-20), each break restored:
//   - `netBurnTenths <= 0` relaxed to `< 0` (a flat backlog divides by
//     zero) -> invariant 1 failed on every 'equal' draw;
//   - projection computed from the raw unrounded rates instead of the
//     printed tenths -> invariant 2 failed on noise-lane draws whose true
//     net differs from the printed net across a ceil boundary.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run.

const NOW = Date.parse('2026-08-10T15:00:00+02:00');
const DAY = 24 * 60 * 60 * 1000;

// Rates drawn as integer tenths (exactly what the subtitle's toFixed(1)
// prints), plus an optional sub-tenth noise that NEVER crosses the rounding
// boundary - so every draw's printed value is known by construction.
const tenthsArb = fc.integer({ min: 0, max: 300 });
const noiseArb = fc.integer({ min: -4, max: 4 }).map((h) => h / 100);
const modeArb = fc.constantFrom('shrinking', 'growing', 'equal');

const scenarioArb = fc
  .record({
    openN: fc.integer({ min: 0, max: 2000 }),
    closeTenths: tenthsArb,
    deltaTenths: fc.integer({ min: 1, max: 80 }),
    mode: modeArb,
    closeNoise: noiseArb,
    mintNoise: noiseArb,
  })
  .map(({ openN, closeTenths, deltaTenths, mode, closeNoise, mintNoise }) => {
    const mintTenths =
      mode === 'equal' ? closeTenths : mode === 'growing' ? closeTenths + deltaTenths : Math.max(closeTenths - deltaTenths, 0);
    return {
      openN,
      mode,
      closeTenths,
      mintTenths,
      closePerDay: Math.max(closeTenths / 10 + closeNoise, 0),
      mintPerDay: Math.max(mintTenths / 10 + mintNoise, 0),
    };
  });

function seriesFor(openN, closePerDay, mintPerDay) {
  return {
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
}

test('BL-910 invariant 1: a date exists iff the printed net burn is strictly positive; otherwise the reason - never a date, an infinity, or a placeholder', () => {
  fc.assert(
    fc.property(scenarioArb, ({ openN, closeTenths, mintTenths, closePerDay, mintPerDay }) => {
      // The noise never crosses the rounding boundary, except where the
      // Math.max floor clipped a rate to keep it non-negative - recompute
      // the printed tenths the way toFixed(1) will actually round them.
      const printedCloseTenths = Math.round(closePerDay * 10);
      const printedMintTenths = Math.round(mintPerDay * 10);
      const shrinkingAsPrinted = printedCloseTenths > printedMintTenths;

      const p = projectNotDoneEta(openN, closePerDay, mintPerDay, NOW);
      const svg = buildNotDoneBurndownSvg(seriesFor(openN, closePerDay, mintPerDay));

      if (shrinkingAsPrinted) {
        assert.equal(p.kind, 'eta');
        assert.ok(Number.isFinite(p.etaDays) && p.etaDays >= 0, `etaDays not finite: ${p.etaDays}`);
        assert.match(svg, /Projected clear \(all open tickets\): \d{4}-\d{2}-\d{2}/);
      } else {
        assert.equal(p.kind, 'no-eta');
        assert.equal(p.reason, NOT_SHRINKING_REASON);
        assert.doesNotMatch(svg, /\d{4}-\d{2}-\d{2}/);
        assert.doesNotMatch(svg, /Infinity|NaN|never/i);
        assert.match(svg, /no ETA — backlog still growing/);
      }
      // The tenths derived from the CONSTRUCTED values agree with the mode
      // unless the non-negativity clip moved a rate - guard the generator's
      // own reach: 'equal' draws must actually exercise the boundary.
      if (closeTenths === mintTenths && Math.round(closePerDay * 10) === Math.round(mintPerDay * 10)) {
        assert.equal(p.kind, 'no-eta', 'the exactly-equal boundary must never yield a date');
      }
    }),
    { numRuns: 300 }
  );
});

test('BL-910 invariant 2: the shown ETA is recomputable from the subtitle the chart itself prints', () => {
  fc.assert(
    fc.property(scenarioArb, ({ openN, closePerDay, mintPerDay }) => {
      const svg = buildNotDoneBurndownSvg(seriesFor(openN, closePerDay, mintPerDay));
      const subtitle = svg.match(/Open \d+ → (\d+) \(net [^)]*\) · Close ([\d.]+)\/d · Mint ([\d.]+)\/d/);
      assert.ok(subtitle, `subtitle not found in svg`);
      const shownOpen = Number(subtitle[1]);
      const shownNetTenths = Math.round(Number(subtitle[2]) * 10) - Math.round(Number(subtitle[3]) * 10);

      const etaLine = svg.match(/Projected clear \(all open tickets\): (\d{4}-\d{2}-\d{2}) · ~(\d+)d/);
      if (shownNetTenths > 0) {
        assert.ok(etaLine, 'a positive printed net burn must show a projection line');
        const shownDays = Number(etaLine[2]);
        const recomputed = Math.ceil(shownOpen / (shownNetTenths / 10));
        assert.equal(shownDays, recomputed, `shown ~${shownDays}d but the printed numbers give ${recomputed}d`);
        const expected = new Date(NOW + shownDays * DAY);
        const label = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
        assert.equal(etaLine[1], label, 'the calendar date must be the shown day count out from now');
      } else {
        assert.equal(etaLine, null, 'no projection line when the printed net burn is not positive');
      }
    }),
    { numRuns: 300 }
  );
});
