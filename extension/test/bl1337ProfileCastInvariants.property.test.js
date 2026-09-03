'use strict';

// BL-1337's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`.
//
//   invariant 1  A cast is offered as runnable only when EVERY seat's pick
//                passed both registry eligibility for that role and a host
//                reachability check; one failing seat makes the whole cast
//                not-runnable.
//   invariant 2  A profile whose floors cannot be met fails loud naming the
//                seats that could not be staffed - never a cast that omits a
//                seat or silently substitutes below the floor.
//   invariant 3  No file the generator writes contains credential material.
//
// All three drive the SHIPPED lib (bob_starting_cast_lib.bb) over generated
// registries; invariant 3 also drives the shipped CLI's writing path, because
// "no file it writes" is a claim about the thing that writes files.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  makeFixture,
  removeFixture,
  runCli,
  filesWritten,
} = require('../../specs/pipeline/steps/lib/bl1337ProfileCastFixture');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CAST_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'bob_starting_cast_lib.bb');
const STEWARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_lib.bb');
const FACTORY_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_factory_lib.bb');

// Providers this repo's launcher knows, so require-launch-agent! never throws
// for a reason unrelated to the property under test.
const PROVIDERS = ['anthropic', 'cerebras', 'mistral', 'openai'];
const ROLES = ['coder', 'cleaner', 'architect', 'QA'];

