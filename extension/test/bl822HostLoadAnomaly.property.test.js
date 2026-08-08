const assert = require('node:assert/strict');
const fc = require('fast-check');
const { buildCostHealthSidecar, renderCostHealthSection } = require('../out/notify/costHealthSidecar');

// BL-822 (coder.prompt's Invariants section - first authorship rests with
// the coder): coder-authored property tests for this ticket's three
// declared invariants. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the unit/coverage/mutation
// run per engineering.prompt's property-test separation rule.
//
// Non-vacuity, checked by hand before landing (all three properties below):
//   - Invariant 1 (both properties): commenting out costHealthSidecar.ts's
//     `renderAnomalyLines` severe-branch guard (`const severe =
//     hostLoad?.severe === true;` forced to `false`) reproduced the exact
//     failure these properties exist to catch - a severe day rendered
//     "none found" where the property expects it forbidden - and restoring
//     the guard made it pass again.
//   - Invariant 2: temporarily making `computeResourceAnomalies` skip
//     anomalous roles whenever a severe hostLoad verdict was passed
//     (simulating a "host load takes over the section" regression)
//     reproduced the failure - resourceAnomalies differed between the
//     with/without-hostLoad builds where the property expects them
//     identical - and reverting made it pass again.
//   - Invariant 3: temporarily having `buildCostHealthSidecar` OR
//     resourceSamplesObserved when a hostLoad verdict was severe
//     (simulating BL-350's broken-sampler/quiet-day distinction being
//     silently erased) reproduced the failure - resourceSamplesObserved
//     flipped true with hostLoad where the property expects it unchanged -
//     and reverting made it pass again.

const NOW_ISO = '2026-08-06T00:00:00Z';
function emptyReliabilitySeries() {
  const point = [{ periodStart: NOW_ISO, value: 0 }];
  return { chases: point, nudges: point, respawns: point, failedDeliveries: point };
}

const FLAT_CPU = { direction: 'flat', delta: 0, priorValue: 5, currentValue: 5, series: [] };
const QUIET_ROLE_TREND = {
  currentRssBytes: 100_000_000, currentCpuPercent: 5,
  rssTrend: { direction: 'flat', delta: 0, priorValue: 100_000_000, currentValue: 100_000_000, series: [] },
  cpuTrend: FLAT_CPU,
};

function anomalousRoleTrend(delta) {
  return {
    currentRssBytes: 1000 + delta, currentCpuPercent: 5,
    rssTrend: { direction: 'up', delta, priorValue: 1000, currentValue: 1000 + delta, series: [] },
    cpuTrend: FLAT_CPU,
  };
}

function buildWith(resourceTrendsByRole, hostLoadVerdict) {
  return buildCostHealthSidecar(
    '2026-08-06',
    {},
    resourceTrendsByRole,
    emptyReliabilitySeries(),
    [],
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    hostLoadVerdict
  );
}

const ROLE_NAMES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

// Each generated role is EITHER quiet or genuinely anomalous BY
// CONSTRUCTION (delta always >= 10% of priorValue 1000, the exact
// RESOURCE_ANOMALY_THRESHOLD costHealthSidecar.ts checks) - reach into
// both branches is asserted, not hoped for, by property 2/3's own
// generator below producing a non-trivial mix across 100 runs.
const roleEntryArb = fc.record({
  role: fc.constantFrom(...ROLE_NAMES),
  anomalous: fc.boolean(),
  delta: fc.integer({ min: 100, max: 5000 }),
});

const resourceTrendsByRoleArb = fc.array(roleEntryArb, { minLength: 0, maxLength: 4 }).map((entries) => {
  const result = {};
  for (const { role, anomalous, delta } of entries) {
    result[role] = anomalous ? anomalousRoleTrend(delta) : QUIET_ROLE_TREND;
  }
  return result;
});

const ratioArb = fc.double({ min: 0, max: 50, noNaN: true });
const sustainedMinutesArb = fc.double({ min: 0, max: 500, noNaN: true });

const hostLoadVerdictArb = fc.record({
  severe: fc.boolean(),
  ratio: fc.option(ratioArb, { nil: null }),
  sustainedMinutes: sustainedMinutesArb,
});

const severeHostLoadArb = fc.record({ severe: fc.constant(true), ratio: ratioArb, sustainedMinutes: sustainedMinutesArb });
const quietHostLoadArb = fc.record({ severe: fc.constant(false), ratio: ratioArb, sustainedMinutes: sustainedMinutesArb });

