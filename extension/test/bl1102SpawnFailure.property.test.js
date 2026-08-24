'use strict';

// BL-1102 declared invariants (coder first authorship — BL-654):
//
// 1. No spawn failure leaves the bounded shell-out as a throw — every call
//    returns a result map, whatever state the named binary is in.
// 2. A spawn that never happened, a command that ran and exited non-zero,
//    and a wait-bound hit are three outcomes a caller can tell apart.
// 3. A call that does spawn is unaffected: same exit, stdout, stderr.
//
// Non-vacuity: (1) a real `false` returns without spawn-failed?; (2) exit
// 124 timeout lacks the marker; (3) echo hello still exits 0. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_cycle_guard_lib.bb');

function bb(expr) {
  return execFileSync('bb', ['-e', `(load-file "${LIB}")\n${expr}`], {
    encoding: 'utf8',
  }).trim();
}

test(
  'BL-1102/BL-654 invariant 1: unspawnable binary returns a map, never throws',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom('no-such-bl1102-a', 'no-such-bl1102-b'), (name) => {
        draws += 1;
        const r = bb(
          `(try (let [r (daemon-cycle-guard-lib/sh! ${JSON.stringify(name)})] (println (pr-str {:ok true :spawn-failed? (boolean (:spawn-failed? r)) :exit (:exit r)}))) (catch Throwable t (println (pr-str {:ok false :msg (.getMessage t)}))))`
        );
        assert.match(r, /:ok true/);
        assert.match(r, /:spawn-failed\? true/);
        // Non-vacuity: real false is ok without spawn-failed?
        const ran = bb(
          `(println (pr-str {:spawn-failed? (boolean (:spawn-failed? (daemon-cycle-guard-lib/sh! "false"))) :exit (:exit (daemon-cycle-guard-lib/sh! "false"))}))`
        );
        assert.match(ran, /:spawn-failed\? false/);
        assert.match(ran, /:exit 1/);
      }),
      { numRuns: 4 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1102/BL-654 invariant 2: spawn / non-zero / timeout are distinguishable',
  () => {
    const spawn = bb(
      `(println (pr-str (select-keys (daemon-cycle-guard-lib/sh! "no-such-bl1102-inv2") [:exit :spawn-failed?])))`
    );
    const failed = bb(
      `(println (pr-str (select-keys (daemon-cycle-guard-lib/sh! "false") [:exit :spawn-failed?])))`
    );
    const timed = bb(`
      (println (pr-str
        (select-keys
          (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] 150)]
            (daemon-cycle-guard-lib/sh! "sleep" "5"))
          [:exit :spawn-failed?])))`);
    assert.match(spawn, /:spawn-failed\? true/);
    assert.match(failed, /:exit 1/);
    assert.doesNotMatch(failed, /:spawn-failed\? true/);
    assert.match(timed, /:exit 124/);
    assert.doesNotMatch(timed, /:spawn-failed\? true/);
    assert.notEqual(spawn, failed);
    assert.notEqual(spawn, timed);
    assert.notEqual(failed, timed);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1102/BL-654 invariant 3: successful spawn keeps exit/out/err',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom('alpha', 'beta'), (msg) => {
        draws += 1;
        const r = bb(
          `(let [r (daemon-cycle-guard-lib/sh! "echo" ${JSON.stringify(msg)})] (println (pr-str {:exit (:exit r) :out (clojure.string/trim (:out r)) :spawn-failed? (boolean (:spawn-failed? r))})))`
        );
        assert.match(r, /:exit 0/);
        assert.match(r, new RegExp(`:out "${msg}"`));
        assert.match(r, /:spawn-failed\? false/);
      }),
      { numRuns: 4 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
