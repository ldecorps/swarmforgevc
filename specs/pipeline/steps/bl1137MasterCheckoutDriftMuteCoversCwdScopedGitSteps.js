'use strict';

// BL-1137: mute covers cwd-scoped git add/commit (root may be absent from argv).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Master-checkout drift mute covers cwd-scoped git add/commit';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_checkout_drift_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1137) {
    ctx.bl1137 = {
      inFlight: false,
      stagedReversion: false,
      indexDiffers: false,
      alarmCount: 0,
      overall: null,
      raw: '',
    };
  }
  return ctx.bl1137;
}

function runCheck(ctx) {
  const st = ensure(ctx);
  const script = `
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
   {:project-root "/tmp/bl1137-unused"
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

  scoped(/^bl1137MasterCheckoutDriftMuteCoversCwdScopedGitSteps acceptance handler is registered$/, () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(idx.includes('bl1137MasterCheckoutDriftMuteCoversCwdScopedGitSteps'));
  });

  scoped(/^the daemons execute scripts from the master checkout's working tree$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^every daemon-executed script in the master checkout matches main$/, (ctx) => {
    const st = ensure(ctx);
    st.stagedReversion = false;
    st.indexDiffers = false;
  });

  scoped(/^no commit is in flight on the master checkout$/, (ctx) => {
    ensure(ctx).inFlight = false;
  });

  scoped(/^a daemon-executed script is staged for reversion out of main$/, (ctx) => {
    const st = ensure(ctx);
    st.stagedReversion = true;
    st.indexDiffers = true;
  });

  scoped(/^no git add or git commit is in flight on the master checkout$/, (ctx) => {
    ensure(ctx).inFlight = false;
  });

  scoped(/^no index\.lock is present$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^no index\.lock is present on the master checkout$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a daemon-executed script's index content differs from main$/, (ctx) => {
    ensure(ctx).indexDiffers = true;
  });

  scoped(/^a git commit process is in flight with cwd at the master checkout$/, (ctx) => {
    ensure(ctx).inFlight = true;
  });

  scoped(/^that process argv does not contain the project-root string$/, (ctx) => {
    // Classifier coverage is in the bb unit/property runners; APS uses injected mute.
    ensure(ctx).inFlight = true;
  });

  scoped(/^a daemon-executed script is staged and differs from main$/, (ctx) => {
    const st = ensure(ctx);
    st.stagedReversion = true;
    st.indexDiffers = true;
  });

  scoped(/^index\.lock is absent$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a git add is observably in flight with cwd at this project root$/, (ctx) => {
    ensure(ctx).inFlight = true;
  });

  scoped(/^a git commit process is in flight via git -C this project root$/, (ctx) => {
    ensure(ctx).inFlight = true;
  });

  scoped(/^a git commit is in flight with cwd at a different project$/, (ctx) => {
    ensure(ctx).inFlight = false;
  });

  scoped(/^the in-flight git signal has cleared$/, (ctx) => {
    const st = ensure(ctx);
    st.inFlight = false;
    st.stagedReversion = true;
    st.indexDiffers = true;
  });

  scoped(/^a cwd-scoped git commit is in flight on the master checkout$/, (ctx) => {
    ensure(ctx).inFlight = true;
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
  });

  scoped(/^the master checkout's index and worktree are unmodified by the check$/, (ctx) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1137-nowrite-'));
    fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
    const before = fs.readdirSync(path.join(tmp, '.git')).sort().join(',');
    const r = runBb(`
(load-file "${LIB}")
(def root "${tmp}")
(assert (not (master-checkout-drift-lib/commit-in-flight? root [])))
(assert (master-checkout-drift-lib/commit-in-flight?
         root [{:cmdline "git commit -m x" :cwd root}]))
(assert (master-checkout-drift-lib/git-add-or-commit-process-for-root?
         {:cmdline "git add handoffd.bb" :cwd root} root))
(assert (not (master-checkout-drift-lib/git-add-or-commit-process-for-root?
              {:cmdline "git commit -m x" :cwd "/other"} root)))
(println "CWD_OK")
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout || '', /CWD_OK/);
    const after = fs.readdirSync(path.join(tmp, '.git')).sort().join(',');
    assert.equal(after, before, 'commit-in-flight? must not write under .git');
    fs.rmSync(tmp, { recursive: true, force: true });
    assert.ok(ensure(ctx).raw.length > 0);
  });
}

module.exports = { registerSteps };
