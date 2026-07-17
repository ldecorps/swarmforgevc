const assert = require('node:assert/strict');
const fc = require('fast-check');
const { budgetPipelineBoardLinks, deriveKebabSlug, deriveDisplayTicketId, compareLinksMostRecentFirst } = require('../out/concierge/pipelineBoard');

// BL-502 (architect, property-testing support): budgetPipelineBoardLinks is
// the pure trim function this ticket introduced to keep the pipeline board's
// composed Telegram message under the send limit - it decides, for any link
// list and any remaining budget, how large a PREFIX of the list still fits.
// pipelineBoard.test.js pins this with a handful of hand-picked sizes/budgets
// (3 links that fit, 30/50 that don't, a budget too small even for the
// overflow indicator); the within-budget and prefix-conservation contract
// holds for every list size and every non-negative budget, not just those
// examples - the "conservation/counting" and "ordering/monotonicity" shapes
// architect.prompt's Property Testing section names. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs); excluded from
// the normal unit/coverage/mutation run.

const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';

function links(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `L${i}`, path: `backlog/active/L${i}-a-fine-feature.yaml` }));
}

// The realistic domain: syncPipelineBoard always computes a non-negative-in-
// practice budget (the grid/parked body is small and bounded, per the
// ticket's own notes); a negative budget is the documented pathological
// case that degrades to no links; this property covers the domain the
// function is actually called with.
const budgetArb = fc.integer({ min: 0, max: 4000 });
const countArb = fc.integer({ min: 0, max: 80 });

test('property: the trimmed html never exceeds the given budget, for any link-list size and any non-negative budget', () => {
  fc.assert(
    fc.property(countArb, budgetArb, (count, maxLinksLength) => {
      const result = budgetPipelineBoardLinks(links(count), REPO_BASE_URL, maxLinksLength);
      assert.ok(
        result.html.length <= maxLinksLength,
        `count=${count} budget=${maxLinksLength} produced html.length=${result.html.length}`
      );
    })
  );
});

// The included links are always the largest PREFIX of the original list
// that fits - never a reordering, never a hole in the middle. omittedCount
// alone pins the covered links; check every id before the cut is present
// and every id at/after the cut is absent, which also proves omittedCount
// itself is exact (included + omitted === total, by construction of the
// slice), a conservation check on top of the ordering one.
test('property: the included links are always an in-order PREFIX of the input, and omittedCount is exact', () => {
  fc.assert(
    fc.property(countArb, budgetArb, (count, maxLinksLength) => {
      const list = links(count);
      const result = budgetPipelineBoardLinks(list, REPO_BASE_URL, maxLinksLength);
      const includedCount = list.length - result.omittedCount;
      assert.ok(includedCount >= 0 && includedCount <= list.length, `includedCount=${includedCount} out of range for count=${count}`);
      for (let i = 0; i < includedCount; i += 1) {
        assert.ok(result.html.includes(`${list[i].id}:`), `expected prefix link ${list[i].id} present, budget=${maxLinksLength}`);
      }
      for (let i = includedCount; i < list.length; i += 1) {
        assert.ok(!result.html.includes(`${list[i].id}:`), `expected tail link ${list[i].id} absent, budget=${maxLinksLength}`);
      }
    })
  );
});

// A larger budget can only ever include the same or more links, never
// fewer - monotonicity in the one dimension the caller actually varies
// (the room left after the grid/parked body shrinks or grows tick to tick).
test('property: a larger budget never includes fewer links than a smaller one, for the same list', () => {
  fc.assert(
    fc.property(countArb, budgetArb, budgetArb, (count, budgetA, budgetB) => {
      const [smaller, larger] = budgetA <= budgetB ? [budgetA, budgetB] : [budgetB, budgetA];
      const list = links(count);
      const resultSmaller = budgetPipelineBoardLinks(list, REPO_BASE_URL, smaller);
      const resultLarger = budgetPipelineBoardLinks(list, REPO_BASE_URL, larger);
      const includedSmaller = list.length - resultSmaller.omittedCount;
      const includedLarger = list.length - resultLarger.omittedCount;
      assert.ok(
        includedLarger >= includedSmaller,
        `budget ${smaller}->${includedSmaller} included, ${larger}->${includedLarger} included: expected non-decreasing`
      );
    })
  );
});

