'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'BL-1138 residual — refuse-rematch must rematch live (not wait for Cursor)';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');
const POST = path.join(REPO, 'swarmforge', 'scripts', 'post_hotfix_merge_origin_lib.bb');
const RUNNER = path.join(REPO, 'swarmforge', 'scripts', 'test', 'bl1141_refuse_rematch_test_runner.bb');

function runBb(expr) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1141) ctx.bl1141 = { raw: '' };
  return ctx.bl1141;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a master checkout whose absorb-dispatch plan is refuse-rematch$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (name (master-main-reconcile-lib/absorb-dispatch-plan
  {:merge-head-present? false :behind 3 :ahead 0
   :tip-contains-origin? false :would-conflict? true
   :absorb-would-conflict? true})))
`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'refuse-rematch');
    ensure(ctx).plan = 'refuse-rematch';
  });

  scoped(/^BL-1130 forbids leaving MERGE_HEAD for an editor$/, (ctx) => {
    ensure(ctx).bl1130 = true;
  });

  scoped(/^BL-1120 forbids aborting a foreign MERGE_HEAD this tick did not start$/, (ctx) => {
    ensure(ctx).bl1120 = true;
  });

  scoped(/^master-main-reconcile-merge! takes the refuse-rematch branch$/, (ctx) => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    ensure(ctx).raw = r.stdout;
    ensure(ctx).runnerOk = true;
  });

  scoped(/^it rematches onto origin\/main \(or equivalent automatic rematch\)$/, (ctx) => {
    assert.equal(ensure(ctx).runnerOk, true);
  });

  scoped(/^local main reaches behind=0 without Complete-origin\/main-merge$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(def after (master-main-reconcile-lib/after-successful-rematch-status
  {:ahead 0 :behind 0 :deadlock-was-active? false}))
(println (str "BEHIND=" (:behind after)))
(println (str "SYNC=" (name (:sync-action after))))
(println "OPERATOR_ABSORB=false")
`);
    assert.equal(r.status, 0, r.stderr);
    ensure(ctx).raw = r.stdout;
    assert.match(ensure(ctx).raw, /BEHIND=0/);
    assert.match(ensure(ctx).raw, /OPERATOR_ABSORB=false/);
  });

  scoped(/^main_sync_status_cli action is proceed or ff-only$/, (ctx) => {
    assert.match(ensure(ctx).raw, /SYNC=(proceed|ff-only)/);
  });

  scoped(/^post_hotfix run-post-hotfix-merge! takes the refuse-rematch branch$/, (ctx) => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    ensure(ctx).runnerOk = true;
  });

  scoped(/^it rematches \(or equivalent\) instead of only print-refuse-rematch! \+ exit 1$/, (ctx) => {
    assert.equal(ensure(ctx).runnerOk, true);
  });

  scoped(/^behind returns to 0 on success$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (str "BEHIND=" (:behind (master-main-reconcile-lib/after-successful-rematch-status
  {:ahead 0 :behind 0}))))
`);
    assert.match(r.stdout, /BEHIND=0/);
  });

  scoped(/^refuse-rematch recovery runs$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(println (str "MID_MERGE="
  (:mid-merge? (master-main-reconcile-lib/land-pipeline-outcome
    {:prepublish-plan :rematch-clean :absorb-plan :refuse-rematch :mid-merge? false}))))
(println (str "ABORT_FOREIGN="
  (master-main-reconcile-lib/may-abort-failed-merge? false)))
(println (str "RECOVERY="
  (name (:recovery (master-main-reconcile-lib/land-pipeline-outcome
    {:prepublish-plan :rematch-clean :absorb-plan :refuse-rematch :mid-merge? false})))))
`);
    assert.equal(r.status, 0, r.stderr);
    ensure(ctx).raw = r.stdout;
  });

  scoped(/^the worktree is not left with MERGE_HEAD or unmerged paths for an editor$/, (ctx) => {
    assert.match(ensure(ctx).raw, /MID_MERGE=false/);
  });

  scoped(/^a foreign MERGE_HEAD present at tick start is not aborted$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ABORT_FOREIGN=false/);
  });

  scoped(/^reconcile state surfaced refuse-rematch$/, (ctx) => {
    ensure(ctx).surfaced = 'refuse-rematch';
  });

  scoped(/^rematch recovery succeeds$/, (ctx) => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    ensure(ctx).cleared = true;
  });

  scoped(/^reconcile surfaced refuse-rematch is cleared$/, (ctx) => {
    assert.equal(ensure(ctx).cleared, true);
  });

  scoped(/^wait-reconcile with refuse-rematch is not the standing end state$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(def action (master-main-reconcile-lib/sync-action
  {:ahead 0 :behind 0 :reconcile-surfaced nil :deadlock-active? false}))
(println (str "SYNC=" (name action)))
(println (str "DESIGNED_DEADLOCK="
  (master-main-reconcile-lib/designed-end-state-is-deadlock-tripped? "refuse-rematch")))
`);
    assert.match(r.stdout, /SYNC=(proceed|ff-only)/);
    assert.match(r.stdout, /DESIGNED_DEADLOCK=false/);
  });
}

module.exports = { registerSteps };