// A generator that ALWAYS yields at least one real anomaly, by construction
// (not "usually" or "often") - the exact anti-vacuity shape BL-822's own
// scenario 02 exists to guard: an assertion that only checks "none found is
// absent" passes vacuously if resourceAnomalies happened to be non-empty
// for an unrelated reason.
const forcedAnomalousTrendsArb = fc.integer({ min: 100, max: 5000 }).map((delta) => ({ coder: anomalousRoleTrend(delta) }));

// ── invariant 1: no path that reports resource-quiet for a day whose
//    recorded host load was severe (the load-bearing half of the ticket) ──

test('property: a severe host load with a real per-role anomaly still forbids the none-found line, and the anomaly still renders', () => {
  fc.assert(
    fc.property(forcedAnomalousTrendsArb, severeHostLoadArb, (resourceTrendsByRole, hostLoad) => {
      const sidecar = buildWith(resourceTrendsByRole, hostLoad);
      // Non-vacuity guarantee: this build always has a real anomaly.
      assert.ok(sidecar.resourceAnomalies.length > 0);
      const text = renderCostHealthSection(sidecar);
      assert.doesNotMatch(text, /none found/);
      assert.match(text, /- coder:/);
      assert.match(text, /host load/);
    }),
    { numRuns: 100 }
  );
});

test('property: a severe host load with zero per-role anomalies still forbids the none-found line', () => {
  fc.assert(
    fc.property(severeHostLoadArb, (hostLoad) => {
      const sidecar = buildWith({ coder: QUIET_ROLE_TREND }, hostLoad);
      // Non-vacuity guarantee: this build always has zero anomalies, so the
      // "none found" branch is the ONLY thing standing between a quiet
      // JSON array and a truthful rendered verdict.
      assert.equal(sidecar.resourceAnomalies.length, 0);
      const text = renderCostHealthSection(sidecar);
      assert.doesNotMatch(text, /none found/);
    }),
    { numRuns: 100 }
  );
});

// Guards against the degenerate "fix" of never rendering "none found" at
// all (which would trivially satisfy the two properties above without
// actually consulting host load).
test('property: a quiet host with zero per-role anomalies still reports none found', () => {
  fc.assert(
    fc.property(quietHostLoadArb, (hostLoad) => {
      const sidecar = buildWith({ coder: QUIET_ROLE_TREND }, hostLoad);
      const text = renderCostHealthSection(sidecar);
      assert.match(text, /none found/);
    }),
    { numRuns: 100 }
  );
});

// ── invariant 2: per-role RSS/CPU anomaly detection is unchanged - host
//    load coverage is additive and never blanks/replaces/reorders it ──────

test('property: resourceAnomalies is byte-identical whether or not a host-load verdict is passed, for any per-role trend mix', () => {
  fc.assert(
    fc.property(resourceTrendsByRoleArb, hostLoadVerdictArb, (resourceTrendsByRole, hostLoad) => {
      const withHostLoad = buildWith(resourceTrendsByRole, hostLoad);
      const withoutHostLoad = buildWith(resourceTrendsByRole, undefined);
      assert.deepEqual(withHostLoad.resourceAnomalies, withoutHostLoad.resourceAnomalies);
    }),
    { numRuns: 100 }
  );
});

// ── invariant 3: resourceSamplesObserved keeps meaning "per-role sampling
//    ran" only - a host-load sample never sets it true ───────────────────

test('property: resourceSamplesObserved is byte-identical whether or not a host-load verdict is passed, for any per-role trend mix', () => {
  fc.assert(
    fc.property(resourceTrendsByRoleArb, hostLoadVerdictArb, (resourceTrendsByRole, hostLoad) => {
      const withHostLoad = buildWith(resourceTrendsByRole, hostLoad);
      const withoutHostLoad = buildWith(resourceTrendsByRole, undefined);
      assert.equal(withHostLoad.resourceSamplesObserved, withoutHostLoad.resourceSamplesObserved);
    }),
    { numRuns: 100 }
  );
});

test('property: a severe host load never flips resourceSamplesObserved true when no role sampled at all', () => {
  fc.assert(
    fc.property(severeHostLoadArb, (hostLoad) => {
      const sidecar = buildWith({}, hostLoad);
      assert.equal(sidecar.resourceSamplesObserved, false);
    }),
    { numRuns: 100 }
  );
});
