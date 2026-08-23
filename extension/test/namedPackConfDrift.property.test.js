'use strict';

// BL-1087 declared invariant (coder first authorship - BL-654):
// "No file under docs/ names a swarmforge/packs/*.conf that is not present
// in the tree, other than a placeholder that is illustrating pack naming
// rather than naming a real pack."
//
// Encoded against extension/out/docs/namedPackConfDrift.js. Placeholder
// rule: an ALL-CAPS pack stem (NAME, PACK, …) is illustrative — durable
// without a hardcoded exception list; real packs are kebab-case. The
// shipped-work log (docs/reference/Specification.MD) is excluded by path
// role so historical names of withdrawn packs are not reported as live drift.
//
// Generator reach: every draw builds a corpus that plants zero or more
// real absent names, zero or more existing names, and zero or more
// ALL-CAPS placeholders, so each verdict cell is hit by construction.
//
// Non-vacuity (staged-first restore, run 2026-08-23):
//   break 1 - findAbsentNamedPackConfs always returns []: RED when a draw
//     plants an absent real pack.
// Restored byte-for-byte; ALL PROPERTIES HOLD.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  findAbsentNamedPackConfs,
  isIllustrativePackPlaceholder,
  extractNamedPackConfs,
} = require('../out/docs/namedPackConfDrift');

const kebab = fc
  .tuple(fc.constantFrom('qwen', 'cursor', 'full', 'coder'), fc.constantFrom('mono', 'code', 'router', 'forge'))
  .map(([a, b]) => `${a}-${b}`);

const placeholderStem = fc.constantFrom('NAME', 'PACK', 'ROLE', 'AGENT');

test('BL-1087/BL-654 invariant: absent real packs are reported; placeholders and existing packs are not', () => {
  fc.assert(
    fc.property(
      fc.array(kebab, { minLength: 0, maxLength: 4 }),
      fc.array(kebab, { minLength: 0, maxLength: 4 }),
      fc.array(placeholderStem, { minLength: 0, maxLength: 3 }),
      (existingStems, absentStems, placeholders) => {
        const existing = [...new Set(existingStems)].map((s) => `swarmforge/packs/${s}.conf`);
        const absent = [...new Set(absentStems)]
          .filter((s) => !existingStems.includes(s))
          .map((s) => `swarmforge/packs/${s}.conf`);
        const ph = [...new Set(placeholders)].map((s) => `swarmforge/packs/${s}.conf`);

        const doc = [...existing, ...absent, ...ph].map((p) => `see ${p}`).join('\n');
        const reported = findAbsentNamedPackConfs([doc], existing);
        assert.deepEqual(reported, [...absent].sort());

        for (const p of ph) {
          const stem = p.replace(/^swarmforge\/packs\/|\.conf$/g, '');
          assert.equal(isIllustrativePackPlaceholder(stem), true);
        }
        for (const p of [...existing, ...absent]) {
          const stem = p.replace(/^swarmforge\/packs\/|\.conf$/g, '');
          assert.equal(isIllustrativePackPlaceholder(stem), false);
        }
        const extracted = extractNamedPackConfs(doc).map((r) => r.namedPath).sort();
        assert.deepEqual(extracted, [...new Set([...existing, ...absent, ...ph])].sort());
      }
    ),
    { numRuns: 80 }
  );
});