function callCastLib(forms) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${STEWARD_LIB}")
(load-file "${FACTORY_LIB}")
(load-file "${CAST_LIB}")
(defn emit [v] (println (str "BL1337|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1337|'))
    .map((line) => JSON.parse(line.slice('BL1337|'.length)));
}

// A generated seat: a ranked candidate list, each entry carrying whether it is
// certified (the registry bar) and reachable (the host bar), so the property
// can compute the expected verdict independently of the lib.
//
// Model ids are made UNIQUE PER SEAT below (uniqueModels): certification and
// reachability are properties of a MODEL in the registry, not of a
// (role, model) pair, so a draw that gave two seats the same model id with
// different flags described a registry that cannot exist - and the property
// then measured the lib against an impossible expectation. Found by the
// property itself on a shrunk counterexample; the generator was the defect,
// not the lib.
const seatArb = fc.record({
  role: fc.constantFrom(...ROLES),
  candidates: fc.array(
    fc.record({
      provider: fc.constantFrom(...PROVIDERS),
      model: fc.integer({ min: 1, max: 40 }).map((n) => `m${n}`),
      score: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
      certified: fc.boolean(),
      reachable: fc.boolean(),
    }),
    { minLength: 1, maxLength: 4 },
  ),
});

// Builds the bb form that seeds a registry for the drawn seats and runs the
// SHIPPED generator over them.
function generateForm(seats, floor) {
  const registrations = seats
    .flatMap((seat) => seat.candidates.map((c) => ({ ...c, role: seat.role })))
    .map((c) => {
      const register = `(model-steward-lib/register-model "${c.provider}" "${c.model}" {})`;
      const certify = c.certified ? `(model-steward-lib/certify "${c.provider}" "${c.model}" {:scorecard-id "sc"})` : '';
      return { register, certify, c };
    });
  // A drawn model can repeat across seats; a Clojure set literal refuses a
  // duplicate key, so the reachable set is de-duplicated here.
  const reachable = [
    ...new Set(registrations.filter(({ c }) => c.reachable).map(({ c }) => `"${c.provider}/${c.model}"`)),
  ];
  const roles = [...new Set(seats.map((s) => s.role))];
  const seed = registrations
    .map(({ c }) => `(-> reg (model-steward-lib/register-model "${c.provider}" "${c.model}" {})
        ${c.certified ? `(model-steward-lib/certify "${c.provider}" "${c.model}" {:scorecard-id "sc"})` : ''}
        (model-steward-lib/add-role-ranking "${c.role}" "${c.provider}" "${c.model}" ${c.score} {:scorecard_id "sc"}))`)
    .join('\n');
  return `
(def reachable-set #{${reachable.join(' ')}})
(def reg
  (reduce (fn [reg f] (f reg))
          model-steward-lib/empty-registry
          [${registrations
            .map(({ c }) => `(fn [reg] (-> reg (model-steward-lib/register-model "${c.provider}" "${c.model}" {})
              ${c.certified ? `(model-steward-lib/certify "${c.provider}" "${c.model}" {:scorecard-id "sc"})` : ''}
              (model-steward-lib/add-role-ranking "${c.role}" "${c.provider}" "${c.model}" ${c.score} {:scorecard_id "sc"})))`)
            .join('\n           ')}]))
(def result
  (bob-starting-cast-lib/generate-cast-from-profile
    reg
    {:name "p" :roles [${roles.map((r) => `"${r}"`).join(' ')}] :quality-floor ${floor} :providers [] :handshake "registry-and-host"}
    {:reachable? (fn [p m] (contains? reachable-set (str p "/" m)))}))
(emit {:runnable (boolean (:runnable? result))
       :unstaffable (vec (:unstaffable result))
       :staffed (into {} (map (fn [[role e]] [role (:model e)]) (get-in result [:cast :roles])))
       :failure (when-not (:runnable? result) (bob-starting-cast-lib/generation-failure-text result))
       :note (bob-starting-cast-lib/evidence-note-text result)})`;
}

// The same decision, computed here from the drawn data - so the property
// compares the lib against an independent expectation, not against itself.
// Gives every candidate a model id unique across the whole draw, so no model
// carries two different certification/reachability answers.
function uniqueModels(seats) {
  return seats.map((seat, seatIndex) => ({
    ...seat,
    candidates: seat.candidates.map((c, i) => ({ ...c, model: `${c.model}-s${seatIndex}c${i}` })),
  }));
}

function expectedFor(seats, floor) {
  const byRole = new Map();
  for (const seat of seats) {
    const ranked = [...seat.candidates].sort((a, b) => b.score - a.score);
    const winner = ranked.find((c) => c.score >= floor && c.certified && c.reachable);
    byRole.set(seat.role, winner ? winner.model : null);
  }
  return byRole;
}

test('BL-1337/BL-654 invariant 1: runnable only when every seat passed BOTH bars', () => {
  // GENERATOR REACH (asserted): a run that never saw a registry-ineligible
  // candidate, never saw an unreachable one, and never saw a fully staffable
  // cast would prove nothing about a gate that has to fail on either bar.
  const reach = { runnable: 0, blockedByRegistry: 0, blockedByHost: 0 };

  fc.assert(
    fc.property(fc.array(seatArb, { minLength: 1, maxLength: 3 }), fc.constantFrom(0, 0.5, 0.9), (seats, floor) => {
      // One seat per role: a repeated role would make "the seat" ambiguous.
      const unique = uniqueModels([...new Map(seats.map((s) => [s.role, s])).values()]);
      const expected = expectedFor(unique, floor);
      const [got] = callCastLib(generateForm(unique, floor));

      const expectRunnable = [...expected.values()].every((m) => m !== null);
      assert.equal(got.runnable, expectRunnable, `runnable disagreed: ${JSON.stringify({ got, expected: [...expected] })}`);

      for (const [role, model] of expected) {
        if (model === null) {
          assert.ok(got.unstaffable.includes(role), `${role} could not be staffed but is not named`);
          assert.ok(!(role in got.staffed), `${role} was staffed anyway`);
        } else {
          assert.equal(got.staffed[role], model, `${role} was staffed by the wrong model`);
        }
      }
      return true;
    }),
    { numRuns: 12 },
  );

  // GENERATOR REACH, by CONSTRUCTION rather than by luck: the three shapes the
  // gate turns on are each driven as their own case below, so a run cannot
  // pass without having seen a candidate rejected on the registry bar, one
  // rejected on the host bar, and a fully staffable cast. Leaving those floors
  // to the random draws above made them a ~1-in-N coin flip - the same
  // luck-based-floor defect that bounced BL-1345, and it flaked here once
  // before this was written.
  const CONSTRUCTED = [
    {
      label: 'blockedByRegistry',
      seats: [{ role: 'coder', candidates: [
        { provider: 'anthropic', model: 'top', score: 0.9, certified: false, reachable: true },
        { provider: 'cerebras', model: 'next', score: 0.8, certified: true, reachable: true },
      ] }],
      expect: { runnable: true, staffed: { coder: 'next' } },
    },
    {
      label: 'blockedByHost',
      seats: [{ role: 'coder', candidates: [
        { provider: 'mistral', model: 'top', score: 0.9, certified: true, reachable: false },
        { provider: 'anthropic', model: 'next', score: 0.8, certified: true, reachable: true },
      ] }],
      expect: { runnable: true, staffed: { coder: 'next' } },
    },
    {
      label: 'runnable',
      seats: [{ role: 'coder', candidates: [
        { provider: 'anthropic', model: 'top', score: 0.9, certified: true, reachable: true },
      ] }],
      expect: { runnable: true, staffed: { coder: 'top' } },
    },
    {
      label: 'bothBarsFail',
      seats: [{ role: 'coder', candidates: [
        { provider: 'mistral', model: 'top', score: 0.9, certified: false, reachable: false },
      ] }],
      expect: { runnable: false, staffed: {} },
    },
  ];
  for (const { label, seats, expect } of CONSTRUCTED) {
    const [got] = callCastLib(generateForm(seats, 0.5));
    assert.equal(got.runnable, expect.runnable, `${label}: runnable disagreed (${JSON.stringify(got)})`);
    assert.deepEqual(got.staffed, expect.staffed, `${label}: staffed disagreed`);
    reach[label] = (reach[label] ?? 0) + 1;
  }

  assert.ok(reach.runnable > 0, 'never reached a fully staffable cast');
  assert.ok(reach.blockedByRegistry > 0, 'never exercised a candidate failing the REGISTRY bar');
  assert.ok(reach.blockedByHost > 0, 'never exercised a candidate failing the HOST bar');
  assert.ok(reach.bothBarsFail > 0, 'never exercised a seat that fails both bars');
}, 120000);

test('BL-1337/BL-654 invariant 2: an unmeetable floor fails loud, naming the seats, never substituting below it', () => {
  // Built to be unstaffable by construction: every candidate scores below the
  // floor. The failure must name every such seat, and no seat may appear in
  // the cast with a below-floor model.
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          role: fc.constantFrom(...ROLES),
          candidates: fc.array(
            fc.record({
              provider: fc.constantFrom(...PROVIDERS),
              model: fc.integer({ min: 1, max: 40 }).map((n) => `m${n}`),
              score: fc.integer({ min: 0, max: 40 }).map((n) => n / 100),
              certified: fc.constant(true),
              reachable: fc.constant(true),
            }),
            { minLength: 1, maxLength: 3 },
          ),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      (seats) => {
        const unique = uniqueModels([...new Map(seats.map((s) => [s.role, s])).values()]);
        const floor = 0.5;
        const [got] = callCastLib(generateForm(unique, floor));
        assert.equal(got.runnable, false, 'a cast nothing could staff above the floor was offered as runnable');
        assert.deepEqual(
          [...got.unstaffable].sort(),
          unique.map((s) => s.role).sort(),
          'the failure does not name every unstaffable seat',
        );
        assert.deepEqual(got.staffed, {}, 'a seat was staffed below the profile floor');
        for (const seat of unique) {
          assert.ok(got.failure.includes(seat.role), `the failure text omits ${seat.role}`);
        }
        return true;
      },
    ),
    { numRuns: 8 },
  );
}, 120000);

