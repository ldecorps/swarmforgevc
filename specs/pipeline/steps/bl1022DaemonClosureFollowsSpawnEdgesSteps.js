'use strict';

// BL-1022: step handlers for "the daemon subprocess-API gate closes over
// spawned scripts, not only loaded ones".
//
// Scenarios 01 and 04 drive the REAL walk over the REAL tree - the actual
// handoffd.bb closure, not a fixture - because the claim under test is about
// this repo's daemon. swarm_handoff.bb is reachable from handoffd.bb by a
// spawn edge and by no load edge, which is precisely the shape that hid the
// banned API until it deadlocked production.
//
// Scenarios 02 and 03 need graphs this repo does not contain (an offender
// planted inside the closure; a spawn -> load -> spawn chain), so they drive
// the same functions over an in-memory file map. The scan they exercise is
// daemon_api_ban_lib.bb's - the one the gate itself calls - never a private
// re-implementation, which would pass while the gate did something else.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'the daemon subprocess-API gate closes over spawned scripts, not only loaded ones';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const WALK_LIB = path.join(SCRIPTS, 'master_checkout_drift_lib.bb');
const BAN_LIB = path.join(SCRIPTS, 'test', 'daemon_api_ban_lib.bb');

// The daemon entrypoint the gate is computed from, and the script it reaches
// only by spawning. Both are facts about this repo, asserted rather than
// assumed by the steps that use them.
const DAEMON_ENTRYPOINT = 'handoffd.bb';
const SPAWNED_SCRIPT = 'swarm_handoff.bb';

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

// A bb map literal for an in-memory {filename -> source} graph.
function clojureFileMap(files) {
  const entries = Object.entries(files)
    .map(([name, src]) => `"${name}" ${JSON.stringify(src)}`)
    .join(' ');
  return `{${entries}}`;
}

function walkReal() {
  return JSON.parse(bb(`(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${WALK_LIB}")
(let [rd (fn [b] (let [p (fs/path "${SCRIPTS}" b)] (when (fs/exists? p) (slurp (str p)))))
      r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"${DAEMON_ENTRYPOINT}"} :read-file rd})]
  (println (json/generate-string
    {:closure (vec (sort (:closure r)))
     :reached-by (into {} (for [[k v] (:reached-by r)] [k (mapv pr-str v)]))
     :unresolved (:unresolved r)})))`));
}

function walkFixture(files) {
  return JSON.parse(bb(`(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${WALK_LIB}")
(let [r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"entry.bb"} :read-file ${clojureFileMap(files)}})]
  (println (json/generate-string {:closure (vec (sort (:closure r)))})))`));
}

