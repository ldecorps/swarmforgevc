'use strict';

// BL-1653: step handlers for "a commit abandoned at the subprocess bound
// never leaves its paths staged, and the reconcile names what blocks it".
// Drives the REAL swarmforge/scripts/commit_integrity_lib.bb and
// swarmforge/scripts/master_main_reconcile_lib.bb via `bb -e` against a
// real git fixture - never a reimplementation of either lib's decision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1653 A commit abandoned at the subprocess bound never leaves its paths staged, and the reconcile names what blocks it';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const COMMIT_INTEGRITY_LIB = path.join(SCRIPTS_DIR, 'commit_integrity_lib.bb');
const RECONCILE_LIB = path.join(SCRIPTS_DIR, 'master_main_reconcile_lib.bb');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function runBb(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

function lastJsonLine(out) {
  const line = out.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a git fixture root under a temporary directory with a main branch and a modified tracked file$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1653-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(root, 'tracked.txt'), 'v1\n');
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'seed');
      fs.writeFileSync(path.join(root, 'tracked.txt'), 'v2\n');
      ctx.root = root;
      ctx.headBefore = git(root, 'rev-parse', 'HEAD');
    },
  );

  scoped(/^the file is staged by the writer$/, () => {
    // No-op here: commit-with-integrity! itself stages (add-fn!) the
    // caller's already-written content as PART of its own call - staging
    // it a second time, ahead of that call, would make "as it found it"
    // (commit-with-integrity!'s own restore target) mean "already staged",
    // not the real pre-call state the invariant is about.
  });

  scoped(/^the writer's commit (is killed at the subprocess bound|is refused by a pre-commit guard|lands)$/, (ctx, outcome) => {
    const commitFn =
      outcome === 'is killed at the subprocess bound'
        ? '(fn [& _] {:exit 124 :out "" :err "daemon-cycle-guard: bounded-wait timeout after 60000ms: git -C . commit -m m -- tracked.txt"})'
        : outcome === 'is refused by a pre-commit guard'
          ? '(fn [& _] {:exit 1 :out "" :err "run_commit_guards.sh: refused"})'
          : null; // real commit-fn!, i.e. omit the override entirely
    const expr = `
(require '[cheshire.core :as json])
(load-file "${COMMIT_INTEGRITY_LIB}")
(def result (commit-integrity-lib/commit-with-integrity!
             (merge {:project-root "${ctx.root}" :paths ["tracked.txt"] :message "m"}
                    ${commitFn ? `{:commit-fn! ${commitFn}}` : '{}'})))
(println (json/generate-string result))`;
    ctx.result = lastJsonLine(runBb(expr));
    ctx.landed = outcome === 'lands';
  });

  scoped(/^the index matches HEAD afterwards$/, (ctx) => {
    const status = git(ctx.root, 'diff', '--cached', '--name-only');
    assert.equal(status, '', `expected an empty staged diff, got: ${status}`);
  });

  scoped(/^the worktree still carries the modification$/, (ctx) => {
    const content = fs.readFileSync(path.join(ctx.root, 'tracked.txt'), 'utf8');
    assert.equal(content, 'v2\n', `expected the worktree edit to survive, got: ${JSON.stringify(content)}`);
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.headBefore, 'HEAD must not have moved on a non-landed commit');
  });

  scoped(/^the writer's result names the restored path$/, (ctx) => {
    assert.ok(
      Array.isArray(ctx.result['index-restored']) && ctx.result['index-restored'].includes('tracked.txt'),
      `expected :index-restored to name tracked.txt, got: ${JSON.stringify(ctx.result)}`,
    );
    assert.equal(ctx.result.success, false, `expected a failed commit, got: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^HEAD carries the change$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.notEqual(head, ctx.headBefore, 'expected HEAD to move on a landed commit');
    const content = git(ctx.root, 'show', 'HEAD:tracked.txt');
    assert.equal(content, 'v2', `expected the landed content, got: ${content}`);
  });

  scoped(/^the writer's result names no restored path$/, (ctx) => {
    assert.ok(
      !('index-restored' in ctx.result),
      `expected no :index-restored on a landed commit, got: ${JSON.stringify(ctx.result)}`,
    );
    assert.equal(ctx.result.success, true, `expected a successful commit, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── scenarios 03-05: absorb-with-merge! against real git fixtures ───────

  scoped(/^the file is staged and origin's main is one commit ahead$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.root, 'origin.txt'), 'from origin\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'origin-only change');
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(ctx.root, 'reset', '-q', '--soft', 'HEAD~1');
    git(ctx.root, 'reset', '-q'); // unstage origin.txt's own removal-from-index too
    // Re-stage the ORIGINAL modification only - origin/main now carries a
    // commit local main does not, and tracked.txt is staged uncommitted.
    git(ctx.root, 'add', '--', 'tracked.txt');
    ctx.mode = 'staged';
  });

  function absorbExpr(root, extra) {
    return `
(require '[cheshire.core :as json])
(load-file "${RECONCILE_LIB}")
(def logs (atom []))
(def result
  (master-main-reconcile-lib/absorb-with-merge!
   (merge
    {:staged-paths! (fn [] (let [r (babashka.process/sh "git" "-C" "${root}" "diff" "--cached" "--name-only")]
                             (remove clojure.string/blank? (clojure.string/split-lines (:out r)))))
     :ff! (fn [] (let [r (babashka.process/sh "git" "-C" "${root}" "merge" "--ff-only" "--no-edit" "origin/main")]
                   {:success (zero? (:exit r))}))
     :merge! (fn [] (let [r (babashka.process/sh "git" "-C" "${root}" "merge" "--no-edit" "origin/main")]
                       {:success (zero? (:exit r)) :error (str (:out r) (:err r))
                        :conflict? (boolean (re-find #"CONFLICT|Automatic merge failed" (str (:out r) (:err r))))}))
     :abort! (fn [] (let [r (babashka.process/sh "git" "-C" "${root}" "merge" "--abort")]
                       {:success (zero? (:exit r)) :error (:err r)}))
     :fallback! (fn [] {:success false :outcome :fallback-ran})
     :log! (fn [label text] (swap! logs conj [label text]))}
    ${extra || '{}'})))
(println (json/generate-string {:result (assoc result :outcome (name (:outcome result))) :logs @logs}))`;
  }

  scoped(/^the master-main reconcile sweep runs once$/, (ctx) => {
    // Scenario 05's own shape: no real merge in progress at all - `merge!`
    // is forced to fail and `abort!` answers exactly the git message a
    // `git merge --abort` with no MERGE_HEAD gives, so this drives
    // absorb-with-merge!'s own no-merge-head path (unit-proven against the
    // exact `:abort-owned-merge` production branch in
    // master_main_reconcile_lib_test_runner.bb / handoffd.bb's wiring
    // test) - the acceptance layer's own proof that the SAME pure decision
    // clears ownership.
    const extra =
      ctx.mode === 'no-merge-head'
        ? `{:clear-owner! (fn [] (swap! clear-calls inc))
            :merge! (fn [] {:success false :error "conflict"})
            :abort! (fn [] {:success false :error "fatal: There is no merge to abort (MERGE_HEAD missing)."})}`
        : null;
    const expr =
      ctx.mode === 'no-merge-head'
        ? absorbExpr(ctx.root, extra).replace('(def logs (atom []))', '(def logs (atom [])) (def clear-calls (atom 0))')
            .replace('(println (json/generate-string {:result (assoc result :outcome (name (:outcome result))) :logs @logs}))',
                     '(println (json/generate-string {:result (assoc result :outcome (name (:outcome result))) :logs @logs :clearCalls @clear-calls}))')
        : absorbExpr(ctx.root);
    const out = runBb(expr);
    ctx.absorb = lastJsonLine(out);
  });

  scoped(/^no merge is attempted$/, (ctx) => {
    assert.equal(ctx.absorb.result.outcome, 'index-not-clean', `expected :index-not-clean, got: ${JSON.stringify(ctx.absorb)}`);
  });

  scoped(/^the log carries an index-not-clean line naming the file$/, (ctx) => {
    const line = ctx.absorb.logs.find((l) => l[0] === 'index-not-clean');
    assert.ok(line, `expected an index-not-clean log line, got: ${JSON.stringify(ctx.absorb.logs)}`);
    assert.ok(line[1].includes('tracked.txt'), `expected the log to name tracked.txt, got: ${line[1]}`);
  });

  scoped(/^the surfaced note names the file$/, (ctx) => {
    // The log line IS what surface-draft-lines composes from at the
    // coordinator's call site (item 2's own "How", BL-891's existing
    // surface-draft-lines convention) - already asserted above.
    const line = ctx.absorb.logs.find((l) => l[0] === 'index-not-clean');
    assert.ok(line[1].includes('tracked.txt'));
  });

  scoped(/^the index matches HEAD and origin's main conflicts with a local commit on the same lines$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.root, 'tracked.txt'), 'origin change\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'origin change');
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(ctx.root, 'reset', '-q', '--hard', 'HEAD~1');
    fs.writeFileSync(path.join(ctx.root, 'tracked.txt'), 'local change\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'local change');
    ctx.mode = 'conflict';
  });

  scoped(/^the log carries the conflict line as today$/, (ctx) => {
    const line = ctx.absorb.logs.find((l) => l[0] === 'conflict' || l[0] === 'merge-failed');
    assert.ok(line, `expected a conflict/merge-failed log line, got: ${JSON.stringify(ctx.absorb.logs)}`);
  });

  scoped(/^no index-not-clean line is logged$/, (ctx) => {
    assert.ok(
      !ctx.absorb.logs.some((l) => l[0] === 'index-not-clean'),
      `expected no index-not-clean line, got: ${JSON.stringify(ctx.absorb.logs)}`,
    );
  });

  // ── scenario 05: no-MERGE_HEAD abort releases ownership ─────────────────

  scoped(/^the sweep holds merge ownership for a sha and no merge is in progress$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.root, 'origin.txt'), 'from origin\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'origin change');
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(ctx.root, 'reset', '-q', '--hard', 'HEAD~1');
    fs.writeFileSync(path.join(ctx.root, 'tracked.txt'), 'local change\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'local change (no real merge in progress)');
    ctx.mode = 'no-merge-head';
  });

  scoped(/^the owner record is cleared$/, (ctx) => {
    const clearCalls = ctx.absorb.clearCalls;
    assert.equal(clearCalls, 1, `expected clear-owner! to run exactly once, got: ${JSON.stringify(ctx.absorb)}`);
  });

  scoped(/^the log carries no merge-abort-failed line$/, (ctx) => {
    assert.ok(
      !ctx.absorb.logs.some((l) => l[0] === 'merge-abort-failed'),
      `expected no generic merge-abort-failed line, got: ${JSON.stringify(ctx.absorb.logs)}`,
    );
    assert.ok(
      ctx.absorb.logs.some((l) => l[0] === 'merge-abort-no-merge-head'),
      `expected a merge-abort-no-merge-head line, got: ${JSON.stringify(ctx.absorb.logs)}`,
    );
  });

  scoped(/^the next run starts from the index check$/, (ctx) => {
    assert.equal(ctx.absorb.result.outcome, 'merge-abort-no-merge-head', JSON.stringify(ctx.absorb));
  });
}

module.exports = { registerSteps };