test('BL-1337/BL-654 invariant 3: nothing the generator writes carries credential material', async () => {
  // Drives the shipped CLI's WRITING path (apply), because "no file it writes"
  // is a claim about the thing that writes. The fixture host carries a
  // deliberately fake credential value, so a leak would be visible as that
  // exact string - and the sweep also looks for credential SHAPES rather than
  // one variable name.
  const MARKERS = ['fixture-not-a-real-key', 'API_KEY=', 'sk-', 'Bearer ', 'token='];
  const fx = makeFixture();
  try {
    const startedMs = Date.now();
    const exported = runCli(fx, ['export', '--profile', 'fixture']);
    assert.equal(exported.status, 0, `export failed: ${exported.note.slice(-300)}`);
    const applied = runCli(fx, ['apply', '--profile', 'fixture']);
    assert.equal(applied.status, 0, `apply failed: ${applied.note.slice(-300)}`);

    const written = filesWritten(fx, startedMs);
    assert.ok(written.length > 0, 'the run wrote nothing - this sweep would be vacuous');
    for (const file of written) {
      const text = fs.readFileSync(file, 'utf8');
      for (const marker of MARKERS) {
        assert.ok(!text.includes(marker), `${file} carries credential material (${marker})`);
      }
    }
    for (const [label, text] of [
      ['the exported cast', exported.stdout],
      ['the export note', exported.note],
      ['the applied overlay output', applied.stdout],
      ['the apply note', applied.note],
    ]) {
      for (const marker of MARKERS) {
        assert.ok(!text.includes(marker), `${label} carries credential material (${marker})`);
      }
    }
  } finally {
    removeFixture(fx);
  }
}, 120000);
