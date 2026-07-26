const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeRoundsPerCloseSeriesByRole, computeMaxRoundsIndicator, REWORK_ATTRIBUTION_EPOCH_ISO } = require('../out/metrics/reworkRounds');
const { bounceAttribution, computeBounceTallyByBouncingRole } = require('../out/quality/qaBounce');

// BL-635 (BL-654: coder owns first authorship of each declared invariant's
// property test): the ticket declares three invariants. Each gets its own
// property below, targeting the exact pure modules that carry it - never
// the CLI, prompts, or briefing markdown, which are process/prose and
// exercised by the acceptance suite instead. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs); excluded from
// the unit/coverage/mutation run.

const DAY_MS = 24 * 60 * 60 * 1000;
const KNOWN_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'];
const KNOWN_BOUNCE_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

const ticketArb = fc.integer({ min: 1, max: 99999 }).map((n) => `BL-${n}`);
const commitArb = fc.integer({ min: 0, max: 0xffffffffff }).map((n) => n.toString(16).padStart(10, '0').slice(0, 10));
const bounceRoleArb = fc.constantFrom(...KNOWN_BOUNCE_ROLES);
const atOffsetArb = fc.integer({ min: 0, max: 120 }).map((dayOffset) => new Date(Date.parse('2026-06-01T00:00:00.000Z') + dayOffset * DAY_MS).toISOString());

// ── invariant 1: "Every bounce-metric consumer sources from the durable ────
//    bounce log or ticket bounce_history only - commit subjects and
//    briefing prose are never read as bounce data" ─────────────────────────
//
// Neither computeMaxRoundsIndicator nor computeBounceTallyByBouncingRole
// accepts a commit-subject or ticket-title field at all - this property
// proves that operationally, not just by the type signature: gluing
// bounce-shaped prose (including the literal word "bounce") onto every
// record as extra, unread fields must never change either function's
// result. A code path that started reading that prose would fail this.
test('property: injecting bounce-shaped prose into unrelated record fields never changes the computed rounds or tally', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ ticket: ticketArb, commit: commitArb, at: atOffsetArb, by: fc.option(bounceRoleArb, { nil: undefined }) }),
        { minLength: 0, maxLength: 8 }
      ),
      fc.string({ minLength: 0, maxLength: 40 }),
      (partials, noise) => {
        const clean = partials.map((p) => ({ ...p, producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior' }));
        const withNoise = clean.map((r) => ({ ...r, commitSubject: `${noise} bounce fix`, ticketTitle: `${noise}-bounce-watcher-resilience` }));
        assert.deepEqual(computeMaxRoundsIndicator(clean), computeMaxRoundsIndicator(withNoise));
        assert.deepEqual(computeBounceTallyByBouncingRole(clean), computeBounceTallyByBouncingRole(withNoise));
      }
    )
  );
});

// ── invariant 2: "A bounce record lacking `by` aggregates as unattributed ──
//    - never silently attributed to QA or any other role" ─────────────────

test('property: a bounce record with no `by` always attributes as unattributed, never a named role', () => {
  fc.assert(
    fc.property(ticketArb, commitArb, atOffsetArb, fc.constantFrom(...KNOWN_CLASSES), (ticket, commit, at, failureClass) => {
      const record = { ticket, producingRole: 'coder', ticketType: 'defect', failureClass, commit, at };
      assert.equal(bounceAttribution(record), 'unattributed');
    })
  );
});

test('property: a bounce record WITH a known `by` role always attributes to exactly that role, never unattributed', () => {
  fc.assert(
    fc.property(ticketArb, commitArb, atOffsetArb, fc.constantFrom(...KNOWN_CLASSES), bounceRoleArb, (ticket, commit, at, failureClass, by) => {
      const record = { ticket, producingRole: 'coder', ticketType: 'defect', failureClass, commit, at, by };
      assert.equal(bounceAttribution(record), by);
    })
  );
});

