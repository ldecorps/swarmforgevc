'use strict';

// BL-1297: step handlers for "a merge commit's own changed paths are
// computed, not silently empty".
//
// Every scenario builds a REAL git repository and drives the REAL bb
// libraries through their own public seams - task_scope_gate_lib.bb's
// own-commit-changed-paths and findings-for-git-handoff, and
// land_step_lib.bb's land-plan. Nothing here re-implements the walk under
// test, and no scenario compares the answer against another `git diff-tree`
// invocation except scenario 04, where reproducing the PREVIOUS invocation
// byte for byte is precisely what is being asserted.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_scope_gate_lib.bb');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const FEATURE = "A merge commit's own changed paths are computed, not silently empty";

// The live shape: a role receives a parcel with `git merge`, and that merge
// is the only commit whose subject names the task.
const TASK = 'BL-1174-fixture';
const TASK_ID = 'BL-1174';
const OTHER = 'BL-9999-other';
const PARCEL_PATH = 'extension/src/parcel.ts';
const TRUNK_PATH = 'extension/src/trunk.ts';
const FOREIGN_PATH = 'backlog/active/BL-1185-x.yaml';
const FOREIGN_ID = 'BL-1185';
const MERGE_SUBJECT = `${TASK}: merge the parcel in`;

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
}

function commitFile(root, filePath, subject) {
  const full = path.join(root, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, `${subject}\n`);
  git(root, 'add', filePath);
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', subject);
  return git(root, 'rev-parse', 'HEAD').trim();
}

function bb(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
  return result.stdout.trim();
}

function initRepo(ctx) {
  ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1297-aps-'));
  git(ctx.root, 'init', '-q', '-b', 'main');
  git(ctx.root, 'config', 'user.email', 'test@test');
  git(ctx.root, 'config', 'user.name', 'test');
  git(ctx.root, 'config', 'commit.gpgsign', 'false');
  commitFile(ctx.root, 'seed.txt', 'seed');
  ctx.base = git(ctx.root, 'rev-parse', 'HEAD').trim();
  git(ctx.root, 'update-ref', 'refs/remotes/origin/main', ctx.base);
}

// A merge carrying `branchPath` in, with `TRUNK_PATH` already on the first
// parent under another ticket's subject. The merge is the ONLY commit whose
// subject names the task, which is the live pipeline shape.
function mergeParcelIn(ctx, branchPath) {
  git(ctx.root, 'checkout', '-q', '-b', 'bl1297-branch');
  commitFile(ctx.root, branchPath, `${OTHER}: ${branchPath} arriving through the merge`);
  git(ctx.root, 'checkout', '-q', 'main');
  commitFile(ctx.root, TRUNK_PATH, `${OTHER}: ${TRUNK_PATH} already on the receiving branch`);
  git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '--no-verify', '-m', MERGE_SUBJECT, 'bl1297-branch');
  ctx.commit = git(ctx.root, 'rev-parse', 'HEAD').trim();

  // The premise, asserted rather than assumed. If git ever started printing a
  // merge's diff for the OLD invocation, these scenarios would be testing a
  // defect that no longer exists and would pass for the wrong reason.
  const old = git(ctx.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--first-parent', ctx.commit).trim();
  assert.equal(old, '', `the old invocation no longer suppresses a merge's diff: ${old}`);
  return ctx.commit;
}

// A merge whose OWN resolution writes `resolvedPath` - content on neither
// parent, so --cc names it and the merger is answerable for it. `branchPath`
// merely rides in through the merge and must not be charged to the merger.
function evilMergeParcelIn(ctx, branchPath, resolvedPath) {
  git(ctx.root, 'checkout', '-q', '-b', 'bl1297-evil-branch');
  commitFile(ctx.root, branchPath, `${OTHER}: ${branchPath} arriving through the merge`);
  git(ctx.root, 'checkout', '-q', 'main');
  commitFile(ctx.root, TRUNK_PATH, `${OTHER}: ${TRUNK_PATH} already on the receiving branch`);
  git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '--no-verify', '--no-commit', 'bl1297-evil-branch');
  const full = path.join(ctx.root, resolvedPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'resolved in the merge itself\n');
  git(ctx.root, 'add', '-A');
  git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', MERGE_SUBJECT);
  ctx.commit = git(ctx.root, 'rev-parse', 'HEAD').trim();
  return ctx.commit;
}