// The gate's own scan, over a fixture closure.
function gateOverFixture(files) {
  return JSON.parse(bb(`(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${WALK_LIB}")
(load-file "${BAN_LIB}")
(let [srcs ${clojureFileMap(files)}
      r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"entry.bb"} :read-file srcs})]
  (println (json/generate-string
    {:closure (vec (sort (:closure r)))
     :offenders (daemon-api-ban-lib/offenders (:closure r) srcs)})))`));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the daemon subprocess-API gate walks the reachability graph from the handoff daemon$/, (ctx) => {
    ctx.entrypoint = DAEMON_ENTRYPOINT;
  });

  scoped(/^a script the daemon reaches only by spawning it as a subprocess$/, (ctx) => {
    ctx.subject = SPAWNED_SCRIPT;
    ctx.useRealTree = true;
  });

  scoped(/^a script inside the closure uses an unbounded clojure\.java\.shell call$/, (ctx) => {
    ctx.subject = 'spawned.bb';
    ctx.offendingCall = '(clojure.java.shell/sh "git" "status")';
    // Reached by SPAWN, so this scenario also proves the ban follows the new
    // edge kind - an offender behind a load edge was already caught before.
    ctx.files = {
      'entry.bb': '(sh! ["bb" "spawned.bb" (str draft)])',
      'spawned.bb': `(ns spawned (:require [clojure.java.shell :as sh]))\n(defn go [] ${ctx.offendingCall})`,
    };
  });

  scoped(/^a spawned script itself loads a second file that spawns a third$/, (ctx) => {
    ctx.chain = ['spawned.bb', 'loaded.bb', 'third.bb'];
    ctx.files = {
      'entry.bb': '(sh! ["bb" "spawned.bb" (str draft)])',
      'spawned.bb': '(load-file (str (fs/path x "loaded.bb")))',
      'loaded.bb': '(sh! ["bb" "third.bb" (str draft)])',
      'third.bb': '(defn foo [])',
    };
  });

  scoped(/^the gate computes its closure$/, (ctx) => {
    ctx.result = ctx.useRealTree ? walkReal() : walkFixture(ctx.files);
  });

  scoped(/^the gate runs$/, (ctx) => {
    ctx.result = gateOverFixture(ctx.files);
  });

  scoped(/^that script is included in the closure$/, (ctx) => {
    assert.ok(ctx.result.closure.includes(ctx.subject),
      `${ctx.subject} must be in the closure; a spawn edge is an edge. Closure: ${ctx.result.closure.join(', ')}`);
    // Included for the RIGHT reason: by a spawn edge, and by no load edge. If
    // it ever became load-reachable this scenario would still pass while
    // testing nothing, so the edge kind is asserted, not just membership.
    const via = ctx.result['reached-by'][ctx.subject] || [];
    assert.ok(via.some((e) => e.includes(':spawn')),
      `${ctx.subject} must be reached by a SPAWN edge; reached-by was ${via.join(' ')}`);
    assert.ok(!via.some((e) => e.includes(':load')),
      `${ctx.subject} is meant to be spawn-only - if it is now also loaded, this scenario no longer tests the spawn edge`);
  });

  scoped(/^the gate fails and names that script and that call$/, (ctx) => {
    assert.ok(ctx.result.offenders.length > 0,
      'a banned call inside the closure must fail the gate, not pass silently');
    const named = ctx.result.offenders.filter((o) => o.startsWith(`${ctx.subject}:`));
    assert.ok(named.length > 0,
      `the failure must NAME the script; offenders were ${JSON.stringify(ctx.result.offenders)}`);
    assert.ok(named.some((o) => o.includes('clojure.java.shell')),
      `the failure must name the CALL, not just the file; got ${JSON.stringify(named)}`);
  });

  scoped(/^all three files are included in the closure$/, (ctx) => {
    for (const f of ctx.chain) {
      assert.ok(ctx.result.closure.includes(f),
        `${f} must be in the closure - spawn and load edges are transitive together. Closure: ${ctx.result.closure.join(', ')}`);
    }
  });

  scoped(/^the report names every file in the closure and how each was reached$/, (ctx) => {
    const reachedBy = ctx.result['reached-by'];
    const unaccounted = ctx.result.closure.filter((f) => !(reachedBy[f] || []).length);
    assert.deepEqual(unaccounted, [],
      `a closure that reports no provenance cannot show a shrinking closure; unaccounted: ${unaccounted.join(', ')}`);
    const extra = Object.keys(reachedBy).filter((f) => !ctx.result.closure.includes(f));
    assert.deepEqual(extra, [],
      `the report must cover exactly the closure it walked; extra: ${extra.join(', ')}`);
    assert.ok((reachedBy[ctx.entrypoint] || []).some((e) => e.includes(':entrypoint')),
      'the entrypoint must be reported as the entrypoint');
    // An unresolvable spawn target must be reported, never silently skipped -
    // the conservative answer to the ticket's design question.
    assert.deepEqual(ctx.result.unresolved, [],
      `every spawn target in the real closure must resolve, or be reported: ${JSON.stringify(ctx.result.unresolved)}`);
  });
}

module.exports = { registerSteps };