test('property: aggregation never folds by-less records into a named role - unattributed and every named role stay exact partitions', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ ticket: ticketArb, commit: commitArb, at: atOffsetArb, by: fc.option(bounceRoleArb, { nil: undefined }) }),
        { minLength: 0, maxLength: 20 }
      ),
      (partials) => {
        const records = partials.map((p) => ({ ...p, producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior' }));
        const tally = computeBounceTallyByBouncingRole(records);
        const countOf = (role) => tally.find((t) => t.role === role)?.count ?? 0;
        assert.equal(
          countOf('unattributed'),
          records.filter((r) => r.by === undefined).length
        );
        for (const role of KNOWN_BOUNCE_ROLES) {
          assert.equal(
            countOf(role),
            records.filter((r) => r.by === role).length
          );
        }
        // partition: every record counted exactly once, across unattributed
        // plus every named role - never dropped, never double-counted.
        assert.equal(
          tally.reduce((sum, t) => sum + t.count, 0),
          records.length
        );
      }
    )
  );
});

// ── invariant 3: "Absence of recorded data (a pre-epoch period) renders as ─
//    unavailable on every surface - never as zero" ─────────────────────────
//
// This is the exact invariant BL-635 SEND BACK #1 found violated on
// computeRoundsPerCloseSeriesByRole's current-window point. The "now"
// generator below is deliberately a small, HAND-WEIGHTED set of categories
// (never a uniform-random date) so the pre-epoch and zero-closed states -
// the ones the original defect lived in - are reached on every run, not
// buried under the far larger "ordinary, fully post-epoch" case a uniform
// generator would produce almost exclusively (engineering.prompt's
// generator-reach requirement).
const EPOCH_MS = Date.parse(`${REWORK_ATTRIBUTION_EPOCH_ISO}T00:00:00.000Z`);
const WINDOW_MS = 7 * DAY_MS;

const nowCategoryArb = fc.constantFrom(
  'entirely-pre-epoch', // current window ends strictly before the epoch
  'straddling-epoch', // current window starts before, ends after the epoch
  'comfortably-post-epoch' // current window is fully after the epoch
);

function nowMsForCategory(category) {
  if (category === 'entirely-pre-epoch') return EPOCH_MS - DAY_MS;
  if (category === 'straddling-epoch') return EPOCH_MS + 2 * DAY_MS;
  return EPOCH_MS + 30 * DAY_MS;
}

const windowOffsetArb = fc.integer({ min: 0, max: WINDOW_MS - 1 });

test('property: the current-window rounds-per-close figure is unavailable exactly when the window is entirely pre-epoch or closed zero tickets, and a real ratio otherwise', () => {
  fc.assert(
    fc.property(
      nowCategoryArb,
      fc.array(windowOffsetArb, { minLength: 1, maxLength: 5 }), // bounce offsets within the current window
      fc.array(windowOffsetArb, { minLength: 0, maxLength: 3 }), // closed-ticket offsets within the current window
      (category, bounceOffsets, closedOffsets) => {
        const nowMs = nowMsForCategory(category);
        const currentStart = nowMs - WINDOW_MS;
        const records = bounceOffsets.map((offset, i) => ({
          ticket: 'BL-1',
          producingRole: 'coder',
          ticketType: 'defect',
          failureClass: 'behavior',
          commit: i.toString(16).padStart(10, '0'),
          at: new Date(currentStart + offset).toISOString(),
          by: 'architect',
        }));
        const closedDateIsos = closedOffsets.map((offset) => new Date(currentStart + offset).toISOString());

        const series = computeRoundsPerCloseSeriesByRole(records, closedDateIsos, nowMs);
        const currentPoint = series.architect[series.architect.length - 1];

        const entirelyPreEpoch = nowMs <= EPOCH_MS;
        const zeroClosed = closedDateIsos.length === 0;
        if (entirelyPreEpoch || zeroClosed) {
          // real bounces and closes may both be present (this is exactly
          // the reproduced defect: fabricating a healthy-looking ratio out
          // of data that predates measurement, or dividing by zero closes)
          // - it must still read unavailable, never a number.
          assert.equal(currentPoint.value, null);
        } else {
          assert.equal(currentPoint.value, records.length / closedDateIsos.length);
        }
      }
    )
  );
});
