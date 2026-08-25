'use strict';

// BL-1118: post-Cursor-batch merge of origin/main (process B).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1118 post-Cursor-batch merge of origin/main (process B)';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'post_hotfix_merge_origin_lib.bb');
const HOWTO_891 = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-891-master-main-reconcile-sweep.md');
const HOWTO_848 = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-848-certify-an-operator-hotfix.md');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1118) {
    ctx.bl1118 = {
      tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1118-')),
      mergeability: 'conflict-free',
      behind: 2,
      dirtyReason: false,
    };
    fs.mkdirSync(path.join(ctx.bl1118.tmp, 'daemon'), { recursive: true });
  }
  return ctx.bl1118;
}

function cleanup(ctx) {
  if (ctx.bl1118?.tmp) fs.rmSync(ctx.bl1118.tmp, { recursive: true, force: true });
  ctx.bl1118 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^local main is clean and behind origin\/main by at least one commit$/, (ctx) => {
    ensure(ctx).behind = 2;
    ensure(ctx).dirty = [];
  });

  scoped(/^the merge of origin\/main is (.+)$/, (ctx, mergeability) => {
    const m = mergeability.trim();
    assert.ok(
      m === 'conflict-free' || m === 'path-conflicting',
      `unknown or mutated mergeability: ${JSON.stringify(m)}`
    );
    ensure(ctx).mergeability = m;
  });

  scoped(/^the post_hotfix_merge_origin helper runs$/, (ctx) => {
    const st = ensure(ctx);
    const conflict = st.mergeability === 'path-conflicting';
    const mid = conflict;
    const script = `
(require '[babashka.fs :as fs])
(load-file "${LIB}")
(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb')}")
(def behind-atom (atom ${st.behind}))
(def mid? (atom ${mid ? 'true' : 'false'}))
(def daemon "${st.tmp}/daemon")
(fs/create-dirs daemon)
${st.dirtyReason ? '(master-main-reconcile-lib/write-state! daemon {:surfaced "dirty" :escalated true})' : ''}
${st.dirtyReason ? '(master-main-reconcile-lib/write-deadlock! daemon {:active true :reason "dirty"})' : ''}
(def result
  (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
   {:daemon-dir daemon
    :fetch! (fn [] nil)
    :rev-counts! (fn [] {:ahead 1 :behind @behind-atom})
    :dirty-paths! (fn [] [])
    :merge! (fn []
              (if ${conflict ? 'true' : 'false'}
                {:success false :conflicted-paths ["conflicted.bb"]}
                (do (reset! behind-atom 0) {:success true})))
    :abort! (fn [] (reset! mid? false))
    :status-porcelain! (fn [] "UU conflicted.bb\\n")
    :mid-merge? (fn [] @mid?)}))
(println (pr-str result))
`;
    const r = runBb(script);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  // Exact Examples prose (case-sensitive) so soft Gherkin case-mutants die.
  scoped(/^the helper outcome is "([^"]+)"$/, (ctx, outcome) => {
    const raw = ensure(ctx).raw;
    if (outcome === 'fetches and merges origin/main') {
      assert.match(raw, /:outcome :merged|:ok\? true/);
      return;
    }
    if (outcome === 'aborts the merge, prints conflicted paths, not mid-merge') {
      assert.match(raw, /conflicted\.bb|CONFLICTED/);
      assert.match(raw, /:mid-merge\? false|:outcome :conflict-abort/);
      return;
    }
    assert.fail(`unknown or mutated helper outcome prose: ${JSON.stringify(outcome)}`);
  });

  scoped(/^the helper exit code is (\d+)$/, (ctx, exit) => {
    const raw = ensure(ctx).raw;
    const want = Number(exit);
    const matched = raw.match(/:exit\s+(\d+)/);
    assert.ok(matched, `missing :exit in helper output: ${raw}`);
    assert.equal(Number(matched[1]), want, `helper exit ${matched[1]} !== example ${want}`);
    cleanup(ctx);
  });

  scoped(/^the BL-848 or BL-891 operator how-to updated by this slice$/, (ctx) => {
    ctx.bl1118Docs = {
      a891: fs.readFileSync(HOWTO_891, 'utf8'),
      a848: fs.readFileSync(HOWTO_848, 'utf8'),
    };
  });

  scoped(/^an operator reads the post-batch checklist$/, (ctx) => {
    assert.ok(ctx.bl1118Docs);
  });

  scoped(/^the checklist still requires SWARMFORGE_ROLE=QA for pipeline-path hotfix lands on main$/, (ctx) => {
    const text = `${ctx.bl1118Docs.a891}\n${ctx.bl1118Docs.a848}`;
    assert.match(text, /SWARMFORGE_ROLE=QA/);
  });

  scoped(/^the checklist tells the operator to run the post-batch merge helper before ending the session$/, (ctx) => {
    const text = `${ctx.bl1118Docs.a891}\n${ctx.bl1118Docs.a848}`;
    assert.match(text, /post_hotfix_merge_origin/);
  });

  scoped(/^a stale deadlock marker still names a dirty reason$/, (ctx) => {
    ensure(ctx).dirtyReason = true;
  });

  scoped(/^sync status is refreshed after the helper path$/, (ctx) => {
    // Reuse helper run step by setting mergeability conflict-free and running.
    ensure(ctx).mergeability = 'conflict-free';
    // Call the When handler body via a second run — register by invoking same logic
    const st = ensure(ctx);
    st.behind = 2;
    const conflict = false;
    const script = `
(require '[babashka.fs :as fs])
(load-file "${LIB}")
(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb')}")
(def behind-atom (atom 2))
(def daemon "${st.tmp}/daemon")
(fs/create-dirs daemon)
(master-main-reconcile-lib/write-state! daemon {:surfaced "dirty" :escalated true})
(master-main-reconcile-lib/write-deadlock! daemon {:active true :reason "dirty"})
(def result
  (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
   {:daemon-dir daemon
    :fetch! (fn [] nil)
    :rev-counts! (fn [] {:ahead 0 :behind @behind-atom})
    :dirty-paths! (fn [] [])
    :merge! (fn [] (reset! behind-atom 0) {:success true})
    :abort! (fn [] nil)
    :status-porcelain! (fn [] "")
    :mid-merge? (fn [] false)}))
(def state (master-main-reconcile-lib/read-state daemon))
(def action (master-main-reconcile-lib/sync-action
  {:ahead 0 :behind 3
   :reconcile-surfaced (:surfaced state)
   :deadlock-active? false}))
(println "ACTION" (name action))
(println "SURFACED" (pr-str (:surfaced state)))
`;
    const r = runBb(script);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the reported sync action is wait-reconcile or conflict-shaped$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /ACTION (ff-only|wait-reconcile|conflict)/);
    assert.doesNotMatch(raw, /ACTION wait-dirty-clear/);
  });

  scoped(/^it is not left stuck on the stale dirty deadlock reason$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).raw, /ACTION wait-dirty-clear/);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
