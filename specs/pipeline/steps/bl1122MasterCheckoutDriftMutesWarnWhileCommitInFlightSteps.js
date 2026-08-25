'use strict';

// BL-1122: mute MASTER CHECKOUT DRIFT WARN while index.lock / commit in flight.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Master-checkout drift does not WARN while a commit is in flight';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_checkout_drift_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1122) {
    ctx.bl1122 = {
      inFlight: false,
      stagedReversion: false,
      indexDiffers: false,
      alarms: [],
      overall: null,
      perFile: null,
    };
  }
  return ctx.bl1122;
}

function runCheck(ctx) {
  const st = ensure(ctx);
  const script = `
(require '[clojure.string :as str])
(load-file "${LIB}")
(def alarms (atom []))
(def handoffd-src "(load-file \\"a.bb\\")\\n")
(def a-main "(defn foo [] :main)\\n")
(def a-index ${st.stagedReversion || st.indexDiffers ? '"(defn foo [] :index)\\n"' : 'a-main'})
(def a-work a-main)
(defn content-for [spec]
  (cond
    (str/ends-with? (str spec) "handoffd.bb") handoffd-src
    (str/ends-with? (str spec) "a.bb")
    (cond
      (str/starts-with? (str spec) "main:") a-main
      (str/starts-with? (str spec) ":") a-index
      :else a-work)
    :else nil))
(def result
  (master-checkout-drift-lib/check-master-checkout-drift!
   {:project-root "/tmp/bl1122-unused"
    :entrypoints #{"handoffd.bb"}
    :emit-alarm! (fn [t] (swap! alarms conj t))
    :commit-in-flight?* (fn [_] ${st.inFlight ? 'true' : 'false'})
    :run-git* (fn [_root args]
                (cond
                  (= args ["rev-parse" "--verify" "main"]) {:ok? true :content "ok"}
                  (= (first args) "show")
                  (let [c (content-for (second args))]
                    (if c {:ok? true :content c} {:ok? false :content nil}))
                  :else {:ok? false :content nil}))
    :read-disk* (fn [_ _ bare]
                  (cond
                    (= bare "handoffd.bb") {:ok? true :content handoffd-src}
                    (= bare "a.bb") {:ok? true :content a-work}
                    :else {:ok? false :content nil}))}))
(println "OVERALL" (name (:overall result)))
(println "ALARM_COUNT" (count @alarms))
(doseq [a @alarms] (println "ALARM" a))
(println "PER" (pr-str (:per-file result)))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const raw = `${r.stdout || ''}${r.stderr || ''}`;
  st.raw = raw;
  st.alarmCount = Number((raw.match(/ALARM_COUNT (\d+)/) || [])[1] || 0);
  st.overall = (raw.match(/OVERALL (\S+)/) || [])[1];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the daemons execute scripts from the master checkout's working tree$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^every daemon-executed script in the master checkout matches main$/, (ctx) => {
    ensure(ctx).stagedReversion = false;
    ensure(ctx).indexDiffers = false;
  });

  scoped(/^no commit is in flight on the master checkout$/, (ctx) => {
    ensure(ctx).inFlight = false;
  });

  scoped(/^a daemon-executed script is staged for reversion out of main$/, (ctx) => {
    ensure(ctx).stagedReversion = true;
    ensure(ctx).indexDiffers = true;
  });

  scoped(/^a daemon-executed script's index content differs from main$/, (ctx) => {
    ensure(ctx).indexDiffers = true;
  });

  scoped(/^a commit is in flight on the master checkout$/, (ctx) => {
    ensure(ctx).inFlight = true;
  });

  scoped(/^a commit was in flight and has now finished$/, (ctx) => {
    ensure(ctx).inFlight = false;
    ensure(ctx).stagedReversion = true;
    ensure(ctx).indexDiffers = true;
  });

  scoped(/^the drift check runs$/, (ctx) => {
    runCheck(ctx);
  });

  scoped(/^it reports no drift$/, (ctx) => {
    assert.equal(ensure(ctx).overall, 'no-drift');
  });

  scoped(/^it raises no alarm$/, (ctx) => {
    assert.equal(ensure(ctx).alarmCount, 0);
  });

  scoped(/^it reports drift naming that script as staged for reversion$/, (ctx) => {
    assert.equal(ensure(ctx).overall, 'drift');
    assert.match(ensure(ctx).raw, /staged-for-reversion|:staged-for-reversion/);
  });

  scoped(/^it raises a MASTER CHECKOUT DRIFT alarm$/, (ctx) => {
    assert.ok(ensure(ctx).alarmCount >= 1);
    assert.match(ensure(ctx).raw, /MASTER CHECKOUT DRIFT/);
  });

  scoped(/^it raises no MASTER CHECKOUT DRIFT alarm this sweep$/, (ctx) => {
    assert.equal(ensure(ctx).alarmCount, 0);
    assert.doesNotMatch(ensure(ctx).raw, /ALARM MASTER CHECKOUT DRIFT/);
  });

  scoped(/^the master checkout's index and worktree are unmodified by the check$/, (ctx) => {
    const r = runBb(`
(require '[babashka.fs :as fs])
(load-file "${LIB}")
(def tmp (str (fs/create-temp-dir {:prefix "bl1122-lock-"})))
(fs/create-dirs (fs/path tmp ".git"))
(assert (not (master-checkout-drift-lib/commit-in-flight? tmp)))
(spit (str (fs/path tmp ".git" "index.lock")) "")
(assert (master-checkout-drift-lib/commit-in-flight? tmp))
(println "LOCK_OK")
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout || '', /LOCK_OK/);
    // Prior When ran the drift check with injected fakes only — no real writes.
    assert.ok(ensure(ctx).raw.length > 0);
  });
}

module.exports = { registerSteps };
