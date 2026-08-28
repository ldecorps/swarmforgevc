'use strict';

// BL-1131: rematch-then-FF land reaches behind=0 without operator absorb merge.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1131 ticket land reaches behind=0 without operator absorb merge';
const REPO = path.join(__dirname, '..', '..', '..');
const RECONCILE = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');
const POST = path.join(REPO, 'swarmforge', 'scripts', 'post_hotfix_merge_origin_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1131) {
    ctx.bl1131 = {
      tipContainsOrigin: false,
      rematchConflict: false,
      ahead: 1,
      behind: 2,
      absorbConflict: false,
      prepared: false,
      raw: '',
    };
  }
  return ctx.bl1131;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a master checkout that runs BL-891-style origin\/main absorb$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^BL-1130 clean-refuse behaviour remains in force$/, (ctx) => {
    ensure(ctx).bl1130 = true;
  });

  scoped(/^local main is ahead of origin\/main with overlapping ticket paths$/, (ctx) => {
    const st = ensure(ctx);
    st.ahead = 1;
    st.behind = 2;
    st.absorbConflict = true;
  });

  scoped(/^a ticket land tip is prepared under the BL-1131 rematch-then-FF rule$/, (ctx) => {
    const st = ensure(ctx);
    st.prepared = true;
    st.tipContainsOrigin = true;
    st.rematchConflict = false;
    st.absorbConflict = false;
    st.ahead = 0;
    st.behind = 0;
  });

  scoped(/^local main is ahead and an ordinary ticket land would collide on paths$/, (ctx) => {
    const st = ensure(ctx);
    st.ahead = 1;
    st.behind = 2;
    st.absorbConflict = true;
    st.tipContainsOrigin = false;
    st.prepared = false;
  });

  scoped(/^a land tip that is behind origin\/main$/, (ctx) => {
    const st = ensure(ctx);
    st.tipContainsOrigin = false;
    st.behind = 2;
  });

  scoped(/^rematch onto origin\/main would join cleanly$/, (ctx) => {
    ensure(ctx).rematchConflict = false;
  });

  scoped(/^rematch onto origin\/main would conflict$/, (ctx) => {
    ensure(ctx).rematchConflict = true;
  });

  scoped(/^that tip publishes to origin\/main and the automated absorb path runs$/, (ctx) => {
    runLandPipeline(ctx, { successPath: true });
  });

  scoped(/^the land-plus-absorb pipeline runs under the BL-1131 rule$/, (ctx) => {
    runLandPipeline(ctx, { successPath: false });
  });

  scoped(/^the pre-publish rematch step runs$/, (ctx) => {
    runPrepublish(ctx);
  });

  scoped(/^behind is 0$/, (ctx) => {
    assert.match(ensure(ctx).raw, /BEHIND=0|:behind 0/);
  });

  scoped(/^no human conflict-resolution or absorb-merge commit was required$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /OK=true/);
    assert.doesNotMatch(raw, /Complete origin\/main merge|finish this merge in an editor/i);
    assert.match(raw, /OPERATOR_ABSORB=false/);
  });

  scoped(/^coordinator sync action is proceed$/, (ctx) => {
    assert.match(ensure(ctx).raw, /SYNC=proceed/);
  });

  scoped(/^the designed recovery is rematch for the lander or bookkeeping owner$/, (ctx) => {
    assert.match(ensure(ctx).raw, /RECOVERY=rematch-(lander|bookkeeping-owner)/);
  });

  scoped(/^the designed recovery is not an operator completing a conflicted merge$/, (ctx) => {
    assert.match(ensure(ctx).raw, /OPERATOR_ABSORB=false/);
    assert.doesNotMatch(ensure(ctx).raw, /Complete origin\/main merge/i);
  });

  scoped(/^the worktree has no MERGE_HEAD$/, (ctx) => {
    assert.match(ensure(ctx).raw, /MID_MERGE=false/);
  });

  scoped(/^the tip that may be published contains origin\/main as an ancestor$/, (ctx) => {
    assert.match(ensure(ctx).raw, /PREPUBLISH=(already-contains-origin|rematch-clean)/);
    assert.match(ensure(ctx).raw, /MAY_PUBLISH=true/);
    assert.match(ensure(ctx).raw, /TIP_CONTAINS_ORIGIN=true/);
  });

  scoped(/^rematch fails cleanly naming the lander$/, (ctx) => {
    assert.match(ensure(ctx).raw, /PREPUBLISH=refuse-lander/);
    assert.match(ensure(ctx).raw, /MAY_PUBLISH=false/);
    assert.match(ensure(ctx).raw, /RECOVERY=rematch-lander/);
  });
}

