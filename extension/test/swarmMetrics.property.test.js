const assert = require('node:assert/strict');
const fc = require('fast-check');
const { extractTicketId } = require('../out/metrics/swarmMetrics');

// BL-504: extractTicketId's canonicalization ("bl493" / "BL-493" / "bl-493"
// all resolve to the same "BL-493") is exactly the parsing/canonicalization
// stability the architect's Property Testing section calls for - a broad
// input range beyond the handful of hand-picked examples in
// swarmMetrics.test.js. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - never the normal unit/coverage/mutation
// run.

const allowlistedPrefix = () => fc.constantFrom('BL', 'GH', 'bl', 'gh', 'Bl', 'gH');
const digits = () => fc.integer({ min: 0, max: 999999 }).map((n) => String(n));
const optionalHyphen = () => fc.constantFrom('-', '');
const suffix = () => fc.constantFrom('', '-x', '-fold-ticket-events', 'anything');

test('property: extractTicketId canonicalizes any allowlisted prefix/case/hyphen combination to the same upper-case hyphenated form', () => {
  fc.assert(
    fc.property(allowlistedPrefix(), optionalHyphen(), digits(), suffix(), (prefix, hyphen, digitStr, tail) => {
      const task = `${prefix}${hyphen}${digitStr}${tail}`;
      const result = extractTicketId(task);
      assert.equal(result, `${prefix.toUpperCase()}-${digitStr}`);
    })
  );
});

test('property: extractTicketId is idempotent - feeding its own canonical output back in resolves to itself', () => {
  fc.assert(
    fc.property(allowlistedPrefix(), optionalHyphen(), digits(), suffix(), (prefix, hyphen, digitStr, tail) => {
      const task = `${prefix}${hyphen}${digitStr}${tail}`;
      const first = extractTicketId(task);
      const second = extractTicketId(first);
      assert.equal(second, first);
    })
  );
});

test('property: extractTicketId rejects any prefix outside the (BL|GH) allowlist, never over-matching a glued or incidental letter run', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[A-Za-z]+$/.test(s) && !/^(bl|gh)/i.test(s)),
      optionalHyphen(),
      digits(),
      suffix(),
      (prefix, hyphen, digitStr, tail) => {
        const task = `${prefix}${hyphen}${digitStr}${tail}`;
        assert.equal(extractTicketId(task), null);
      }
    )
  );
});
