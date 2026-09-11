'use strict';

// BL-1525 declared invariant (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   Every file the daemon reaches by a SPAWN edge is held to the same
//   subprocess-API ban as the files it reaches by load-file (BL-1022/BL-1031);
//   a sanctioned exception, if any, is named in daemon_api_ban_lib's exempt
//   set and asserted by the runner, never implied by a passing scan.
//
// GENERATOR REACH (BL-654): the acceptance feature's scenario 03 pins ONE
// hand-written fixture (a fixed file/function name). This property test
// instead draws the spawned file's basename and its defn name at random and
// re-derives the offending call FROM the drawn name, so every generated case
// is a genuine spawn-reachable offender by construction, not a hoped-for one -
// and proves the SET of file names the scan can catch is not narrowly tied to
// the one name the acceptance fixture happens to use.
//
//   inv1: a spawn-only-reached file naming the banned API is always reported,
//         for any drawn file/defn name - the positive case.
//   inv2: the SAME spawn-only-reached file, once rewritten to route through
//         the chokepoint instead, is never reported - proves inv1 is not a
//         scan that flags every spawn-reached file regardless of content.
//   inv3: a file merely NAMED after the chokepoint (not the literal
//         "daemon_cycle_guard_lib.bb" the default exempt set holds) gets no
//         free pass - the exemption is exact-match, never implied by a
//         name that looks like the chokepoint's.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WALK_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_checkout_drift_lib.bb');
const BAN_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'daemon_api_ban_lib.bb');

const BASENAME = fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/);

function clojureFileMap(files) {
  return `{${Object.entries(files)
    .map(([name, src]) => `"${name}" ${JSON.stringify(src)}`)
    .join(' ')}}`;
}

// Spawn-only offenders: files reached ONLY via a spawn edge from `entry.bb`
// (never a load edge) - the exact set the runner's bl1031 assertion checks,
// mirroring daemon_cycle_guard_lib_test_runner.bb's own `spawn-only` /
// `spawn-offender-files` computation.
function spawnOnlyOffenders(files) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(load-file ${JSON.stringify(BAN_LIB)})
(let [srcs ${clojureFileMap(files)}
      read-file (fn [name] (get srcs name))
      reach (master-checkout-drift-lib/resolve-daemon-reachability
              {:entrypoints #{"entry.bb"} :read-file read-file})
      load-closure (master-checkout-drift-lib/resolve-daemon-executed-paths
                     {:entrypoints #{"entry.bb"} :read-file read-file})
      spawn-only (remove load-closure (:closure reach))]
  (println (json/generate-string (vec (sort (into #{} (map #(first (clojure.string/split % #":")) (daemon-api-ban-lib/offenders spawn-only read-file))))))))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 }
  );
  return JSON.parse(out.trim());
}

describe('BL-1525 declared invariant: spawn-reachable files carry no banned-API debt', () => {
  it('inv1: a spawn-only-reached file naming the banned API is always reported', () => {
    fc.assert(
      fc.property(BASENAME, BASENAME, (fileSfx, fnSfx) => {
        const spawned = `spawned_${fileSfx}.bb`;
        const fnName = `go_${fnSfx}`;
        const files = {
          'entry.bb': `(daemon-cycle-guard-lib/sh! ["bb" ${JSON.stringify(spawned)}])`,
          [spawned]: `(ns spawned-${fileSfx} (:require [babashka.process :as process]))\n(defn ${fnName} [] (process/sh "true"))`,
        };
        const offenders = spawnOnlyOffenders(files);
        assert.deepEqual(
          offenders,
          [spawned],
          `expected exactly [${spawned}] reported, got ${JSON.stringify(offenders)}`
        );
      }),
      { numRuns: 15 }
    );
  }, 120000);

  it('inv2: the same spawn-only-reached file routed through the chokepoint is never reported', () => {
    fc.assert(
      fc.property(BASENAME, BASENAME, (fileSfx, fnSfx) => {
        const spawned = `spawned_${fileSfx}.bb`;
        const fnName = `go_${fnSfx}`;
        const files = {
          'entry.bb': `(daemon-cycle-guard-lib/sh! ["bb" ${JSON.stringify(spawned)}])`,
          [spawned]: `(ns spawned-${fileSfx})\n(defn ${fnName} [] (daemon-cycle-guard-lib/sh! "true"))`,
        };
        const offenders = spawnOnlyOffenders(files);
        assert.deepEqual(offenders, [], `expected no offenders, got ${JSON.stringify(offenders)}`);
      }),
      { numRuns: 15 }
    );
  }, 120000);

  it('inv3: a file merely named after the chokepoint gets no free pass (exemption is exact-match)', () => {
    fc.assert(
      fc.property(BASENAME, BASENAME, (fileSfx, fnSfx) => {
        // Looks like the chokepoint by NAME but is not the literal
        // "daemon_cycle_guard_lib.bb" the default exempt set holds.
        const lookalike = `daemon_cycle_guard_lib_${fileSfx}.bb`;
        const fnName = `go_${fnSfx}`;
        const files = {
          'entry.bb': `(daemon-cycle-guard-lib/sh! ["bb" ${JSON.stringify(lookalike)}])`,
          [lookalike]: `(ns lookalike-${fileSfx} (:require [babashka.process :as process]))\n(defn ${fnName} [] (process/sh "true"))`,
        };
        const offenders = spawnOnlyOffenders(files);
        assert.deepEqual(
          offenders,
          [lookalike],
          `a chokepoint-lookalike name must not be exempted: got ${JSON.stringify(offenders)}`
        );
      }),
      { numRuns: 15 }
    );
  }, 120000);
});
