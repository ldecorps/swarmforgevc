'use strict';

// BL-1120: handoffd must not abort a foreign master-main merge.
// Drives REAL master_main_reconcile_lib via a fixture that records merge/abort calls.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1120 handoffd must not abort a foreign master-main merge';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');

function ensure(ctx) {
  if (!ctx.bl1120) {
    ctx.bl1120 = {
      tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1120-')),
      log: [],
      mergeHead: false,
      midMergeAfter: null,
      outcome: null,
    };
    fs.mkdirSync(path.join(ctx.bl1120.tmp, 'daemon'), { recursive: true });
  }
  return ctx.bl1120;
}

function cleanup(ctx) {
  if (ctx.bl1120?.tmp) fs.rmSync(ctx.bl1120.tmp, { recursive: true, force: true });
  ctx.bl1120 = null;
}

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the master checkout already has MERGE_HEAD from a human merge in progress$/, (ctx) => {
    ensure(ctx).mergeHead = true;
  });

  scoped(/^the master checkout is clean with no MERGE_HEAD$/, (ctx) => {
    ensure(ctx).mergeHead = false;
  });

  scoped(/^merging origin\/main would conflict$/, (ctx) => {
    ensure(ctx).wouldConflict = true;
  });

  scoped(/^master-main-reconcile-merge runs$/, (ctx) => {
    const st = ensure(ctx);
    const script = `
(load-file "${LIB}")
(def log (atom []))
(def merge-head-already ${st.mergeHead ? 'true' : 'false'})
(def would-conflict ${st.wouldConflict ? 'true' : 'false'})
(defn merge! []
  (let [plan (master-main-reconcile-lib/merge-attempt-plan merge-head-already)]
    (swap! log conj (str "plan=" (name plan)))
    (if (= plan :skip-human-merge-in-progress)
      (do (println "OUTCOME=human-merge-in-progress")
          (println "ABORT=no")
          {:success false :error "human-merge-in-progress" :outcome :human-merge-in-progress})
      (do
        (println "MERGE=started")
        (if would-conflict
          (do
            (when (master-main-reconcile-lib/may-abort-failed-merge? true)
              (println "ABORT=yes"))
            (println "OUTCOME=conflict")
            {:success false :error "conflict" :outcome :conflict})
          (do (println "OUTCOME=ok") {:success true}))))))
(merge!)
`;
    const r = runBb(script);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^it does not run git merge --abort$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /ABORT=no/);
    assert.doesNotMatch(st.raw, /ABORT=yes/);
  });

  scoped(/^the checkout remains mid-merge$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /OUTCOME=human-merge-in-progress/);
  });

  scoped(/^the outcome names human-merge-in-progress$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /human-merge-in-progress/);
    cleanup(ctx);
  });

  scoped(/^it may abort the merge it started$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /ABORT=yes/);
  });

  scoped(/^the worktree is left not mid-merge$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /ABORT=yes/);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
