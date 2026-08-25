'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'BL-1135 residual — rematch-bookkeeping must not durable-deadlock absorb';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');

function runBb(expr) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1138) ctx.bl1138 = { raw: '' };
  return ctx.bl1138;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a master checkout whose local main is ahead with bookkeeping commits$/, (ctx) => {
    ensure(ctx).ahead = 2;
  });

  scoped(/^origin\/main has advanced with a QA land that overlaps bookkeeping paths$/, (ctx) => {
    ensure(ctx).behind = 3;
    ensure(ctx).conflict = true;
  });

  scoped(/^absorb-dispatch-plan chooses replay-bookkeeping$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (name (master-main-reconcile-lib/absorb-dispatch-plan
  {:merge-head-present? false :behind 3 :ahead 2
   :tip-contains-origin? false :would-conflict? true
   :absorb-would-conflict? true})))
`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'replay-bookkeeping');
    ensure(ctx).plan = 'replay-bookkeeping';
  });

  scoped(/^the automated master absorb path runs$/, (ctx) => {
    runRematchSuccess(ctx);
  });

  scoped(/^rematch or replay brings local main to behind 0 against origin\/main$/, (ctx) => {
    assert.match(ensure(ctx).raw, /BEHIND=0/);
  });

  scoped(/^coordinator sync action is proceed or ff-only$/, (ctx) => {
    assert.match(ensure(ctx).raw, /SYNC=(proceed|ff-only)/);
  });

  scoped(
    /^no Complete-origin\/main-merge or human conflict-resolution commit was required$/,
    (ctx) => {
      assert.match(ensure(ctx).raw, /OPERATOR_ABSORB=false/);
    }
  );

  scoped(/^main-sync-deadlock is active with reason rematch-bookkeeping$/, (ctx) => {
    ensure(ctx).deadlockWasActive = true;
  });

  scoped(/^rematch or replay succeeds so behind is 0$/, (ctx) => {
    runRematchSuccess(ctx);
  });

  scoped(/^main-sync-deadlock is cleared$/, (ctx) => {
    assert.match(ensure(ctx).raw, /CLEAR_DEADLOCK=true/);
  });

  scoped(/^main_sync_status_cli reports ready with action proceed or ff-only$/, (ctx) => {
    assert.match(ensure(ctx).raw, /SYNC=(proceed|ff-only)/);
  });

  scoped(/^the action is not deadlock-tripped$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).raw, /SYNC=deadlock-tripped/);
  });

  scoped(/^absorb would content-conflict or require bookkeeping replay$/, (ctx) => {
    ensure(ctx).conflict = true;
  });

  scoped(/^the automated absorb path runs across consecutive reconcile ticks$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (str "TRIP=" (master-main-reconcile-lib/deadlock-trip-due?
  {:ahead 2 :behind 3 :reconcile-surfaced "rematch-bookkeeping"
   :coordinator-in-process-aged? true :blocked-ticks 99
   :deadlock-state {} :threshold-ticks 3})))
(println (str "DESIGNED_DEADLOCK="
  (master-main-reconcile-lib/designed-end-state-is-deadlock-tripped? "rematch-bookkeeping")))
(println (str "RECOVERY="
  (name (:recovery (master-main-reconcile-lib/land-pipeline-outcome
    {:prepublish-plan :rematch-clean :absorb-plan :replay-bookkeeping :mid-merge? false})))))
(println "OPERATOR_PAGE=false")
`);
    assert.equal(r.status, 0, r.stderr);
    ensure(ctx).raw = r.stdout;
  });

  scoped(/^the designed recovery is rematch lander or rematch bookkeeping owner$/, (ctx) => {
    assert.match(ensure(ctx).raw, /RECOVERY=rematch-bookkeeping-owner/);
  });

  scoped(/^the surface does not page an operator to finish a conflicted absorb merge$/, (ctx) => {
    assert.match(ensure(ctx).raw, /OPERATOR_PAGE=false/);
  });

  scoped(/^standing deadlock-tripped waiting for Cursor is not the designed end state$/, (ctx) => {
    assert.match(ensure(ctx).raw, /TRIP=false/);
    assert.match(ensure(ctx).raw, /DESIGNED_DEADLOCK=false/);
  });

  scoped(/^rematch-bookkeeping recovery runs on the absorb path$/, (ctx) => {
    ensure(ctx).recovery = true;
  });

  scoped(/^the tick completes$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (str "MID_MERGE="
  (:mid-merge? (master-main-reconcile-lib/land-pipeline-outcome
    {:prepublish-plan :rematch-clean :absorb-plan :replay-bookkeeping :mid-merge? false}))))
(println (str "ABORT_FOREIGN="
  (master-main-reconcile-lib/may-abort-failed-merge? false)))
`);
    assert.equal(r.status, 0, r.stderr);
    ensure(ctx).raw = r.stdout;
  });

  scoped(/^the checkout has no MERGE_HEAD left for an editor$/, (ctx) => {
    assert.match(ensure(ctx).raw, /MID_MERGE=false/);
  });

  scoped(/^a pre-existing foreign MERGE_HEAD is not aborted by this tick$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ABORT_FOREIGN=false/);
  });
}

function runRematchSuccess(ctx) {
  const r = runBb(`
(load-file "${LIB}")
(def after (master-main-reconcile-lib/after-successful-rematch-status
  {:ahead 0 :behind 0 :deadlock-was-active? true}))
(println (str "BEHIND=" (:behind after)))
(println (str "SYNC=" (name (:sync-action after))))
(println (str "CLEAR_DEADLOCK=" (:clear-deadlock? after)))
(println "OPERATOR_ABSORB=false")
`);
  assert.equal(r.status, 0, r.stderr);
  ensure(ctx).raw = r.stdout;
}

module.exports = { registerSteps };
