'use strict';

// BL-1335's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A failover record is opened only from evidence classified as
//                period or quota exhaustion; evidence of any other provider
//                failure never opens one.
//   invariant 2  The promotion writes into the failover record store BL-669
//                already reads - no third store and no second assignment path.
//   invariant 3  Promotion is idempotent per open incident: repeated evidence
//                for a seat, provider and model whose failover record is still
//                open never opens a second.
//
// All three drive the REAL swarmforge/scripts/exhaustion_failover_promotion_lib.bb,
// and invariant 2 additionally reads the promoted record back through BL-669's
// OWN normalizer - a record this promotion writes that its consumer cannot
// parse would be a third store by another name.
//
// GENERATOR REACH (by construction). The three classification outcomes are the
// corners, so each gets its own property pass over its own text corpus; the
// run fails unless every outcome was produced.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMOTION_LIB = path.join(SCRIPTS, 'exhaustion_failover_promotion_lib.bb');
const RECORD_LIB = path.join(SCRIPTS, 'provider_outage_record_lib.bb');
const SEAT = 'documenter';
const PROVIDER = 'anthropic';
const MODEL = 'claude-opus-5';

// Text corpora, each unambiguous about which corner it belongs to. A phrase
// that could plausibly land in two of them belongs in NEITHER, because the
// whole risk here is a misclassification buying a real seat swap.
const EXHAUSTED = [
  'Token Plan weekly quota exhausted',
  'monthly limit exceeded for this workspace',
  'plan period quota exhausted',
  "you've used up your weekly credits",
  'out of tokens until the next week',
];
const SUSPECTED = ['rate limit hit, backing off', '429 too many requests', 'usage limit warning'];
const UNRELATED = [
  'connection reset by peer while streaming',
  '401 Unauthorized: invalid api key',
  'model returned malformed JSON, retrying',
  'ECONNREFUSED talking to the gateway',
  'segmentation fault in the client',
  '',
];

