const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mergeIntakes, splitIntake, isConsolidationTarget } = require('../out/tools/intakeConsolidationCore');

// BL-680 coder-authored property tests, one per declared ticket invariant
// (coder.prompt's Invariants section, BL-654). Invariants 1 and 3 quantify
// over "consolidation" as a whole - both the N:1 merge and the 1:N split -
// so each gets a merge-side AND a split-side property test (architect
// bounce, 2026-08-01: the first pass only encoded the merge side):
//
//   1. "No consolidation drops a human sentence" -> mergeIntakes (merge
//      side) and splitIntake's directive broadcast (split side) below.
//   2. "Consolidation reads and writes spec-time artifacts only ... no
//      ticket in backlog/active/ is ever modified" -> isConsolidationTarget
//      below.
//   3. "The intake-to-ticket mapping is total in both directions" ->
//      splitIntake's mechanism/ticket-id bijection (forward) and its
//      per-part sourceIntakeId back-reference (reverse) below.
//
// All three admit an executable encoding over the pure module this ticket
// ships (extension/src/tools/intakeConsolidationCore.ts), so all three get a
// property test rather than a stated non-encodability reason.
//
// Non-vacuity, verified by hand per engineering.prompt (temporarily broken,
// confirmed to fail, then restored):
//   - mergeIntakes: changed the union loop to `directives = sources[0].
//     directives` (drops every directive from sources[1:]) - the first test
//     below failed on the very first shrunk counterexample (two sources,
//     each with one distinct directive).
//   - isConsolidationTarget: changed the active/ check to
//     `!relativePath.startsWith('backlog/active/x')` (an always-false guard)
//     - the active-path refusal test failed immediately.
//   - splitIntake: removed the `new Set(mechanisms).size !== mechanisms.
//     length` guard - the "refuses a repeated mechanism" test failed
//     immediately (no throw).
//   - splitIntake directive broadcast: changed `parts.map((p) => ({ ...p,
//     directives: directives.slice(), sourceIntakeId }))` to only attach
//     directives to `parts[0]` - the broadcast property below failed
//     immediately on any source with 2+ parts and 1+ directives.
//   - splitIntake back-reference: changed the same map to omit
//     `sourceIntakeId` from the per-part object - the back-reference
//     property below failed immediately (received `undefined`).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

// ── Invariant 1: mergeIntakes never drops a directive ───────────────────

// Deliberately small, closed vocabulary so two independently-drawn sources
// collide on a directive on a meaningful fraction of runs - a wide-open
// string generator would make every source's directives disjoint almost
// always, and the "a shared directive must still survive, undeduplicated
// away" failure mode would go unexercised (same rationale as
// bounceNaturalKey.property.test.js's small-domain generators).
const DIRECTIVE_VOCAB = [
  'ship the walker for the profiler',
  'ship the walker for the burn meter',
  'wire the profiler',
  'retire the old cron',
  'notify the operator before cutover',
];
const directiveArb = fc.constantFrom(...DIRECTIVE_VOCAB);
const sourceArb = fc.record({
  intakeId: fc.string({ minLength: 1, maxLength: 10 }),
  directives: fc.uniqueArray(directiveArb, { minLength: 1, maxLength: 3 }),
});
const sourcesArb = fc.array(sourceArb, { minLength: 2, maxLength: 5 });

test('property: mergeIntakes carries every directive from every source, verbatim, whether or not sources overlap', () => {
  const seen = { overlap: false, disjoint: false, threeOrMoreSources: false };
  fc.assert(
    fc.property(sourcesArb, (sources) => {
      const allDirectives = sources.flatMap((s) => s.directives);
      const uniqueCount = new Set(allDirectives).size;
      if (uniqueCount < allDirectives.length) seen.overlap = true;
      if (uniqueCount === allDirectives.length) seen.disjoint = true;
      if (sources.length >= 3) seen.threeOrMoreSources = true;

      const merged = mergeIntakes(sources);

      for (const source of sources) {
        for (const directive of source.directives) {
          assert.ok(merged.directives.includes(directive), `merged ticket dropped directive "${directive}" from ${source.intakeId}`);
        }
      }
      // The union is deduplicated - no directive appears twice.
      assert.equal(new Set(merged.directives).size, merged.directives.length);
      assert.deepEqual(
        merged.sourceIntakeIds,
        sources.map((s) => s.intakeId)
      );
    })
  );
  const missed = Object.entries(seen)
    .filter(([, reached]) => !reached)
    .map(([category]) => category);
  assert.deepEqual(missed, [], `generator never reached: ${missed.join(', ')} - the property would pass vacuously there`);
});

// ── Invariant 2: a consolidation pass never targets backlog/active/ ─────

const pathSuffixArb = fc.string({ maxLength: 24 });

test('property: isConsolidationTarget refuses every path under backlog/active/, regardless of suffix', () => {
  fc.assert(
    fc.property(pathSuffixArb, (suffix) => {
      assert.equal(isConsolidationTarget(`backlog/active/${suffix}`), false);
    })
  );
});

