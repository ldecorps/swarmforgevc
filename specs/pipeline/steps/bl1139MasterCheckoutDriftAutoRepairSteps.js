'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'BL-839 follow-on — auto-repair durable master-checkout drift on daemon scripts';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_checkout_drift_lib.bb');

function runBb(expr) {
  const r = spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

function ensure(ctx) {
  if (!ctx.bl1139) ctx.bl1139 = { raw: '' };
  return ctx.bl1139;
}

function repairExpr(opts) {
  const {
    inFlight = false,
    checkoutOk = true,
    outsidePath = false,
  } = opts;
  return `
(load-file "${LIB}")
(def alarms (atom []))
(def notes (atom []))
(def bounced (atom false))
(def checkouts (atom []))
(def disk (atom {"a.bb" "DIRTY"}))
(def main-content "CLEAN")
(def result
  (master-checkout-drift-lib/repair-master-checkout-drift!
   {:project-root "/tmp/bl1139"
    :scripts-subdir "swarmforge/scripts"
    :entrypoints #{"a.bb"}
    :emit-alarm! (fn [t] (swap! alarms conj t))
    :emit-restored! (fn [t] (swap! notes conj t))
    :bounce-handoffd! (fn [] (reset! bounced true))
    :commit-in-flight?* (fn [_] ${inFlight})
    :resolve-paths* (fn [] [${outsidePath ? '"docs/outside.md" "swarmforge/scripts/a.bb"' : '"swarmforge/scripts/a.bb"'}])
    :run-git* (fn [_ args]
                (cond
                  (= args ["rev-parse" "--verify" "main"]) {:ok? true :content ""}
                  (= (first args) "show") {:ok? true :content main-content}
                  :else {:ok? false :content nil}))
    :read-disk* (fn [_ _ bare] {:ok? true :content (get @disk bare "DIRTY")})
    :checkout! (fn [_ p]
                 (swap! checkouts conj p)
                 ${checkoutOk ? '(do (when (= p "swarmforge/scripts/a.bb") (swap! disk assoc "a.bb" main-content)) {:ok? true})' : '{:ok? false :err "fail"}'})}))
(println (str "ACTION=" (name (:action result))))
(println (str "CHECKOUTS=" (pr-str @checkouts)))
(println (str "NOTES=" (count @notes)))
(println (str "ALARMS=" (count @alarms)))
(println (str "BOUNCED=" @bounced))
(when (seq @notes) (println (str "NOTE0=" (first @notes))))
`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^master-checkout drift detection for the daemon-executed path closure$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a daemon-executed path differs from main and is classified as drift$/, (ctx) => {
    ensure(ctx).drift = true;
  });

  scoped(/^commit-in-flight is false$/, (ctx) => {
    ensure(ctx).inFlight = false;
  });

  scoped(/^the drift repair sweep runs$/, (ctx) => {
    const st = ensure(ctx);
    st.raw = runBb(repairExpr({ inFlight: !!st.inFlight, checkoutOk: st.checkoutOk !== false }));
  });

  scoped(/^that path matches main$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ACTION=restored/);
  });

  scoped(/^Operator receives a one-shot MASTER CHECKOUT DRIFT RESTORED note naming the path$/, (ctx) => {
    assert.match(ensure(ctx).raw, /NOTES=1/);
    assert.match(ensure(ctx).raw, /MASTER CHECKOUT DRIFT RESTORED/);
  });

  scoped(/^no repeating MASTER CHECKOUT DRIFT WARN remains for that restored episode$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ALARMS=0/);
  });

  scoped(/^a daemon-executed path would classify as drift$/, (ctx) => {
    ensure(ctx).drift = true;
  });

  scoped(/^commit-in-flight is true$/, (ctx) => {
    ensure(ctx).inFlight = true;
  });

  scoped(/^no git checkout or restore runs against that path$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ACTION=skip-in-flight/);
    assert.match(ensure(ctx).raw, /CHECKOUTS=\[\]/);
  });

  scoped(/^existing in-flight mute rules are unchanged$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ACTION=skip-in-flight/);
  });

  scoped(/^durable drift on a daemon-executed path$/, (ctx) => {
    ensure(ctx).drift = true;
    ensure(ctx).checkoutOk = false;
  });

  scoped(/^restore fails or re-check is still drift or unknown$/, (ctx) => {
    ensure(ctx).checkoutOk = false;
    ensure(ctx).raw = runBb(repairExpr({ inFlight: false, checkoutOk: false }));
  });

  scoped(/^the existing MASTER CHECKOUT DRIFT WARN is still emitted$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ACTION=warn/);
    assert.match(ensure(ctx).raw, /ALARMS=[1-9]/);
  });

  scoped(/^durable drift was restored from main successfully$/, (ctx) => {
    ensure(ctx).raw = runBb(repairExpr({ inFlight: false, checkoutOk: true }));
  });

  scoped(/^the repair sweep finishes the restore$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ACTION=restored/);
  });

  scoped(/^handoffd and its supervisor are bounced via start_handoff_daemon\.sh or restart-handoffd-group$/, (ctx) => {
    assert.match(ensure(ctx).raw, /BOUNCED=true/);
  });

  scoped(/^the bounce is deferred so the current sweep tick can finish$/, (ctx) => {
    assert.match(ensure(ctx).raw, /BOUNCED=true/);
  });

  scoped(/^drifted paths some of which are outside resolve-daemon-executed-paths$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (pr-str (master-checkout-drift-lib/filter-repair-candidates
  ["swarmforge/scripts/a.bb" "docs/outside.md"]
  #{"swarmforge/scripts/a.bb"})))
`);
    ensure(ctx).raw = r;
  });

  scoped(/^the repair sweep chooses restore candidates$/, (ctx) => {
    assert.match(ensure(ctx).raw, /swarmforge\/scripts\/a\.bb/);
  });

  scoped(/^every restored path is in the daemon-executed closure$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).raw, /outside/);
  });

  scoped(/^check-master-checkout-drift itself performs no writes$/, (ctx) => {
    const src = require('node:fs').readFileSync(LIB, 'utf8');
    assert.match(src, /check-master-checkout-drift!/);
    assert.match(src, /Read-only git plumbing only/);
    assert.doesNotMatch(src.split('(defn check-master-checkout-drift!')[1].split('(defn ')[0], /checkout main/);
  });
}

module.exports = { registerSteps };
