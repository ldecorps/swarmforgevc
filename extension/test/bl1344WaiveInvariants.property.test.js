'use strict';

// BL-1344's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A waive is scoped to the single finding key it names and
//                never suppresses a nudge for any other key, including a
//                later finding of the same class over a different commit.
//   invariant 2  The sweep never creates, widens or renews a waive - only an
//                explicitly recorded decision does, the same posture the
//                hotfix ledger takes toward certification.
//   invariant 3  A waive store that is missing, unreadable or malformed
//                results in the nudge being sent; suppression requires a
//                positively read waive, never the absence of a readable
//                answer.
//
// Invariants 1 and 3 drive the pure decision core (babysitter_waive_lib.bb)
// over generated inputs, because that is where the whole question lives, and
// invariant 2 drives the REAL sweep - the only place a waive could be created
// by accident is the live nudge path, so a pure test of it would prove
// nothing.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SCRIPTS,
  makeFixture,
  removeFixture,
  runSweep,
  recordWaive,
  readStore,
  elapseCooldown,
} = require('../../specs/pipeline/steps/lib/bl1344WaiveFixture');

const WAIVE_LIB = path.join(SCRIPTS, 'babysitter_waive_lib.bb');

// The pure lib, called in its own namespace. `emit`ted values come back as
// parsed JSON, in order.
function callWaiveLib(forms) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${WAIVE_LIB}")
(defn emit [v] (println (str "BL1344|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1344|'))
    .map((line) => JSON.parse(line.slice('BL1344|'.length)));
}

const HEX = '0123456789abcdef';
// findings as a Clojure literal - JSON.stringify's `"key":` is not EDN, and
// a JSON blob pasted into a bb form fails to parse rather than failing a test.
function ednFindings(findings) {
  return `[${findings
    .map((f) => `{:key ${JSON.stringify(f.key)} :severity ${JSON.stringify(f.severity)} :message ${JSON.stringify(f.message)}}`)
    .join(' ')}]`;
}

const sha = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 10, maxLength: 40 })
  .map((digits) => digits.map((d) => HEX[d]).join(''));
const findingKey = sha.map((s) => `pipeline-code-on-main-${s}`);

test('BL-1344/BL-654 invariant 1: a waive silences the key it names and nothing else', () => {
  // GENERATOR REACH: the OTHER key is derived from the waived one rather than
  // drawn independently - the same class, the same prefix, a different commit
  // - because that is the collision the invariant is about. Two independent
  // draws would almost never produce a same-class pair, and a class-wide
  // waive would sail through such a property untouched.
  const reach = { sameClass: 0, differentClass: 0 };

  fc.assert(
    fc.property(findingKey, sha, fc.constantFrom('pipeline-code-on-main', 'stuck-parcel', 'daemon-down'), (waived, otherSha, otherClass) => {
      const sameClassKey = `pipeline-code-on-main-${otherSha}`;
      const differentClassKey = `${otherClass}-${otherSha}`;
      if (sameClassKey === waived) return true; // the same key is not "another key"
      reach.sameClass += 1;
      if (otherClass !== 'pipeline-code-on-main') reach.differentClass += 1;

      const findings = [waived, sameClassKey, differentClassKey].map((key) => ({ key, severity: 'CRIT', message: `finding ${key}` }));
      const [result] = callWaiveLib(
        `(let [store (babysitter-waive-lib/render-waives
                       (babysitter-waive-lib/record-waive {} {:key "${waived}" :waived-by "coordinator" :reason "investigated" :waived-at "2026-09-03"}))
               read (babysitter-waive-lib/parse-waives store)
               {:keys [to-nudge suppressed store-error]}
               (babysitter-waive-lib/partition-findings ${ednFindings(findings)} read)]
           (emit {:to-nudge (mapv :key to-nudge) :suppressed (mapv :key suppressed) :store-error store-error}))`,
      );
      assert.deepEqual(result.suppressed, [waived], `a waive suppressed more than the key it names: ${JSON.stringify(result)}`);
      assert.ok(result['to-nudge'].includes(sameClassKey), 'a later finding of the same class was silenced by another key\'s waive');
      assert.ok(result['to-nudge'].includes(differentClassKey), 'a finding of another class was silenced');
      return true;
    }),
    { numRuns: 6 },
  );

  assert.ok(reach.sameClass > 0, 'never exercised a second finding of the SAME class - the collision that matters');
  assert.ok(reach.differentClass > 0, 'never exercised a finding of another class');
}, 120000);

