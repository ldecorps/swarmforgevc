const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  computeThrottleRecommendation,
  emitThrottleRecommendation,
  throttleChangeLogPath,
} = require('../out/tools/emit-throttle-recommendation');
const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
const {
  standingRedSignal,
  describeStandingRedSignal,
  readStandingRedThresholds,
  DEFAULT_STANDING_RED_MAX_COUNT,
  DEFAULT_STANDING_RED_MAX_AGE_DAYS,
} = require('../out/metrics/standingRedSignal');

// BL-1429 (BL-654: coder owns first authorship of each declared invariant's
// property test): the ticket declares three invariants. Each gets its own
// property below, targeting the exact pure/composition modules that carry
// it. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - excluded from unit/coverage/mutation.

function mkTmp() {
  return mkTmpDir('sfvc-bl1429-fold-prop-');
}

function readLogLines(root) {
  try {
    return fs
      .readFileSync(throttleChangeLogPath(root), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ── invariant 1: "The register is a signal, never a raise: the emitted ────
//    recommendation is the minimum of the rework recommendation and the
//    standing-red recommendation, null only when both are null, and
//    Article 3.5's two named caps (1 and 0) are the only values it ever
//    recommends." ─────────────────────────────────────────────────────────

const REWORK_CATEGORIES = ['none', 'degraded', 'severe'];
const STANDING_CATEGORIES = ['none', 'count', 'age', 'unowned'];

function expectedReworkCap(category) {
  if (category === 'degraded') return 1;
  if (category === 'severe') return 0;
  return null;
}

function expectedStandingCap(category) {
  return category === 'none' ? null : 1;
}

function expectedFold(reworkCap, standingCap) {
  if (reworkCap === null) return standingCap;
  if (standingCap === null) return reworkCap;
  return Math.min(reworkCap, standingCap);
}

function writeReworkCategory(root, category) {
  if (category === 'none') return;
  // baseline 0.1: degraded crosses the 2x-baseline line (>0.2) without
  // reaching the 4x severe line (>0.4); severe clears both.
  const reworkRate = category === 'degraded' ? 0.3 : 0.6;
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate, baselineRate: 0.1, topRole: null, topTicketClass: null },
  });
}

// Writes a register whose signal is EXACTLY the one named, and every other
// signal clear - deterministic per category rather than randomized, so
// expectedStandingCap/expectedFold above can be computed independently of
// standingRedSignal.ts's own priority-ordering logic.
function writeStandingCategory(root, category) {
  const specs = {
    none: { count: 3, oldestAgeDays: 2, unownedCount: 0 },
    count: { count: 15, oldestAgeDays: 2, unownedCount: 0 },
    age: { count: 3, oldestAgeDays: 12, unownedCount: 0 },
    unowned: { count: 3, oldestAgeDays: 2, unownedCount: 1 },
  };
  const { count, oldestAgeDays, unownedCount } = specs[category];
  const firstSeen = new Date(Date.now() - oldestAgeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const owned = i >= unownedCount;
    const ticket = owned ? `BL-9${800 + i}` : `BL-9${900 + i}`;
    rows.push(`unit\textension/test/bl1429-prop-fixture-${i}.test.js\t${ticket}\t${firstSeen}\tfixture row`);
    if (owned) {
      const activeDir = path.join(root, 'backlog', 'active');
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, `${ticket}-fixture.yaml`), `id: ${ticket}\ntitle: t\nstatus: todo\n`);
    }
  }
  const registerPath = path.join(root, 'backlog', 'standing-reds.tsv');
  fs.mkdirSync(path.dirname(registerPath), { recursive: true });
  fs.writeFileSync(registerPath, `# fixture register\n${rows.join('\n')}\n`);
}

test('property: the recommended cap is always exactly the fold of the rework and standing-red caps, and always one of Article 3.5s two named caps or null', () => {
  const seen = new Set();
  fc.assert(
    fc.property(fc.constantFrom(...REWORK_CATEGORIES), fc.constantFrom(...STANDING_CATEGORIES), (reworkCat, standingCat) => {
      seen.add(`${reworkCat}:${standingCat}`);
      const root = mkTmp();
      writeReworkCategory(root, reworkCat);
      writeStandingCategory(root, standingCat);
      const rec = computeThrottleRecommendation(root);
      const expected = expectedFold(expectedReworkCap(reworkCat), expectedStandingCap(standingCat));
      assert.equal(rec.recommendedCap, expected, `reworkCat=${reworkCat} standingCat=${standingCat}`);
      assert.ok(
        rec.recommendedCap === null || rec.recommendedCap === 0 || rec.recommendedCap === 1,
        `recommendedCap must be null, 0 or 1 - got ${rec.recommendedCap}`
      );
    }),
    { numRuns: 60 }
  );
  // Reachability floor (engineering.prompt): every one of the 12
  // rework-category x standing-category combinations, including the
  // ties this fold must resolve without raising, was actually exercised.
  assert.equal(seen.size, REWORK_CATEGORIES.length * STANDING_CATEGORIES.length, `expected all 12 combinations reached, got ${[...seen].sort().join(',')}`);
});