test('property: isConsolidationTarget allows every path under either spec-time root, regardless of suffix', () => {
  fc.assert(
    fc.property(pathSuffixArb, fc.boolean(), (suffix, usePaused) => {
      const path = usePaused ? `backlog/paused/${suffix}` : `.swarmforge/operator/INTAKE-${suffix}`;
      assert.equal(isConsolidationTarget(path), true);
    })
  );
});

test('property: isConsolidationTarget refuses a path outside every recognized root', () => {
  fc.assert(
    fc.property(fc.constantFrom('backlog/done/', 'backlog/hold/', 'specs/features/'), pathSuffixArb, (root, suffix) => {
      assert.equal(isConsolidationTarget(`${root}${suffix}`), false);
    })
  );
});

// ── Invariant 3: splitIntake's mapping is total in both directions ──────

const MECHANISM_VOCAB = ['turn profiler', 'context-telemetry producer', "budget governor's burn meter", 'retire old cron', 'notify operator'];
const mechanismArb = fc.constantFrom(...MECHANISM_VOCAB);
const ticketIdArb = fc.integer({ min: 900, max: 999 }).map((n) => `BL-${n}`);

const partsArb = fc.integer({ min: 2, max: MECHANISM_VOCAB.length }).chain((n) =>
  fc
    .tuple(fc.uniqueArray(mechanismArb, { minLength: n, maxLength: n }), fc.uniqueArray(ticketIdArb, { minLength: n, maxLength: n }))
    .map(([mechanisms, ticketIds]) => mechanisms.map((mechanism, i) => ({ ticketId: ticketIds[i], mechanism })))
);

test('property: splitIntake names every mechanism in exactly one resulting ticket and the archived intake points at every ticket id', () => {
  const seen = { twoParts: false, allFiveParts: false };
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 10 }), partsArb, (sourceIntakeId, parts) => {
      if (parts.length === 2) seen.twoParts = true;
      if (parts.length === MECHANISM_VOCAB.length) seen.allFiveParts = true;

      const result = splitIntake(sourceIntakeId, [], parts);

      assert.equal(result.sourceIntakeId, sourceIntakeId);
      assert.equal(result.parts.length, parts.length);
      // Bijection: every proposed mechanism is named in EXACTLY one resulting ticket.
      for (const part of parts) {
        const occurrences = result.parts.filter((p) => p.mechanism === part.mechanism).length;
        assert.equal(occurrences, 1, `mechanism "${part.mechanism}" appeared ${occurrences} times, expected exactly 1`);
      }
      // Totality: the archived intake (the split result) points at every resulting ticket id.
      const resultTicketIds = new Set(result.parts.map((p) => p.ticketId));
      for (const part of parts) {
        assert.ok(resultTicketIds.has(part.ticketId), `archived intake does not point at ticket "${part.ticketId}"`);
      }
    })
  );
  const missed = Object.entries(seen)
    .filter(([, reached]) => !reached)
    .map(([category]) => category);
  assert.deepEqual(missed, [], `generator never reached: ${missed.join(', ')} - the property would pass vacuously there`);
});

test('property: splitIntake refuses rather than silently drops a mechanism repeated across parts', () => {
  fc.assert(
    fc.property(partsArb, fc.nat(), (parts, pick) => {
      const dupIndex = pick % parts.length;
      const otherIndex = (dupIndex + 1) % parts.length; // parts.length >= 2, so always distinct from dupIndex
      const withDuplicateMechanism = parts.map((p, i) => (i === otherIndex ? { ...p, mechanism: parts[dupIndex].mechanism } : p));
      assert.throws(() => splitIntake('INTAKE-x', [], withDuplicateMechanism), /exactly one/);
    })
  );
});

// ── Invariant 1 (split side): every source directive survives a split ──

const directivesArb = fc.uniqueArray(directiveArb, { minLength: 0, maxLength: 3 });

test('property: splitIntake broadcasts every source directive onto every resulting ticket (architect bounce 2026-08-01, D1)', () => {
  const seen = { noDirectives: false, someDirectives: false };
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 10 }), directivesArb, partsArb, (sourceIntakeId, directives, parts) => {
      if (directives.length === 0) seen.noDirectives = true;
      if (directives.length > 0) seen.someDirectives = true;

      const result = splitIntake(sourceIntakeId, directives, parts);

      for (const directive of directives) {
        for (const part of result.parts) {
          assert.ok(
            part.directives.includes(directive),
            `resulting ticket "${part.ticketId}" dropped source directive "${directive}"`
          );
        }
      }
    })
  );
  const missed = Object.entries(seen)
    .filter(([, reached]) => !reached)
    .map(([category]) => category);
  assert.deepEqual(missed, [], `generator never reached: ${missed.join(', ')} - the property would pass vacuously there`);
});

// ── Invariant 3 (split side, reverse direction): each ticket names its intake ──

test('property: splitIntake records the source intake id on every resulting ticket independently (architect bounce 2026-08-01, D2)', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 10 }), partsArb, (sourceIntakeId, parts) => {
      const result = splitIntake(sourceIntakeId, [], parts);
      for (const part of result.parts) {
        assert.equal(
          part.sourceIntakeId,
          sourceIntakeId,
          `resulting ticket "${part.ticketId}" does not independently name the intake it came from`
        );
      }
    })
  );
});
