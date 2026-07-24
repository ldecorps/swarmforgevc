const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  formatBounceHistoryEntry,
  parseBounceHistoryEntries,
  mergeBounceHistoryEntry,
} = require('../out/quality/bounceHistory');

// BL-608: bounceHistory.ts is the pure render/merge core behind a ticket's own
// `bounce_count:`/`bounce_history:` record - the git-visible per-ticket
// counterpart to the gitignored qa_bounces JSONL aggregate. bounceHistory.test.js
// pins it at seven hand-picked examples; the invariants below are the ones the
// ticket's Shape items actually promise, and they must hold across every
// ticket body and every bounce sequence, not just those examples:
//
//   #1/#3  bounce_count ALWAYS equals the entry-list length, and entries stay
//          oldest-first as they accumulate;
//   #4     re-recording the same bounce (natural key = date + failure class)
//          is a byte-identical no-op, however long the history already is;
//   #6     never throws, and never destroys the ticket body it was handed.
//
// The round-trip (format -> merge -> parse recovers every field verbatim) is
// what makes the record answerable from the ticket alone - the ticket's whole
// point. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the unit/coverage/mutation run.

const KNOWN_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'];
const KNOWN_BLAMED = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'];

// Dates are generated as an ordered day index rather than a real clock, so the
// sequence's chronology is the property's input and not an accident of wall
// time (engineering.prompt: pin fixture clocks).
const dayArb = fc.integer({ min: 1, max: 28 }).map((d) => `2026-07-${String(d).padStart(2, '0')}`);
const commitArb = fc.stringMatching(/^[0-9a-f]{10}$/);
const evidenceArb = fc
  .stringMatching(/^[A-Za-z0-9-]{1,20}$/)
  .map((stem) => `backlog/evidence/${stem}.md`);

const entryArb = fc.record({
  at: dayArb,
  by: fc.constant('QA'),
  blamed: fc.constantFrom(...KNOWN_BLAMED),
  failureClass: fc.constantFrom(...KNOWN_CLASSES),
  commit: commitArb,
  evidence: evidenceArb,
});

// A plausible hand-authored ticket body: scalar keys plus an optional trailing
// block scalar, which is the case appendBlock's "top-level key at column 0
// terminates the preceding block" behaviour depends on.
const ticketBodyArb = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z ]{1,30}$/),
    fc.integer({ min: 1, max: 9 }),
    fc.boolean(),
    fc.stringMatching(/^[A-Za-z ]{1,30}$/)
  )
  .map(([title, priority, withBlock, prose]) => {
    // Trimmed: appendBlock normalizes trailing whitespace at end-of-file, so a
    // generated trailing space would fail the body-preservation property on a
    // difference YAML does not consider meaningful.
    const head = `id: BL-608\ntitle: "${title.trim()}"\npriority: ${priority}\n`;
    return withBlock ? `${head}description: |\n  ${prose.trim()}\n` : head;
  });

function countInText(text) {
  const match = /^bounce_count: (\d+)$/m.exec(text);
  return match ? Number(match[1]) : null;
}

const naturalKey = (e) => `${e.at}|${e.failureClass}`;

// Applies a sequence of merges, returning the final text. Mirrors what
// repeated QA bounces on one ticket do to that ticket's own YAML.
function mergeAll(body, entries) {
  return entries.reduce((text, entry) => mergeBounceHistoryEntry(text, entry).text, body);
}

test('bounce_count always equals the number of entries actually in the list', () => {
  fc.assert(
    fc.property(ticketBodyArb, fc.array(entryArb, { minLength: 1, maxLength: 6 }), (body, entries) => {
      const text = mergeAll(body, entries);
      assert.equal(countInText(text), parseBounceHistoryEntries(text).length);
    })
  );
});

test('a stale or tampered on-disk bounce_count is recomputed, never trusted', () => {
  fc.assert(
    fc.property(
      ticketBodyArb,
      fc.array(entryArb, { minLength: 1, maxLength: 4 }),
      entryArb,
      fc.integer({ min: 0, max: 99 }),
      (body, seeded, next, lie) => {
        const seededText = mergeAll(body, seeded);
        const tampered = seededText.replace(/^bounce_count: \d+$/m, `bounce_count: ${lie}`);
        const result = mergeBounceHistoryEntry(tampered, next);
        const text = result.updated ? result.text : tampered;
        // A duplicate is a no-op and keeps the lie; any real append recomputes.
        if (result.updated) {
          assert.equal(countInText(text), parseBounceHistoryEntries(text).length);
        }
      }
    )
  );
});

test('entries accumulate oldest-first: an append never reorders or drops history', () => {
  fc.assert(
    fc.property(ticketBodyArb, fc.array(entryArb, { minLength: 1, maxLength: 6 }), (body, entries) => {
      const text = mergeAll(body, entries);
      const parsed = parseBounceHistoryEntries(text);
      // Duplicates on the natural key are dropped by design (shape #4), so the
      // survivors are the first occurrence of each key, in arrival order.
      const expected = [];
      const seen = new Set();
      for (const entry of entries) {
        if (!seen.has(naturalKey(entry))) {
          seen.add(naturalKey(entry));
          expected.push(entry);
        }
      }
      assert.deepEqual(
        parsed.map(naturalKey),
        expected.map(naturalKey)
      );
    })
  );
});

test('every appended entry round-trips: parse recovers each field verbatim', () => {
  fc.assert(
    fc.property(ticketBodyArb, entryArb, (body, entry) => {
      const parsed = parseBounceHistoryEntries(mergeBounceHistoryEntry(body, entry).text);
      assert.equal(parsed.length, 1);
      // Spread: fc.record yields a null-prototype object, which strict
      // deepEqual would reject on prototype alone.
      assert.deepEqual(parsed[0], { ...entry });
      assert.equal(formatBounceHistoryEntry(parsed[0]), formatBounceHistoryEntry(entry));
    })
  );
});

test('re-recording the same bounce is a byte-identical no-op at any history length', () => {
  fc.assert(
    fc.property(ticketBodyArb, fc.array(entryArb, { minLength: 1, maxLength: 6 }), (body, entries) => {
      const text = mergeAll(body, entries);
      for (const entry of entries) {
        const again = mergeBounceHistoryEntry(text, entry);
        assert.equal(again.updated, false);
        assert.equal(again.reason, 'duplicate');
        assert.equal(again.text, text);
      }
    })
  );
});

test('merging never throws and never destroys the ticket body it was handed', () => {
  fc.assert(
    fc.property(ticketBodyArb, fc.array(entryArb, { minLength: 1, maxLength: 6 }), (body, entries) => {
      const text = mergeAll(body, entries);
      // Every original key line survives, so the record is added to the ticket,
      // not written over it.
      for (const line of body.split('\n').filter((l) => l.trim() !== '')) {
        assert.ok(text.includes(line), `merge dropped the ticket line: ${JSON.stringify(line)}`);
      }
    })
  );
});