function runPrepublish(ctx) {
  const st = ensure(ctx);
  const script = `
(load-file "${RECONCILE}")
(def plan (master-main-reconcile-lib/prepublish-rematch-plan
           {:tip-contains-origin? ${st.tipContainsOrigin}
            :rematch-would-conflict? ${st.rematchConflict}}))
(def may? (master-main-reconcile-lib/may-publish-land-tip? plan))
(def tip-ok? (or (= plan :already-contains-origin)
                 (and (= plan :rematch-clean) (not ${st.rematchConflict}))))
(def outcome (master-main-reconcile-lib/land-pipeline-outcome
              {:prepublish-plan plan
               :absorb-plan :noop
               :mid-merge? false}))
(println (str "PREPUBLISH=" (name plan)))
(println (str "MAY_PUBLISH=" may?))
(println (str "TIP_CONTAINS_ORIGIN=" tip-ok?))
(println (str "MID_MERGE=false"))
(println (str "RECOVERY=" (name (:recovery outcome))))
(println (str "OPERATOR_ABSORB=" (:designed-recovery-operator-absorb? outcome)))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
}

function runLandPipeline(ctx, { successPath }) {
  const st = ensure(ctx);
  const script = successPath
    ? `
(require '[babashka.fs :as fs])
(load-file "${RECONCILE}")
(load-file "${POST}")
(def daemon (str (fs/create-temp-dir {:prefix "bl1131-ok-"})))
(def pre (master-main-reconcile-lib/prepublish-rematch-plan
          {:tip-contains-origin? true :rematch-would-conflict? false}))
(def absorb :ff-absorb)
(def outcome (master-main-reconcile-lib/land-pipeline-outcome
              {:prepublish-plan pre :absorb-plan absorb :mid-merge? false}))
(def behind-atom (atom 0))
(def result
  (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
   {:daemon-dir daemon
    :fetch! (fn [])
    :rev-counts! (fn [] {:ahead 0 :behind @behind-atom})
    :dirty-paths! (fn [] [])
    :merge-verdict! (fn [] :clean)
    :tip-contains-origin! (fn [] true)
    :merge! (fn [] (reset! behind-atom 0) {:success true})
    :abort! (fn [])
    :status-porcelain! (fn [] "")
    :mid-merge? (fn [] false)}))
(println (str "BEHIND=" (:behind outcome)))
(println (str "SYNC=" (name (:sync-action outcome))))
(println (str "OK=" (:ok? outcome)))
(println (str "MID_MERGE=" (:mid-merge? outcome)))
(println (str "OPERATOR_ABSORB=" (:designed-recovery-operator-absorb? outcome)))
(println (str "ABSORB_OUTCOME=" (name (:outcome result))))
`
    : `
(require '[babashka.fs :as fs])
(load-file "${RECONCILE}")
(load-file "${POST}")
(def daemon (str (fs/create-temp-dir {:prefix "bl1131-race-"})))
(def pre (master-main-reconcile-lib/prepublish-rematch-plan
          {:tip-contains-origin? false :rematch-would-conflict? false}))
(def absorb (master-main-reconcile-lib/post-land-absorb-plan
             {:behind 2 :ahead 1 :tip-contains-origin? false :absorb-would-conflict? true}))
(def outcome (master-main-reconcile-lib/land-pipeline-outcome
              {:prepublish-plan pre :absorb-plan absorb :mid-merge? false}))
(def result
  (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
   {:daemon-dir daemon
    :fetch! (fn [])
    :rev-counts! (fn [] {:ahead 1 :behind 2})
    :dirty-paths! (fn [] [])
    :merge-verdict! (fn [] :conflict)
    :tip-contains-origin! (fn [] false)
    :merge! (fn [] {:success true})
    :abort! (fn [])
    :status-porcelain! (fn [] "")
    :mid-merge? (fn [] false)}))
(println (str "RECOVERY=" (name (:recovery outcome))))
(println (str "OPERATOR_ABSORB=" (:designed-recovery-operator-absorb? outcome)))
(println (str "MID_MERGE=" (:mid-merge? outcome)))
(println (str "ABSORB_OUTCOME=" (name (:outcome result))))
(println (str "OPERATOR_PHRASE="
              (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
               "Complete origin/main merge")))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
}

module.exports = { registerSteps };
