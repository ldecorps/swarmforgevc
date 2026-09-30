'use strict';

// BL-1804 declared invariants (coder first authorship — BL-654):
//
// 1. A handoff whose to: is the coordinator never counts as a dispatch of
//    the ticket it names, whatever its message says; every other trail
//    counts exactly as before.
// 2. At most one unassigned-active nudge per ticket is pending (new or
//    in_process) in the coordinator's inbox at any time.
//
// Non-vacuity: (1) the SAME message with to: coder/specifier still counts
// (pinned against a pre-fix reimplementation that dropped `to:` entirely);
// (2) a pending-dirs set holding no nudge for the id still returns it.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHASE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

function bbChase(expr) {
  return execFileSync('bb', ['-e', `(load-file "${CHASE}")\n${expr}`], { encoding: 'utf8' }).trim();
}

// Every verb-first form the router/sweep actually emits, so the property
// sweeps the shapes a hostile/self-addressed note could take, not just one.
const MESSAGE_FORMS = [
  (id) => `Work ${id}: merge main first, then read backlog/active`,
  (id) => `Work ${id} active unassigned - assign_to and route it.`,
  (id) => `Spec ${id}: ready in backlog/paused`,
];

test(
  'BL-1804/BL-654 invariant 1: to: coordinator is never a dispatch trail, whatever the message says',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99999 }),
        fc.constantFrom(...MESSAGE_FORMS),
        (n, buildMessage) => {
          draws += 1;
          const id = `BL-${n}`;
          const message = buildMessage(id);
          const toCoordinator = bbChase(
            `(println (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message ${JSON.stringify(
              message
            )} :to "coordinator"}))`
          );
          assert.equal(toCoordinator, 'nil', `to: coordinator counted as a trail for message ${JSON.stringify(message)}`);

          // Non-vacuity: the SAME message addressed to a working role still
          // counts, so this is a `to:` gate, not a message-form change.
          const toCoder = bbChase(
            `(println (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message ${JSON.stringify(
              message
            )} :to "coder"}))`
          );
          assert.equal(toCoder, id, `to: coder should still count message ${JSON.stringify(message)} as dispatching ${id}`);

          // A missing to: keeps today's reading (never a regression for
          // every caller that does not know about :to yet).
          const noTo = bbChase(
            `(println (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message ${JSON.stringify(message)}}))`
          );
          assert.equal(noTo, id);
        }
      ),
      { numRuns: 12 }
    );
    assert.ok(draws >= 8, `generator reach floor: expected at least 8 runs, got ${draws}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1804/BL-654 invariant 2: a pending nudge for the id suppresses it, an absent/different one does not',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 1, max: 99999 }), (a, b) => {
        draws += 1;
        fc.pre(a !== b);
        const id = `BL-${a}`;
        const otherId = `BL-${b}`;
        // A pending nudge for a DIFFERENT id never suppresses this one
        // (non-vacuity: the predicate is keyed by id, not "any nudge at all").
        const otherResult = bbChase(`
(require '[babashka.fs :as fs])
(let [tmp (fs/create-temp-dir)
      dir (str (fs/create-dirs (fs/path tmp "coord-new")))]
  (spit (str (fs/path dir "00_a.handoff"))
        (str "from: coordinator\\nto: coordinator\\ntype: note\\npriority: 00\\nmessage: "
             (chase-sweep-lib/unassigned-active-note-message "${otherId}") "\\n\\n"))
  (println (chase-sweep-lib/unassigned-active-nudge-pending? [dir] "${id}")))
`);
        assert.equal(otherResult, 'false', `a nudge for ${otherId} must not suppress ${id}`);

        // A pending nudge for THIS id suppresses it.
        const sameResult = bbChase(`
(require '[babashka.fs :as fs])
(let [tmp (fs/create-temp-dir)
      dir (str (fs/create-dirs (fs/path tmp "coord-new")))]
  (spit (str (fs/path dir "00_a.handoff"))
        (str "from: coordinator\\nto: coordinator\\ntype: note\\npriority: 00\\nmessage: "
             (chase-sweep-lib/unassigned-active-note-message "${id}") "\\n\\n"))
  (println (chase-sweep-lib/unassigned-active-nudge-pending? [dir] "${id}")))
`);
        assert.equal(sameResult, 'true', `a nudge for ${id} itself must suppress it`);

        // An empty pending-dirs set never suppresses (non-vacuity floor).
        const emptyResult = bbChase(`(println (chase-sweep-lib/unassigned-active-nudge-pending? [] "${id}"))`);
        assert.equal(emptyResult, 'false');
      }),
      { numRuns: 10 }
    );
    assert.ok(draws >= 6, `generator reach floor: expected at least 6 runs, got ${draws}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