// BL-505 (architect, property-testing support): deriveKebabSlug and
// deriveDisplayTicketId are pure and were introduced/narrowed by this
// ticket. pipelineBoard.test.js pins each with a handful of hand-picked
// titles/ids; the invariants below hold for any title/maxWords or any id,
// not just those examples - the "ordering/counting" and "idempotence"
// shapes architect.prompt's Property Testing section names.

test('property: deriveKebabSlug never returns more than maxWords hyphenated words, for any title', () => {
  fc.assert(
    fc.property(fc.string(), fc.integer({ min: 1, max: 10 }), (title, maxWords) => {
      const slug = deriveKebabSlug(title, maxWords);
      const wordCount = slug === '' ? 0 : slug.split('-').length;
      assert.ok(wordCount <= maxWords, `title=${JSON.stringify(title)} maxWords=${maxWords} slug=${JSON.stringify(slug)} wordCount=${wordCount}`);
    })
  );
});

test('property: deriveDisplayTicketId is idempotent - re-stripping an already-displayed id is a no-op', () => {
  fc.assert(
    fc.property(fc.string(), (id) => {
      const once = deriveDisplayTicketId(id);
      const twice = deriveDisplayTicketId(once);
      assert.equal(twice, once, `id=${JSON.stringify(id)} once=${JSON.stringify(once)} twice=${JSON.stringify(twice)}`);
    })
  );
});

// BL-506 (architect, property-testing support): compareLinksMostRecentFirst is
// the pure comparator this ticket introduced for the LINKS section's order.
// pipelineBoard.test.js and the feature's Gherkin scenarios pin it with a
// handful of hand-picked id lists; the "every numbered link outranks every
// unnumbered one, and numbered links never increase" ordering contract holds
// for any list of ids, not just those examples - the "ordering/monotonicity"
// shape architect.prompt's Property Testing section names.

const TICKET_ID_PATTERN = /^(?:BL|GH)-(\d+)$/;
function ticketNumberOf(id) {
  const match = TICKET_ID_PATTERN.exec(id);
  return match ? Number(match[1]) : undefined;
}

const numberedIdArb = fc
  .tuple(fc.constantFrom('BL', 'GH'), fc.nat({ max: 10000 }))
  .map(([prefix, n]) => `${prefix}-${n}`);
const unnumberedIdArb = fc.string().map((s) => `INTAKE-${s}`);
const linkEntryArb = fc.oneof(numberedIdArb, unnumberedIdArb).map((id) => ({ id, path: `backlog/${id}.yaml` }));

test('property: sorting with compareLinksMostRecentFirst puts every numbered link before every unnumbered one, and numbered links are non-increasing by ticket number', () => {
  fc.assert(
    fc.property(fc.array(linkEntryArb, { maxLength: 50 }), (entries) => {
      const sorted = [...entries].sort(compareLinksMostRecentFirst);
      const numbers = sorted.map((e) => ticketNumberOf(e.id));
      let sawUnnumbered = false;
      let previousNumber;
      for (const n of numbers) {
        if (n === undefined) {
          sawUnnumbered = true;
          continue;
        }
        assert.ok(!sawUnnumbered, `numbered id found after an unnumbered one: ${JSON.stringify(numbers)}`);
        if (previousNumber !== undefined) {
          assert.ok(n <= previousNumber, `ticket numbers not non-increasing: ${JSON.stringify(numbers)}`);
        }
        previousNumber = n;
      }
    })
  );
});
