'use strict';

// BL-2094: step handlers for "QA's gather diffs the parcel against its
// merge-base with main, so the property runners its change reaches run".
// Drives the REAL property_runners CHECKLIST row (qaGather.ts) and the REAL
// front-end/reach-selector (run_property_runners.sh, property_runner_reach.bb)
// from a real git repository under mkdtemp whose checked-out HEAD is the
// parcel commit - the shape QA actually gathers in. Never a fake runFn for
// this row (constraint): a recording wrapper around the real spawn
// (qaGatherAdapter's own defaultRunFn) is the only instrumentation.
//
// Retires BL-2073's own feature/handler (the same commit, BL-233): that
// acceptance drove a fake runner that never ran git and asserted the very
// argument that made the row empty - this feature replaces it entirely.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const { CHECKLIST, runChecklist, resolveMergeBaseWithMain } = require('../../../extension/out/quality/qaGather');
const { defaultRunFn } = require('../../../extension/out/metrics/qaGatherAdapter');

const FEATURE = "BL-2094 QA's gather diffs the parcel against its merge-base with main, so the property runners its change reaches run";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const KNOWN_CHANGED = new Set(['a.bb', 'docs/how-to/note.md']);
const KNOWN_RAN = new Set(['none', 'x']);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// The transitive closure the real front-end/reach-selector need: a .sh
// pair (run_property_runners.sh + the run_recorded_lane.sh it execs) and a
// .bb triple (property_runner_reach.bb + its own two load-file deps) -
// copied VERBATIM, never reimplemented, so this scenario proves the REAL
// scripts, not a restatement of them.
function copyFixtureScripts(scriptsDst) {
  fs.mkdirSync(path.join(scriptsDst, 'test'), { recursive: true });
  for (const name of ['property_runner_reach.bb', 'property_runner_reach_lib.bb', 'bb_load_closure_lib.bb']) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDst, name));
  }
  for (const name of ['run_property_runners.sh', 'run_recorded_lane.sh']) {
    const dst = path.join(scriptsDst, 'test', name);
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, 'test', name), dst);
    fs.chmodSync(dst, 0o755);
  }
}

// Runner x reaches a.bb by load-file (property_runner_reach_lib.bb's rule
// 2); runner y reaches c.sh because its own text names it (rule 3) - the
// same two reach mechanisms bl2049PropertyRunnerReachSteps.js's own fixture
// proves, reused here rather than restated differently.
function writeFixtureRunners(scriptsDst) {
  fs.writeFileSync(path.join(scriptsDst, 'a.bb'), '; fixture lib a\n');
  fs.writeFileSync(path.join(scriptsDst, 'c.sh'), '#!/usr/bin/env bash\necho c\n');
  fs.writeFileSync(
    path.join(scriptsDst, 'test', 'x_property_runner.bb'),
    "(require '[babashka.fs :as fs])\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \"..\" \"a.bb\")))\n(System/exit 0)\n"
  );
  fs.writeFileSync(
    path.join(scriptsDst, 'test', 'y_property_runner.bb'),
    '; this fixture runner spawns ../c.sh for its own setup\n(System/exit 0)\n'
  );
}

