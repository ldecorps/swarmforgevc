'use strict';

// BL-1130: automated land/absorb never leaves MERGE_HEAD for an editor.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Landing on main must not leave conflict resolution to an external human';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'post_hotfix_merge_origin_lib.bb');
const RECONCILE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1130) {
    ctx.bl1130 = {
      tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1130-')),
      mode: 'conflict',
      behind: 2,
      raw: '',
    };
    fs.mkdirSync(path.join(ctx.bl1130.tmp, 'daemon'), { recursive: true });
  }
  return ctx.bl1130;
}

function cleanup(ctx) {
  if (ctx.bl1130?.tmp) fs.rmSync(ctx.bl1130.tmp, { recursive: true, force: true });
  ctx.bl1130 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a master checkout that runs BL-891-style origin\/main absorb$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^local main is ahead of origin\/main$/, (ctx) => {
    ensure(ctx).behind = 2;
    ensure(ctx).mode = 'conflict';
  });

  scoped(/^absorbing origin\/main would conflict on a landing ticket path$/, (ctx) => {
    ensure(ctx).mode = 'conflict';
  });

  scoped(/^a ticket land prepared under the BL-1130 rule$/, (ctx) => {
    const st = ensure(ctx);
    st.mode = 'prepared';
    st.behind = 0;
  });

  scoped(/^the automated absorb path runs$/, (ctx) => {
    runAbsorb(ctx);
  });

  scoped(/^origin\/main is absorbed into local main by the automated path$/, (ctx) => {
    runAbsorb(ctx);
  });

  scoped(/^the worktree has no MERGE_HEAD$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /:mid-merge\? false|CLEAN_MERGE_HEAD=yes/);
    assert.match(raw, /POST_ABSORB_CLEAN=true/);
    assert.match(raw, /DIRTY_CLEAN_PROBE=false/);
  });

  scoped(/^there are no unmerged paths$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /UNMERGED=0|CLEAN_UNMERGED=yes/);
    assert.match(raw, /POST_ABSORB_CLEAN=true/);
  });

  scoped(/^the outcome names rematch or refuse \(not finish-this-merge-in-an-editor\)$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /refuse-rematch|rematch/);
    assert.match(raw, /NAMES_REMATCH=true/);
    assert.match(raw, /EDITOR_PHRASE_REJECTED=true/);
    assert.doesNotMatch(raw, /finish this merge in an editor/i);
    cleanup(ctx);
  });

  scoped(/^behind is 0$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /:behind 0|BEHIND=0/);
  });

  scoped(/^no human conflict-resolution step was required$/, (ctx) => {
    const raw = ensure(ctx).raw;
    assert.match(raw, /:ok\? true|:outcome :noop|:outcome :merged/);
    assert.doesNotMatch(raw, /finish this merge in an editor/i);
    cleanup(ctx);
  });
}

function runAbsorb(ctx) {
  const st = ensure(ctx);
  const conflict = st.mode === 'conflict';
  const script = `
(require '[babashka.fs :as fs])
(load-file "${LIB}")
(load-file "${RECONCILE}")
(def behind-atom (atom ${st.behind}))
(def mid? (atom false))
(def daemon "${st.tmp}/daemon")
(fs/create-dirs daemon)
(def result
  (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
   {:daemon-dir daemon
    :fetch! (fn [] nil)
    :rev-counts! (fn [] {:ahead 1 :behind @behind-atom})
    :dirty-paths! (fn [] [])
    :merge-verdict! (fn [] ${conflict ? ':conflict' : ':clean'})
    :tip-contains-origin! (fn [] ${conflict ? 'false' : 'true'})
    :merge! (fn []
              (if ${conflict ? 'true' : 'false'}
                (do (reset! mid? true)
                    {:success false :conflicted-paths ["landing/ticket.yaml"]})
                (do (reset! behind-atom 0) {:success true})))
    :abort! (fn [] (reset! mid? false))
    :status-porcelain! (fn [] (if @mid? "UU landing/ticket.yaml\\n" ""))
    :mid-merge? (fn [] @mid?)}))
(def unmerged (count (or (:conflicted-paths result) [])))
(def clean? (master-main-reconcile-lib/post-absorb-clean? (:mid-merge? result) unmerged))
(def names-ok?
  (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse?
   (str (:outcome result))))
(def editor-ok?
  (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse?
   "finish this merge in an editor"))
(println (pr-str result))
(println (str "BEHIND=" (:behind result)))
(println (str "UNMERGED=" unmerged))
(println (str "CLEAN_MERGE_HEAD=" (if (:mid-merge? result) "no" "yes")))
(println (str "CLEAN_UNMERGED=" (if clean? "yes" "no")))
(println (str "POST_ABSORB_CLEAN=" clean?))
(println (str "DIRTY_CLEAN_PROBE="
              (master-main-reconcile-lib/post-absorb-clean? true 1)))
(println (str "NAMES_REMATCH=" names-ok?))
(println (str "EDITOR_PHRASE_REJECTED=" (not editor-ok?)))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
}

module.exports = { registerSteps };