function ownPaths(root, commit, semantic = ':delivered') {
  const out = bb(`
(load-file ${JSON.stringify(GATE_LIB)})
(let [r (task-scope-gate-lib/own-commit-changed-paths ${JSON.stringify(root)} ${JSON.stringify(commit)} ${semantic})]
  (print (if (nil? r) "NIL" (clojure.string/join "\\n" r))))`);
  return out === 'NIL' ? null : out.split('\n').filter(Boolean);
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a walk that attributes a commit to the task being checked$/, (ctx) => {
    initRepo(ctx);
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(
    /^the attributed commit is a merge that changed at least one path against its first parent$/,
    (ctx) => {
      mergeParcelIn(ctx, PARCEL_PATH);
    }
  );

  // ── Scenarios 01 / 04 shared ──────────────────────────────────────────────
  scoped(/^the commit's delivered paths are computed$/, (ctx) => {
    ctx.paths = ownPaths(ctx.root, ctx.commit, ':delivered');
  });

  scoped(/^those paths are reported$/, (ctx) => {
    assert.deepEqual(ctx.paths, [PARCEL_PATH], `the merge's first-parent change was misreported: ${JSON.stringify(ctx.paths)}`);
    // Stated as a pair: a per-parent union (-m) would ALSO name the receiving
    // branch's own file, attributing the merging role's prior work to this
    // parcel. That is a different question, and a stricter gate than asked for.
    assert.ok(
      !ctx.paths.includes(TRUNK_PATH),
      `the first parent's own path was attributed to the merge: ${JSON.stringify(ctx.paths)}`
    );
  });

  scoped(/^the result is not empty$/, (ctx) => {
    assert.ok(ctx.paths && ctx.paths.length > 0, `the merge reported an empty change set: ${JSON.stringify(ctx.paths)}`);
    cleanup(ctx);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(
    /^the attributed commit is a merge whose own resolution touches a path belonging to another ticket$/,
    (ctx) => {
      evilMergeParcelIn(ctx, PARCEL_PATH, FOREIGN_PATH);
      // The premise, asserted rather than assumed: the resolved path really
      // is the merge's own authorship and the ridden-in path really is not.
      // Without this the refusal below could be true for the wrong reason.
      assert.deepEqual(
        ownPaths(ctx.root, ctx.commit, ':authored'),
        [FOREIGN_PATH],
        'the fixture did not build a merge that authors the foreign path'
      );
    }
  );

  scoped(/^the gate decides whether the handoff may be sent$/, (ctx) => {
    const out = bb(`
(load-file ${JSON.stringify(GATE_LIB)})
(let [result (task-scope-gate-lib/findings-for-git-handoff
              {:root ${JSON.stringify(ctx.root)} :task-name ${JSON.stringify(TASK)} :commit ${JSON.stringify(ctx.commit)}})]
  (print (pr-str {:blocked (task-scope-gate-lib/blocked? result)
                  :warning (:warning result)
                  :message (task-scope-gate-lib/refusal-message
                            {:task-name ${JSON.stringify(TASK)} :findings (:findings result)})})))`);
    ctx.verdict = out;
    ctx.blocked = out.includes(':blocked true');
  });

  scoped(/^the handoff is refused$/, (ctx) => {
    assert.equal(ctx.blocked, true, `the handoff was allowed - the gate never inspected the merge: ${ctx.verdict}`);
  });

  scoped(/^the refusal names the foreign path$/, (ctx) => {
    assert.ok(ctx.verdict.includes(FOREIGN_PATH), `the refusal did not name the foreign path: ${ctx.verdict}`);
    assert.ok(ctx.verdict.includes(FOREIGN_ID), `the refusal did not name the foreign ticket: ${ctx.verdict}`);
    cleanup(ctx);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^the only commit attributed to the task in the walk is a merge$/, (ctx) => {
    mergeParcelIn(ctx, PARCEL_PATH);
    // Asserted, not assumed: an empty answer downstream could then only come
    // from the merge blind spot, never from the walk finding nothing tagged.
    const tagged = git(ctx.root, 'rev-list', '--first-parent', `${ctx.base}..${ctx.commit}`)
      .split('\n')
      .filter(Boolean)
      .filter((sha) => git(ctx.root, 'log', '-1', '--format=%s', sha).includes(TASK));
    assert.deepEqual(tagged, [ctx.commit], `the walk contains other task-tagged commits: ${tagged}`);
    // The land step only reaches its replay when the tip is entangled, so the
    // fixture carries a sibling ticket's unlanded commit - the ordinary
    // pipelining shape BL-1241 was written for.
    git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'BL-1185: a sibling ticket, unlanded');
    ctx.commit = git(ctx.root, 'rev-parse', 'HEAD').trim();
  });

  scoped(/^the land step computes what to replay$/, (ctx) => {
    ctx.plan = bb(`
(load-file ${JSON.stringify(LAND_LIB)})
(print (pr-str (land-step-lib/land-plan {:root ${JSON.stringify(ctx.root)}
                                         :commit ${JSON.stringify(ctx.commit)}
                                         :task-ticket-id ${JSON.stringify(TASK_ID)}})))`);
  });

  scoped(/^it does not report that there is nothing to commit$/, (ctx) => {
    assert.ok(ctx.plan.includes(':action :replay'), `the land step did not reach its replay: ${ctx.plan}`);
    // ":own-paths []" is the exact input that makes replay! report "nothing to
    // commit - own-paths identical to origin/main". The parcel's own content
    // must be in there.
    assert.ok(!ctx.plan.includes(':own-paths []'), `the replay was handed no content: ${ctx.plan}`);
    assert.ok(ctx.plan.includes(PARCEL_PATH), `the replay does not carry the parcel's own path: ${ctx.plan}`);
    cleanup(ctx);
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────────
  scoped(/^the attributed commit is an ordinary single-parent commit$/, (ctx) => {
    ctx.commit = commitFile(ctx.root, PARCEL_PATH, `${TASK}: an ordinary commit`);
    ctx.before = git(ctx.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--first-parent', ctx.commit)
      .split('\n')
      .filter(Boolean);
    // The regression this scenario guards only has teeth if the previous
    // invocation reported something here.
    assert.ok(ctx.before.length > 0, 'the previous invocation reported nothing for a single-parent commit');
  });

  scoped(/^the paths reported are the same as before this change$/, (ctx) => {
    assert.deepEqual(ctx.paths, ctx.before, `a single-parent commit's answer changed: ${JSON.stringify(ctx.paths)} vs ${JSON.stringify(ctx.before)}`);
    cleanup(ctx);
  });

  // ── Scenario 05 ───────────────────────────────────────────────────────────
  // The regression the first version of this contract caused: every stage
  // receives its handoff by merge and syncs main routinely, so an ordinary
  // receive-merge DELIVERS every ticket landed since the branch last synced.
  scoped(
    /^the attributed commit is a clean receive-merge whose delivered paths belong to other tickets$/,
    (ctx) => {
      mergeParcelIn(ctx, FOREIGN_PATH);
      // If the foreign path were not actually delivered here, "not refused"
      // would be true for a reason that proves nothing.
      assert.ok(
        ownPaths(ctx.root, ctx.commit, ':delivered').includes(FOREIGN_PATH),
        'the fixture did not deliver the foreign path through the merge'
      );
    }
  );

  scoped(/^the merge resolved no path itself$/, (ctx) => {
    assert.deepEqual(
      ownPaths(ctx.root, ctx.commit, ':authored'),
      [],
      'the fixture merge resolved something itself, so it is not the clean shape'
    );
  });

  scoped(/^the handoff is not refused$/, (ctx) => {
    assert.equal(
      ctx.blocked,
      false,
      `a clean receive-merge was charged with the tickets that rode in on it: ${ctx.verdict}`
    );
    cleanup(ctx);
  });

  // ── Scenario 06 ───────────────────────────────────────────────────────────
  scoped(/^the commit's delivered paths and its authored paths are both computed$/, (ctx) => {
    ctx.delivered = ownPaths(ctx.root, ctx.commit, ':delivered');
    ctx.authored = ownPaths(ctx.root, ctx.commit, ':authored');
  });

  scoped(/^the two answers are identical$/, (ctx) => {
    assert.deepEqual(
      ctx.delivered,
      ctx.authored,
      `the two answers drifted apart where only one is possible: ${JSON.stringify(ctx.delivered)} vs ${JSON.stringify(ctx.authored)}`
    );
    // And they agree on something, not on nothing.
    assert.ok(ctx.authored.length > 0, 'both answers were empty, so agreement proves nothing');
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