// ── invariant 2: "Every change of the recommended cap is logged with the ──
//    signal that caused or cleared it (count, age or unowned)... a
//    recommendation that persists unchanged logs nothing." ────────────────
//
// Isolated to standing-red-only transitions (no rework signal at all) since
// the invariant's own parenthetical names exactly the three standing-red
// signals - the rework-severity wording is a separate, pre-existing (BL-432)
// code path this ticket does not change.

test('property: a cap change is logged exactly once naming the correct signal; an unchanged cap logs nothing', () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...STANDING_CATEGORIES), { minLength: 2, maxLength: 5 }), (sequence) => {
      const root = mkTmp();
      let priorCap = null;
      let priorSignal = null;
      let priorLines = [];
      for (const state of sequence) {
        writeStandingCategory(root, state);
        emitThrottleRecommendation(root);
        const lines = readLogLines(root);
        const newLines = lines.slice(priorLines.length);
        const thisCap = state === 'none' ? null : 1;
        const thisSignal = state === 'none' ? null : state;
        if (thisCap !== priorCap) {
          assert.equal(newLines.length, 1, `expected exactly one new log line on cap change ${priorCap}->${thisCap}, got ${newLines.length}`);
          const entry = newLines[0];
          assert.equal(entry.from, priorCap);
          assert.equal(entry.to, thisCap);
          const namedSignal = thisCap !== null ? thisSignal : priorSignal;
          assert.ok(namedSignal, 'a logged transition must have a known signal to name');
          assert.ok(
            entry.reason.includes(describeStandingRedSignal(namedSignal)),
            `expected reason to name ${namedSignal} ("${describeStandingRedSignal(namedSignal)}"), got: ${entry.reason}`
          );
          for (const other of STANDING_CATEGORIES.filter((s) => s !== 'none' && s !== namedSignal)) {
            assert.ok(
              !entry.reason.includes(describeStandingRedSignal(other)),
              `expected reason to name ONLY ${namedSignal}, but it also contains ${other}'s phrase: ${entry.reason}`
            );
          }
        } else {
          assert.equal(newLines.length, 0, `expected no new log line when the cap stayed ${priorCap}, got ${newLines.length}`);
        }
        priorCap = thisCap;
        priorSignal = thisSignal;
        priorLines = lines;
      }
    }),
    { numRuns: 24 }
  );
});

// ── invariant 3: "Thresholds are read from swarmforge.conf ────────────────
//    (standing_red_max_count, standing_red_max_age_days) with defaults 10
//    and 7 when absent; an unowned red throttles at any threshold." ───────

const maxCountArb = fc.integer({ min: 1, max: 50 });
const maxAgeDaysArb = fc.integer({ min: 1, max: 50 });

test('property: thresholds round-trip through swarmforge.conf exactly, independently per key', () => {
  fc.assert(
    fc.property(fc.option(maxCountArb, { nil: undefined }), fc.option(maxAgeDaysArb, { nil: undefined }), (maxCount, maxAgeDays) => {
      const root = mkTmpDir('bl1429-prop-thresholds-');
      const lines = [];
      if (maxCount !== undefined) lines.push(`config standing_red_max_count ${maxCount}`);
      if (maxAgeDays !== undefined) lines.push(`config standing_red_max_age_days ${maxAgeDays}`);
      if (lines.length > 0) {
        fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
        fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines.join('\n') + '\n');
      }
      const result = readStandingRedThresholds(root);
      assert.equal(result.maxCount, maxCount ?? DEFAULT_STANDING_RED_MAX_COUNT);
      assert.equal(result.maxAgeDays, maxAgeDays ?? DEFAULT_STANDING_RED_MAX_AGE_DAYS);
    }),
    { numRuns: 60 }
  );
});

test('property: crossing is evaluated against the GIVEN thresholds (never a hardcoded 10/7), and an unowned red recommends cap 1 regardless of how permissive the thresholds are', () => {
  fc.assert(
    fc.property(
      maxCountArb,
      maxAgeDaysArb,
      fc.integer({ min: 0, max: 80 }),
      fc.option(fc.integer({ min: 0, max: 80 }), { nil: null }),
      fc.integer({ min: 0, max: 3 }),
      (maxCount, maxAgeDays, count, oldestAgeDays, unownedLen) => {
        const thresholds = { maxCount, maxAgeDays };
        const report = {
          count,
          oldest_age_days: oldestAgeDays,
          unowned: Array.from({ length: unownedLen }, (_, i) => ({ file: `f${i}` })),
        };
        const result = standingRedSignal(report, thresholds);
        if (unownedLen > 0) {
          assert.deepEqual(result, { recommendedCap: 1, signal: 'unowned' });
        } else if (count > maxCount) {
          assert.deepEqual(result, { recommendedCap: 1, signal: 'count' });
        } else if (oldestAgeDays !== null && oldestAgeDays > maxAgeDays) {
          assert.deepEqual(result, { recommendedCap: 1, signal: 'age' });
        } else {
          assert.equal(result, null);
        }
      }
    ),
    { numRuns: 300 }
  );
});