test('BL-1344/BL-654 invariant 2: the sweep never creates, widens or renews a waive', () => {
  // Only the live path can violate this, so this drives the real sweep: with
  // no store, with a store the sweep could widen, and across repeated sweeps
  // that could renew one. The store is compared byte for byte before and
  // after, which is the same measurement the ticket's qa_e2e_procedure (4)
  // asks for.
  const reach = { noStore: 0, existingWaive: 0, repeatedSweeps: 0 };

  const fx = makeFixture();
  try {
    reach.noStore += 1;
    const beforeNothing = readStore(fx);
    runSweep(fx);
    assert.equal(readStore(fx), beforeNothing, 'a sweep with no waive store created one');
    assert.equal(readStore(fx), null, 'a sweep wrote a waive store out of nothing');

    reach.existingWaive += 1;
    recordWaive(fx, fx.keys.first, 'coordinator', 'investigated: legitimate');
    const afterRecord = readStore(fx);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (sweeps) => {
        reach.repeatedSweeps += 1;
        for (let i = 0; i < sweeps; i += 1) {
          elapseCooldown(fx);
          const run = runSweep(fx);
          // The waived key must not reappear as a nudge, and the store must
          // not have grown a second entry for the still-nudging finding.
          assert.ok(!run.nudgeText.includes(fx.shas.first), 'the waived finding nudged again');
        }
        assert.equal(readStore(fx), afterRecord, 'a sweep widened or renewed the recorded waive');
        return true;
      }),
      { numRuns: 2 },
    );
  } finally {
    removeFixture(fx);
  }

  assert.ok(reach.noStore > 0 && reach.existingWaive > 0 && reach.repeatedSweeps > 0, 'never exercised all three shapes');
}, 120000);

test('BL-1344/BL-654 invariant 3: only a positively read waive can suppress anything', () => {
  // GENERATOR REACH (by construction): every way a store can fail to be read
  // is its own case - absent, unreadable, structurally unparseable, and an
  // entry too incomplete to be accountable. All four must suppress nothing.
  // A weighted draw would let the run pass with the dangerous corner unseen.
  const reach = { unreadable: 0, unparseable: 0, incomplete: 0, empty: 0 };

  const UNREADABLE = '{:ok? false :reason :unreadable}';
  const CASES = {
    unreadable: fc.constant(UNREADABLE),
    unparseable: fc.string({ minLength: 1, maxLength: 20 })
      .map((s) => `(babysitter-waive-lib/parse-waives ${JSON.stringify(`{{{ ${s.replace(/[\\"]/g, '')}`)})`),
    // An entry that names a key but nobody and no reason: not accountable, so
    // not a waive - and specifically NOT read as "everything else is fine".
    incomplete: findingKey.map((key) => `(babysitter-waive-lib/parse-waives ${JSON.stringify(`- key: ${key}\n  waived_by: coordinator\n`)})`),
    empty: fc.constant('(babysitter-waive-lib/parse-waives "")'),
  };

  for (const [shape, arbitrary] of Object.entries(CASES)) {
    fc.assert(
      fc.property(arbitrary, findingKey, (readForm, key) => {
        reach[shape] += 1;
        const findings = [{ key, severity: 'CRIT', message: `finding ${key}` }];
        const [result] = callWaiveLib(
          `(let [{:keys [to-nudge suppressed store-error]}
                 (babysitter-waive-lib/partition-findings ${ednFindings(findings)} ${readForm})]
             (emit {:to-nudge (mapv :key to-nudge) :suppressed (mapv :key suppressed)
                    :store-error (some-> store-error name)}))`,
        );
        assert.deepEqual(result['to-nudge'], [key], `a finding was not nudged with a ${shape} store: ${JSON.stringify(result)}`);
        assert.deepEqual(result.suppressed, [], `a ${shape} store suppressed a finding`);
        if (shape === 'empty') {
          assert.equal(result['store-error'], null, 'an empty but readable store was reported as an error');
        } else {
          assert.ok(result['store-error'], `a ${shape} store went quiet instead of saying it could not be read`);
        }
        return true;
      }),
      { numRuns: 3 },
    );
  }

  for (const [shape, count] of Object.entries(reach)) {
    assert.ok(count > 0, `never exercised the ${shape} store`);
  }
}, 120000);
