'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-1353 declared invariants:
//
// 1. A wake source is never removed before a live escalation producer covers
//    the condition it stood in for (BL-653's own invariant, carried forward).
// 2. The coordinator-inbox freshness probe keeps its second consumer: the
//    BL-307/BL-310 closing-pass hibernation decision reads the same signal and
//    must be unaffected by any change to the wake path.
//
// Both drive the REAL operator_lib.bb functions. `bb` costs ~250ms a spawn, so
// each property builds ONE expression covering every drawn case and spawns
// once per property - a property that spawned per run has taken the shared
// suite down before.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const OPERATOR_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_lib.bb');

function bbJson(expression) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[babashka.fs :as fs] '[cheshire.core :as json]) (load-file "${OPERATOR_LIB}") (println (json/generate-string ${expression}))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim().split('\n').pop());
}

const bool = (v) => (v ? 'true' : 'false');

test('property: no tick input manufactures a retired wake, and the real sources are untouched', () => {
  const cases = [];
  const seen = new Set();
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (reachable, commandFile, inboxFresh) => {
      seen.add([reachable, commandFile, inboxFresh].map(bool).join('|'));
      cases.push({ reachable, commandFile, inboxFresh });
    }),
    { numRuns: 120 }
  );
  // Reach, asserted: all eight tick states, including the two the retirement
  // is about (fresh inbox with nothing else happening).
  assert.equal(seen.size, 8, `generator reached only ${seen.size} of 8 tick states`);

  const expressions = cases
    .map(
      ({ reachable, commandFile, inboxFresh }) =>
        `(mapv :type (operator-lib/tick-observed-events {:reachable? ${bool(reachable)} :command-file-exists? ${bool(
          commandFile
        )} :command-detail "go" :coordinator-inbox-fresh? ${bool(inboxFresh)}}))`
    )
    .join(' ');
  const results = bbJson(`[${expressions}]`);

  results.forEach((types, index) => {
    const { reachable, commandFile, inboxFresh } = cases[index];
    // The retired source never reappears, whatever the inbox looks like.
    assert.equal(types.includes('TASK_ARRIVED'), false, 'a retired wake source was manufactured');
    // Invariant 1: what the tick DOES raise is exactly the untouched pair -
    // the retirement removed one source and changed no other.
    const expected = [];
    if (!reachable) expected.push('SWARM_CONTROL_LOST');
    if (commandFile) expected.push('HUMAN_COMMAND');
    assert.deepEqual(types, expected, `fresh inbox=${inboxFresh} changed a real wake source`);
  });
});

test('property: the escalation producer that covers the retired condition is live and off the tick path', () => {
  const findings = [];
  const seen = new Set();
  fc.assert(
    fc.property(
      fc.constantFrom('proc-coder', 'proc-QA', 'pane-cleaner', 'menu-coordinator'),
      fc.constantFrom('resident process gone', 'no claude process', 'control channel down'),
      (key, message) => {
        seen.add(key);
        findings.push({ key, message });
      }
    ),
    { numRuns: 80 }
  );
  assert.equal(seen.size, 4, 'the generator did not reach every finding key');

  const expressions = findings
    .map(
      ({ key, message }) =>
        `(let [e (operator-lib/babysitter-escalation-event {:key "${key}" :message "${message}"})] {:event e :valid? (boolean (operator-lib/valid-event? e)) :tick? (contains? operator-lib/manufactured-tick-event-types (:type e))})`
    )
    .join(' ');
  const results = bbJson(`[${expressions}]`);

  results.forEach((result, index) => {
    const { key, message } = findings[index];
    // Invariant 1: a live producer still turns a CRIT finding into a wake.
    assert.equal(result.event.type, 'BABYSITTER_ESCALATION');
    assert.equal(result.event.subject, key);
    assert.equal(result.event.detail, message);
    assert.equal(result['valid?'], true, 'the escalation is not a valid queue event');
    // ...and it arrives via the queue, so retiring a TICK source cannot have
    // removed it.
    assert.equal(result['tick?'], false);
  });
});

test('property: the freshness probe still decides the closing pass, unaffected by the wake retirement', () => {
  const cases = [];
  const seen = new Set();
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (hibernated, drained, freshMail) => {
      seen.add([hibernated, drained, freshMail].map(bool).join('|'));
      cases.push({ hibernated, drained, freshMail });
    }),
    { numRuns: 120 }
  );
  assert.equal(seen.size, 8, `generator reached only ${seen.size} of 8 closing-pass states`);

  const expressions = cases
    .map(
      ({ hibernated, drained, freshMail }) =>
        `(boolean (operator-lib/should-relaunch? {:already-hibernated? ${bool(hibernated)} :backlog-drained? ${bool(
          drained
        )} :fresh-coordinator-mail? ${bool(freshMail)}}))`
    )
    .join(' ');
  const results = bbJson(`[${expressions}]`);

  results.forEach((relaunches, index) => {
    const { hibernated, drained, freshMail } = cases[index];
    // Invariant 2, stated as the decision itself: unchanged from before the
    // retirement - a hibernated swarm relaunches on undrained backlog OR on
    // fresh coordinator mail, and nothing else relaunches at all.
    assert.equal(relaunches, hibernated && (!drained || freshMail));
  });
  // The probe is load-bearing: on the drained-and-hibernated state, fresh mail
  // is the ONLY thing that separates relaunch from staying down.
  const withMail = cases.findIndex((c) => c.hibernated && c.drained && c.freshMail);
  const withoutMail = cases.findIndex((c) => c.hibernated && c.drained && !c.freshMail);
  assert.equal(results[withMail], true);
  assert.equal(results[withoutMail], false);
});