function bb(expression, libs) {
  const loads = libs.map((l) => `(load-file "${l}")`).join('\n');
  const program = `
(require '[cheshire.core :as json])
${loads}
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function decide(text, records = [], nowMs = 1788400000000) {
  return bb(
    `(exhaustion-failover-promotion-lib/promotion-decision
      {:evidence {:text ${JSON.stringify(text)}}
       :records (json/parse-string ${JSON.stringify(JSON.stringify(records))} true)
       :seat "${SEAT}" :provider "${PROVIDER}" :model "${MODEL}" :now-ms ${nowMs}})`,
    [PROMOTION_LIB],
  );
}

test('BL-1335/BL-654 invariant 1: only classified exhaustion opens a record', () => {
  const reach = { exhausted: 0, suspected: 0, unrelated: 0 };

  const corpora = { exhausted: EXHAUSTED, suspected: SUSPECTED, unrelated: UNRELATED };
  for (const [corner, corpus] of Object.entries(corpora)) {
    fc.assert(
      fc.property(fc.constantFrom(...corpus), (text) => {
        reach[corner] += 1;
        const d = decide(text);

        if (corner === 'exhausted') {
          assert.equal(d.action, 'promote', `unambiguous exhaustion did not promote: ${text} -> ${JSON.stringify(d)}`);
        } else if (corner === 'suspected') {
          // The human's ruling: announce for confirmation, never act.
          assert.equal(d.action, 'announce', `suspected exhaustion acted on its own: ${text} -> ${JSON.stringify(d)}`);
        } else {
          assert.equal(d.action, 'none', `a non-exhaustion failure opened a record: ${text} -> ${JSON.stringify(d)}`);
        }
        // Whatever the corner, only 'promote' ever carries a record.
        assert.equal(
          Boolean(d.record),
          d.action === 'promote',
          `a non-promoting decision carried a record: ${JSON.stringify(d)}`,
        );
        return true;
      }),
      { numRuns: 5 },
    );
  }

  for (const [corner, count] of Object.entries(reach)) {
    assert.ok(count > 0, `never exercised the ${corner} corner`);
  }
});

test("BL-1335/BL-654 invariant 2: the promoted record is one BL-669's own normalizer reads", () => {
  fc.assert(
    fc.property(fc.constantFrom(...EXHAUSTED), fc.integer({ min: 1, max: 2 ** 40 }), (text, nowMs) => {
      const d = decide(text, [], nowMs);
      assert.equal(d.action, 'promote');

      // Round-trip through the CONSUMER's normalizer, not through a local
      // idea of the shape: a record this promotion writes that BL-669 cannot
      // parse is a third store wearing the same filename.
      const normalized = bb(
        `(provider-outage-record-lib/normalize-record (json/parse-string ${JSON.stringify(JSON.stringify(d.record))} true))`,
        [RECORD_LIB],
      );
      assert.equal(normalized.provider, PROVIDER);
      assert.equal(normalized.model, MODEL);
      assert.deepEqual(normalized['affected-seats'], [SEAT]);
      assert.equal(normalized['started-at-ms'], nowMs);
      assert.equal(normalized['ended-at-utc'], null, 'a freshly promoted record must be OPEN');

      const open = bb(
        `(provider-outage-record-lib/outage-open? (provider-outage-record-lib/normalize-record (json/parse-string ${JSON.stringify(JSON.stringify(d.record))} true)))`,
        [RECORD_LIB],
      );
      assert.equal(open, true, 'the consumer does not see the promoted record as open');
      return true;
    }),
    { numRuns: 6 },
  );
});

test('BL-1335/BL-654 invariant 3: repeated evidence never opens a second record for one open incident', () => {
  const reach = { suppressed: 0, distinct: 0 };

  // An OPEN record for this exact seat/provider/model suppresses; every other
  // shape - closed, another model, another seat - must not, or a real second
  // incident would go unrecorded. Both sides get their own pass.
  const openMatching = [
    { provider: PROVIDER, model: MODEL, 'affected-seats': [SEAT], 'ended-at-utc': null },
  ];
  const nonSuppressing = [
    [{ provider: PROVIDER, model: MODEL, 'affected-seats': [SEAT], 'ended-at-utc': '2026-09-01T00:00Z' }],
    [{ provider: PROVIDER, model: 'claude-sonnet-5', 'affected-seats': [SEAT], 'ended-at-utc': null }],
    [{ provider: PROVIDER, model: MODEL, 'affected-seats': ['coder'], 'ended-at-utc': null }],
    [{ provider: 'other', model: MODEL, 'affected-seats': [SEAT], 'ended-at-utc': null }],
    [],
  ];

  fc.assert(
    fc.property(fc.constantFrom(...EXHAUSTED), fc.integer({ min: 1, max: 5 }), (text, repeats) => {
      reach.suppressed += 1;
      // However many times the same evidence arrives, a matching open record
      // suppresses every one of them.
      for (let i = 0; i < repeats; i += 1) {
        const d = decide(text, openMatching);
        assert.equal(d.action, 'none', `a second record was opened on repeat ${i + 1}: ${JSON.stringify(d)}`);
        assert.ok(d.reason.includes(SEAT), `the suppression does not say which record covers it: ${d.reason}`);
      }
      return true;
    }),
    { numRuns: 5 },
  );

  fc.assert(
    fc.property(fc.constantFrom(...EXHAUSTED), fc.constantFrom(...nonSuppressing), (text, records) => {
      reach.distinct += 1;
      const d = decide(text, records);
      assert.equal(
        d.action,
        'promote',
        `a record that does not cover this incident suppressed it: ${JSON.stringify(records)} -> ${JSON.stringify(d)}`,
      );
      return true;
    }),
    { numRuns: 8 },
  );

  assert.ok(reach.suppressed > 0, 'never exercised the suppression case');
  assert.ok(reach.distinct > 0, 'never exercised a non-suppressing record');
});