function mkFixture(ctx) {
  const root = trackedTmpRoot('bl2094-prop-runner-row-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const scriptsDst = path.join(root, 'swarmforge', 'scripts');
  copyFixtureScripts(scriptsDst);
  writeFixtureRunners(scriptsDst);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base: front-end, reach selector and fixture runners x/y']);
  ctx.bl2094 = { root, scriptsDst };
}

// "changes <changed>" - <changed> is a name relative to swarmforge/scripts/
// (the reach selector's own population), mapped to the real path the
// scenario means: a.bb lives beside the runners' own load-file target,
// docs/how-to/note.md is deliberately OUTSIDE swarmforge/scripts/ entirely
// (property_runner_reach_lib.bb's under-scripts-dir? filter - reaches
// nothing, whatever runner population exists).
function changedFileFor(ctx, changed) {
  return changed === 'a.bb' ? path.join(ctx.bl2094.scriptsDst, 'a.bb') : path.join(ctx.bl2094.root, changed);
}

function commitChange(ctx, changed, message) {
  const { root } = ctx.bl2094;
  const target = changedFileFor(ctx, changed);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `; changed ${Date.now()}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function runPropertyRunnersRow(ctx) {
  const st = ctx.bl2094;
  const calls = [];
  const runFn = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    return defaultRunFn(command, args, cwd);
  };
  const commit = git(st.root, ['rev-parse', 'HEAD']);
  const ctxForRow = {
    root: st.root,
    ticketId: 'BL-9999',
    commit,
    mergeBaseWithMain: resolveMergeBaseWithMain(st.root, commit, runFn),
  };
  const rows = runChecklist([CHECKLIST.find((c) => c.id === 'property_runners')], ctxForRow, runFn);
  st.calls = calls;
  st.row = rows[0];
  st.commit = commit;
}

function frontEndCall(ctx) {
  return ctx.bl2094.calls.find((c) => c.command.includes('run_property_runners.sh'));
}

function durationsFileRunnerBasenames(ctx) {
  const durationsPath = path.join(ctx.bl2094.scriptsDst, 'test', '.property-runner-durations.jsonl');
  if (!fs.existsSync(durationsPath)) {
    return [];
  }
  return fs
    .readFileSync(durationsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => path.basename(JSON.parse(line).file));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    new RegExp(
      '^a fixture repository holding the property-runner front-end, its reach selector, and runners x and y, where runner x reaches a\\.bb and runner y reaches c\\.sh$'
    ),
    (ctx) => {
      mkFixture(ctx);
    }
  );

  // ── property-runner-row-runs-what-the-parcel-reaches-01, also reused
  //    verbatim by scenario 02 ────────────────────────────────────────────
  scoped(new RegExp('^the checked-out HEAD is a parcel commit on top of main that changes (.+?)$'), (ctx, changed) => {
    assert.ok(KNOWN_CHANGED.has(changed), `unknown changed value: ${changed} - known: ${[...KNOWN_CHANGED]}`);
    const st = ctx.bl2094;
    st.mainSha = git(st.root, ['rev-parse', 'HEAD']);
    git(st.root, ['checkout', '-q', '-b', 'parcel']);
    st.parcelSha = commitChange(ctx, changed, `parcel: change ${changed}`);
  });

  scoped(new RegExp('^the QA gather runs its property_runners row for HEAD$'), (ctx) => {
    runPropertyRunnersRow(ctx);
  });

  scoped(new RegExp('^the front-end was given the merge-base of main and HEAD$'), (ctx) => {
    const st = ctx.bl2094;
    const call = frontEndCall(ctx);
    assert.ok(call, 'expected the front-end to have been started');
    // Independent verification: computed HERE by a separate real git call,
    // never by re-reading the production ctx this test itself built.
    const trueMergeBase = git(st.root, ['merge-base', 'main', st.commit]);
    assert.deepEqual(call.args, ['--changed-from', trueMergeBase], `expected --changed-from ${trueMergeBase}, got: ${JSON.stringify(call.args)}`);
    assert.notEqual(call.args[1], st.commit, 'the front-end must never be given the gathered commit itself');
  });

  scoped(new RegExp('^the runners that ran are (.+?)$'), (ctx, ran) => {
    assert.ok(KNOWN_RAN.has(ran), `unknown ran value: ${ran} - known: ${[...KNOWN_RAN]}`);
    const expected = ran === 'none' ? [] : [`${ran}_property_runner.bb`];
    const actual = durationsFileRunnerBasenames(ctx);
    assert.deepEqual(actual.sort(), expected.sort(), `expected runners ${JSON.stringify(expected)} to have run, got: ${JSON.stringify(actual)}`);
  });

  // ── property-runner-row-ignores-what-main-gained-02 ─────────────────────
  scoped(new RegExp('^main has since gained a commit that changes c\\.sh$'), (ctx) => {
    const st = ctx.bl2094;
    const parcelSha = st.parcelSha;
    git(st.root, ['checkout', '-q', 'main']);
    commitChange(ctx, 'c.sh', 'main: change c.sh after the parcel branched');
    git(st.root, ['checkout', '-q', 'parcel']);
    assert.equal(git(st.root, ['rev-parse', 'HEAD']), parcelSha, 'HEAD must be back on the parcel commit, unaffected by main moving on');
  });

  // ── property-runner-row-blocks-without-a-merge-base-03 ──────────────────
  scoped(new RegExp('^the checked-out HEAD is a commit on an orphan branch that shares no history with main$'), (ctx) => {
    const st = ctx.bl2094;
    git(st.root, ['checkout', '-q', '--orphan', 'orphan']);
    git(st.root, ['rm', '-rf', '--quiet', '.']);
    fs.writeFileSync(path.join(st.root, 'orphan.txt'), 'no shared history with main\n');
    git(st.root, ['add', '-A']);
    git(st.root, ['commit', '-q', '-m', 'orphan: no common ancestor with main']);
  });

  scoped(new RegExp('^the property_runners row reads blocked, naming the failed merge-base$'), (ctx) => {
    const { row, commit } = ctx.bl2094;
    assert.equal(row.status, 'blocked', `expected a blocked row, got: ${JSON.stringify(row)}`);
    assert.equal(row.reason, `could not resolve merge-base main ${commit}`);
  });

  scoped(new RegExp('^the front-end was not started$'), (ctx) => {
    assert.equal(frontEndCall(ctx), undefined, 'expected no front-end call at all');
  });
}

module.exports = { registerSteps };
