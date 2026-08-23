'use strict';

// BL-1078 declared invariant 2 (property authorship rests with the coder,
// first pass - BL-654): "An uncertified Cursor identity remains refused on
// production packs unless an explicit spike-only escape is set; this slice
// does not silently certify."
//
// The acceptance scenario pins two rows: escape unset -> refused, escape set
// -> admitted. This sweeps the whole CROSS PRODUCT of registry state and
// escape value, because "does not silently certify" is a claim about every
// way an identity can fail to be certified, and the interesting ones are the
// ways that look like certification without being it: a registry that cannot
// be read, an entry with no status, a status nobody declared. Each must fail
// CLOSED, and a property that only ever drew a well-formed registry would
// never touch any of them.
//
// The escape values are drawn the same way: `0`, an empty string and `true`
// all LOOK like an operator setting something, and an implementation that
// tested for non-emptiness would be opened by any of them. That is the
// collision this generator constructs rather than hopes for.
//
// Every draw reaches the REAL Babashka guard in one batched call.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - identity-status made to read an entry's mere EXISTENCE as
//     certified (absence of a status field buys certification): RED, "admission
//     disagreed with the rule at status-unknown-word / escape=unset".
//     Recorded because the FIRST break tried did not go red and that is worth
//     knowing: relaxing the known-status filter alone changes nothing
//     observable, because admission tests for "certified" exactly. That filter
//     is belt-and-braces on the REPORTED status, not the admission gate.
//   break 2 - escape-set? relaxed to a non-empty test: RED on the first `0`
//     draw, "an uncertified identity was admitted with the escape unset".
//   break 3 - the refusal message stripped of the escape name: RED, "the
//     refusal must name the escape that would admit it".
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'cursor_seat_guard_lib.bb');

// Every way a registry can fail to certify, including the ones that look like
// an answer. `certified` is the ONLY one that may admit without an escape.
const REGISTRY_SHAPES = {
  certified: { models: { 'cursor/M': { status: 'certified' } } },
  candidate: { models: { 'cursor/M': { status: 'candidate' } } },
  retired: { models: { 'cursor/M': { status: 'retired' } } },
  'status-unknown-word': { models: { 'cursor/M': { status: 'blessed' } } },
  'entry-without-status': { models: { 'cursor/M': {} } },
  'entry-absent': { models: { 'cursor/other': { status: 'certified' } } },
  'no-models-map': { schema: 1 },
  'registry-null': null,
  'registry-not-a-map': ['cursor/M'],
};

// Values that all LOOK like something an operator set. Only the declared one
// may open the escape.
const ESCAPE_VALUES = {
  unset: null,
  empty: '',
  zero: '0',
  'true-word': 'true',
  yes: 'yes',
  declared: '1',
  'declared-padded': ' 1 ',
};

const OPENS_ESCAPE = new Set(['declared', 'declared-padded']);

