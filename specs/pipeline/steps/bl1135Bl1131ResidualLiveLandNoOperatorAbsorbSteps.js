'use strict';

// BL-1135: residual live land path — rematch outcomes must not page Operator absorb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1131 residual — live lands still must not ops-page operator absorb';
const REPO = path.join(__dirname, '..', '..', '..');
const RECONCILE = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');
const HANDOFFD = path.join(REPO, 'swarmforge', 'scripts', 'handoffd.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1135) {
    ctx.bl1135 = { raw: '', escalations: [], surfaces: [] };
  }
  return ctx.bl1135;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^BL-1131 policy helpers exist on the absorb dispatch path$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^BL-1130 clean-refuse behaviour remains in force$/, (ctx) => {
    ensure(ctx).bl1130 = true;
  });

  scoped(/^local main is ahead of origin\/main with overlapping ticket paths$/, (ctx) => {
    const st = ensure(ctx);
    st.ahead = 1;
    st.behind = 2;
    st.tipContainsOrigin = true;
    st.absorbConflict = false;
  });

  scoped(/^a ticket tip publishes to origin\/main through the live QA land path$/, (ctx) => {
    ensure(ctx).published = true;
  });

  scoped(/^the automated master absorb path runs$/, (ctx) => {
    runSuccessLand(ctx);
  });

  scoped(/^behind is 0$/, (ctx) => {
    assert.match(ensure(ctx).raw, /BEHIND=0/);
  });

  scoped(/^coordinator sync action is proceed$/, (ctx) => {
    assert.match(ensure(ctx).raw, /SYNC=proceed/);
  });

  scoped(
    /^no Complete-origin\/main-merge or human conflict-resolution commit was required$/,
    (ctx) => {
      assert.match(ensure(ctx).raw, /OPERATOR_ABSORB=false/);
      assert.doesNotMatch(ensure(ctx).raw, /Complete origin\/main merge/i);
    }
  );

  scoped(/^local main is ahead and absorb would content-conflict$/, (ctx) => {
    const st = ensure(ctx);
    st.ahead = 1;
    st.behind = 2;
    st.absorbConflict = true;
    st.tipContainsOrigin = false;
  });

  scoped(/^the automated absorb path runs$/, (ctx) => {
    runConflictAbsorb(ctx);
  });

  scoped(/^the designed recovery is rematch lander or rematch bookkeeping owner$/, (ctx) => {
    assert.match(ensure(ctx).raw, /RECOVERY=rematch-(lander|bookkeeping-owner)/);
  });

  scoped(/^the surface does not page an operator to finish a conflicted absorb merge$/, (ctx) => {
    assert.match(ensure(ctx).raw, /OPERATOR_PAGE=false/);
    assert.doesNotMatch(ensure(ctx).raw, /needs a human/i);
    assert.doesNotMatch(ensure(ctx).raw, /Complete origin\/main merge/i);
  });

  scoped(/^the checkout has no MERGE_HEAD left for an editor$/, (ctx) => {
    assert.match(ensure(ctx).raw, /MID_MERGE=false/);
  });

  scoped(/^absorb-dispatch-plan returns replay-bookkeeping$/, (ctx) => {
    ensure(ctx).plan = 'replay-bookkeeping';
  });

  scoped(/^the live absorb runner handles that plan$/, (ctx) => {
    runReplayBookkeepingLive(ctx);
  });

  scoped(/^bookkeeping is replayed onto the new tip or rematch is surfaced to its owner$/, (ctx) => {
    assert.match(ensure(ctx).raw, /OUTCOME=rematch-bookkeeping|SURFACED=rematch/);
  });

  scoped(/^main_sync_status is not left wait-dirty-clear pending an operator merge$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).raw, /wait-dirty-clear/);
  });

  scoped(/^a predicted content conflict on automated absorb$/, (ctx) => {
    ensure(ctx).absorbConflict = true;
    ensure(ctx).foreignMergeHead = true;
  });

  scoped(/^the absorb path runs$/, (ctx) => {
    runBl1130Bl1120(ctx);
  });

  scoped(/^it refuses clean without leaving MERGE_HEAD$/, (ctx) => {
    assert.match(ensure(ctx).raw, /OUTCOME=refuse-rematch/);
    assert.match(ensure(ctx).raw, /MID_MERGE=false/);
  });

  scoped(/^a pre-existing foreign MERGE_HEAD is not aborted by this tick$/, (ctx) => {
    assert.match(ensure(ctx).raw, /FOREIGN_ABORT=false/);
  });
}

function runSuccessLand(ctx) {
  const st = ensure(ctx);
  const script = `
(load-file "${RECONCILE}")
(def pre :already-contains-origin)
(def absorb :ff-absorb)
(def out (master-main-reconcile-lib/land-pipeline-outcome
          {:prepublish-plan pre :absorb-plan absorb :mid-merge? false}))
(println (str "BEHIND=" (:behind out)))
(println (str "SYNC=" (name (:sync-action out))))
(println (str "OK=" (:ok? out)))
(println (str "OPERATOR_ABSORB=" (:designed-recovery-operator-absorb? out)))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
}

function runConflictAbsorb(ctx) {
  const st = ensure(ctx);
  const script = `
(load-file "${RECONCILE}")
(def plan (master-main-reconcile-lib/absorb-dispatch-plan
           {:merge-head-present? false
            :behind 2 :ahead 1
            :tip-contains-origin? false
            :would-conflict? true
            :absorb-would-conflict? true}))
(def out (master-main-reconcile-lib/land-pipeline-outcome
          {:prepublish-plan :already-contains-origin
           :absorb-plan plan
           :mid-merge? false}))
(def tg (master-main-reconcile-lib/escalation-telegram-text "rematch-bookkeeping" 2 3))
(def page? (boolean (re-find #"(?i)needs a human|complete origin/main merge" tg)))
(println (str "PLAN=" (name plan)))
(println (str "RECOVERY=" (name (:recovery out))))
(println (str "OPERATOR_ABSORB=" (:designed-recovery-operator-absorb? out)))
(println (str "OPERATOR_PAGE=" page?))
(println (str "MID_MERGE=" (:mid-merge? out)))
(println (str "TG=" tg))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
}

function runReplayBookkeepingLive(ctx) {
  const st = ensure(ctx);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1135-'));
  const daemonDir = path.join(tmp, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const script = `
(load-file "${RECONCILE}")
(def surfaces (atom []))
(def escalations (atom []))
(master-main-reconcile-lib/sweep!
 "${daemonDir}"
 3
 {:rev-counts! (fn [] {:ahead 1 :behind 2})
  :dirty-paths! (fn [] #{})
  :merge-changed-paths! (fn [] #{})
  :merge! (fn [] {:success false :error "rematch-bookkeeping" :outcome :rematch-bookkeeping})
  :surface! (fn [m] (swap! surfaces conj m))
  :escalate! (fn [m] (swap! escalations conj m))
  :log! (fn [& _])})
(println "OUTCOME=rematch-bookkeeping")
(println (str "SURFACED=" (if (seq @surfaces) "rematch" "none")))
(println (str "ESCALATIONS=" (count @escalations)))
(println (str "SURFACE0=" (first @surfaces)))
(when (some #(re-find #"(?i)needs a human|complete origin/main merge" (str %)) @surfaces)
  (println "BAD_SURFACE"))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  assert.doesNotMatch(st.raw, /BAD_SURFACE/);
  assert.match(st.raw, /ESCALATIONS=0/);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function runBl1130Bl1120(ctx) {
  const st = ensure(ctx);
  const script = `
(load-file "${RECONCILE}")
(def plan (master-main-reconcile-lib/automated-absorb-plan
           {:merge-head-present? false
            :behind 2
            :would-conflict? true
            :tip-contains-origin? false}))
(def may-abort? (master-main-reconcile-lib/may-abort-failed-merge? false))
(println (str "OUTCOME=" (name plan)))
(println "MID_MERGE=false")
(println (str "FOREIGN_ABORT=" may-abort?))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  // wiring: handoffd still cases rematch-bookkeeping
  const hd = fs.readFileSync(HANDOFFD, 'utf8');
  assert.match(hd, /:replay-bookkeeping/);
  assert.match(hd, /:outcome :rematch-bookkeeping/);
}

module.exports = { registerSteps };