function guardVerdicts(draws) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${GUARD_LIB}")
(println (json/generate-string
          (vec (for [d (json/parse-string (slurp *in*) true)]
                 (let [v (cursor-seat-guard-lib/admission
                          {:registry (:registry d)
                           :provider "cursor"
                           :model (:model d)
                           :escape (:escape d)})]
                   {:admit (:admit? v)
                    :reason (name (:reason v))
                    :status (:status v)
                    :identity (:identity v)
                    :message (:message v)})))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', input: JSON.stringify(draws) });
  assert.equal(res.status, 0, `the real cursor-seat guard failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

// The registry fixtures are keyed on `cursor/M`, so the model under test has
// to be M for the entry to be the one found. `entry-absent` deliberately keys
// on something else.
const MODEL = 'M';

test('BL-1078/BL-654 invariant 2: nothing but a certified entry or the declared escape admits a cursor identity', () => {
  const draws = [];
  const labels = [];
  for (const [registryLabel, registry] of Object.entries(REGISTRY_SHAPES)) {
    for (const [escapeLabel, escape] of Object.entries(ESCAPE_VALUES)) {
      draws.push({ registry, escape, model: MODEL });
      labels.push({ registryLabel, escapeLabel });
    }
  }
  assert.equal(
    draws.length,
    Object.keys(REGISTRY_SHAPES).length * Object.keys(ESCAPE_VALUES).length,
    'the cross product must be complete, or this is not exhaustive'
  );

  const verdicts = guardVerdicts(draws);
  assert.equal(verdicts.length, draws.length, 'one verdict per draw');

  const reached = { certified: 0, escaped: 0, refused: 0 };

  verdicts.forEach((v, i) => {
    const { registryLabel, escapeLabel } = labels[i];
    const where = `${registryLabel} / escape=${escapeLabel}`;
    const isCertified = registryLabel === 'certified';
    const escapeOpen = OPENS_ESCAPE.has(escapeLabel);

    // The invariant, stated as a biconditional so neither direction can drift.
    assert.equal(
      v.admit,
      isCertified || escapeOpen,
      `admission disagreed with the rule at ${where}: ${JSON.stringify(v)}`
    );

    if (isCertified) {
      assert.equal(v.status, 'certified', `a certified entry did not read certified at ${where}`);
      if (!escapeOpen) {
        assert.equal(v.reason, 'certified', `at ${where}`);
        reached.certified += 1;
      }
    } else {
      // "does not silently certify": every non-certified shape reads as
      // something other than certified, however it is malformed.
      assert.notEqual(
        v.status,
        'certified',
        `a status neither side declared was treated as certification at ${where}`
      );
      if (escapeOpen) {
        assert.equal(v.reason, 'uncertified-escape', `at ${where}`);
        // The run must be TOLD, or an uncertified seat runs silently.
        assert.match(v.message, /UNCERTIFIED/, `at ${where}: ${v.message}`);
        reached.escaped += 1;
      } else {
        assert.equal(v.admit, false, `an uncertified identity was admitted with the escape unset at ${where}`);
        // The refusal has to name the escape, or an operator reaches for
        // something cruder than the escape they were never told about.
        assert.match(
          v.message,
          /SWARMFORGE_CURSOR_SEAT_SPIKE=1/,
          `the refusal must name the escape that would admit it at ${where}: ${v.message}`
        );
        reached.refused += 1;
      }
    }
  });

  // Reach: all three outcomes exercised, and by construction not by luck.
  assert.ok(reached.certified >= 1, 'no draw was admitted by certification');
  assert.ok(reached.escaped >= 8, `only ${reached.escaped} draws were admitted by the escape`);
  assert.ok(reached.refused >= 30, `only ${reached.refused} draws were refused`);
});

test('BL-1078/BL-654 invariant 2: the identity a verdict is about is the one the window line selects', () => {
  // A guard that keyed every seat on the same identity would satisfy the sweep
  // above while certifying or refusing the wrong model. The key has to follow
  // the --model flag a pack author actually wrote.
  const cases = [
    { cli: '', model: 'auto' },
    { cli: '--model composer-1', model: 'composer-1' },
    { cli: '--model=gpt-5', model: 'gpt-5' },
    { cli: '--force --model sonnet-4-thinking --trust', model: 'sonnet-4-thinking' },
  ];
  const program = `
(require '[cheshire.core :as json])
(load-file "${GUARD_LIB}")
(println (json/generate-string
          (mapv #(cursor-seat-guard-lib/model-from-cli %) (json/parse-string (slurp *in*)))))`;
  const res = spawnSync('bb', ['-e', program], {
    encoding: 'utf8',
    input: JSON.stringify(cases.map((c) => c.cli)),
  });
  assert.equal(res.status, 0, res.stderr);
  const models = JSON.parse(res.stdout);
  cases.forEach((c, i) => {
    assert.equal(models[i], c.model, `"${c.cli}" selected model "${models[i]}", expected "${c.model}"`);
  });

  // And a registry certifying ONE model does not certify its neighbours.
  const registry = { models: { 'cursor/composer-1': { status: 'certified' } } };
  const verdicts = guardVerdicts(models.map((model) => ({ registry, escape: null, model })));
  models.forEach((model, i) => {
    assert.equal(
      verdicts[i].admit,
      model === 'composer-1',
      `certifying cursor/composer-1 admitted cursor/${model}`
    );
    assert.equal(verdicts[i].identity, `cursor/${model}`, 'the verdict is about a different identity than the draw');
  });
});
