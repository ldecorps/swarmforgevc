'use strict';

// BL-1901 hardening: land_merge_path.bb's own decline branches (-main's
// cond and merge-land!'s push-race retry loop) were untested by every gate
// this parcel shipped with. The feature scenarios and the property test
// (bl1901MergePathLand.property.test.js) only ever reach the "unclean line"
// and "merge conflict" declines; they never produce a lock already held, a
// dirty lander worktree, or a push rejected WHILE the land is running (they
// only move origin/main BEFORE the script starts, which the script simply
// reads as the current tip).
//
// The push-race gap was confirmed by hand-mutating the retry bound
// (`(< attempt 2)` -> `(< attempt 1)`) in place: every existing test (the
// BL-1901 feature, the property test, both bb unit runners) still passed.
//
// Four deterministic cases close these gaps: a push that loses the race
// once, which the retry must absorb by fetching and rebuilding; a push that
// loses it twice, which must decline ("lost the race twice") and hand over
// to the land step with NOTHING published by the merge path (invariant 2);
// a lock already held by another land; and a dirty lander worktree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixture } = require('../../specs/pipeline/steps/bl1872LanderDaemonSteps');
const { resolveUnitLaneTimeout } = require('../../specs/pipeline/steps/lib/contentionBudget');
const { unitLaneHeavyContentionFactor } = require('./helpers/unitLaneContentionBudget');

const { makeFixture, git } = fixture;
const SCRIPT = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'land_merge_path.bb');
const TICKET = 'BL-9001';

// Each test builds a real git fixture and spawns land_merge_path.bb (1.0 to
// 2.7 s each alone on a quiet host). On 2026-10-07 at 06:09Z two full unit
// suites ran at once (load 13.7) and the race-twice test hit the flat 20 s
// cap in both. BL-1607's heavy-test budget scales the cap with load and
// forks, the way bl1277UnscopedStepCollisionGuard.test.js already does.
const HEAVY_TIMEOUT_MS = resolveUnitLaneTimeout(20000, { factor: unitLaneHeavyContentionFactor() }).effectiveMs;

// Installs a pre-receive hook that rejects the first `rejectCount` pushes:
// on each rejected push it moves main forward itself first (an interleaved
// land actually landing), exactly as BL-1872's own raceOnce fixture does,
// so the land's retry has a real moved tip to fetch and rebuild onto. After
// `rejectCount` rejections every further push is accepted normally.
function installRace(fx, rejectCount) {
  const counter = path.join(fx.work, 'race-count');
  fs.writeFileSync(counter, '0');
  const hook = path.join(fx.origin, 'hooks', 'pre-receive');
  fs.writeFileSync(
    hook,
    [
      '#!/usr/bin/env bash',
      `n=$(cat ${JSON.stringify(counter)})`,
      `if [ "$n" -ge ${rejectCount} ]; then exit 0; fi`,
      `echo $((n + 1)) > ${JSON.stringify(counter)}`,
      'unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES',
      't=$(git rev-parse main^{tree})',
      `n2=$(echo "race-$n" | git -c user.name=r -c user.email=r@r commit-tree "$t" -p main)`,
      'git update-ref refs/heads/main "$n2"',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
}

function buildLine(fx) {
  const wt = path.join(fx.root, '.worktrees', 'lander');
  git(fx.root, 'worktree', 'add', '-q', '-B', 'swarmforge-lander', wt, 'origin/main');
  git(fx.line, 'fetch', '-q', 'origin');
  git(fx.line, 'checkout', '-q', '--detach', 'origin/main');
  fs.writeFileSync(path.join(fx.line, 'bl9001.txt'), 'BL-9001\n');
  git(fx.line, 'add', 'bl9001.txt');
  git(fx.line, 'commit', '-q', '-m', `${TICKET}: own work`);
  const queued = git(fx.line, 'rev-parse', 'HEAD');
  return { wt, queued };
}

test('a push that loses the race once is absorbed by the retry: the land still publishes via the merge path', () => {
  const fx = makeFixture();
  const { wt, queued } = buildLine(fx);
  installRace(fx, 1);
  const before = git(fx.origin, 'rev-parse', 'main');
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], { encoding: 'utf8', timeout: 60000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(out, /^LAND_PATH merge$/m, out);
  const published = out.match(/^LAND_PUBLISHED (\S+)$/m);
  assert.ok(published, out);
  assert.equal(git(fx.origin, 'rev-parse', 'main'), published[1], out);
  // The raced-in commit is an ancestor of the published tip: the retry really
  // rebuilt onto it rather than overwriting it.
  const raceSha = git(fx.origin, 'log', '--format=%H', 'main').split('\n').find((sha) => {
    return git(fx.origin, 'log', '-1', '--format=%s', sha) === 'race-0';
  });
  assert.ok(raceSha, `no raced commit found in:\n${git(fx.origin, 'log', '--oneline', 'main')}`);
  assert.equal(spawnSync('git', ['-C', fx.origin, 'merge-base', '--is-ancestor', raceSha, 'main']).status, 0);
  assert.equal(spawnSync('git', ['-C', fx.origin, 'merge-base', '--is-ancestor', before, 'main']).status, 0);
  assert.equal(git(wt, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
}, HEAVY_TIMEOUT_MS);

test('a push that loses the race twice declines to the land step, publishing nothing via the merge path', () => {
  const fx = makeFixture();
  const { wt, queued } = buildLine(fx);
  installRace(fx, 99); // every push the merge path itself makes is rejected
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], { encoding: 'utf8', timeout: 60000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(out, /^LAND_PATH land-step: the fast-forward push lost the race twice$/m, out);
  // Invariant 2: nothing published by the merge path before the hand-over
  // (the land step's own push, which may itself also lose the race against
  // this hook, is outside what this decision is about).
  const handover = out.indexOf('LAND_PATH land-step');
  assert.doesNotMatch(out.slice(0, handover), /LAND_PUBLISHED/, out);
  assert.equal(git(wt, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
}, HEAVY_TIMEOUT_MS);

test('a lock already held by another land declines to the land step, publishing nothing', () => {
  const fx = makeFixture();
  const { wt, queued } = buildLine(fx);
  const before = git(fx.origin, 'rev-parse', 'main');
  // Pre-acquire the same lock the land step's own --acquire-lock uses, under
  // the lander worktree's own .swarmforge/ (land_merge_path.bb's lock! calls
  // the land step's --acquire-lock against `wt`, same as land_main_publish.sh
  // itself would).
  fs.mkdirSync(path.join(wt, '.swarmforge', 'land-main.publish.lock'), { recursive: true });
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, LAND_LOCK_WAIT_SECONDS: '0' },
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(out, /^LAND_PATH land-step: the land lock is held$/m, out);
  assert.doesNotMatch(out, /LAND_PUBLISHED/, out);
  assert.equal(git(fx.origin, 'rev-parse', 'main'), before, out);
  assert.equal(git(wt, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
}, HEAVY_TIMEOUT_MS);

test('a dirty lander worktree declines to the land step, which still lands its own way', () => {
  const fx = makeFixture();
  const { wt, queued } = buildLine(fx);
  // The dirty check is `git status --porcelain --untracked-files=no` (an
  // untracked file alone does not count), so modify a TRACKED file without
  // committing it: 'shared.txt' is seeded by makeFixture itself.
  fs.writeFileSync(path.join(wt, 'shared.txt'), 'dirtied by another process\n');
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], { encoding: 'utf8', timeout: 60000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(out, /^LAND_PATH land-step: the lander worktree has uncommitted changes$/m, out);
  // Invariant 2: nothing published by the MERGE PATH before the hand-over -
  // the land step itself may still publish its own way afterward (it does
  // not inherit the merge path's dirty-worktree check, and is unaffected by
  // the uncommitted change this test made under `wt`).
  const handover = out.indexOf('LAND_PATH land-step');
  assert.doesNotMatch(out.slice(0, handover), /LAND_PUBLISHED/, out);
}, HEAVY_TIMEOUT_MS);

// QA D1: `git checkout --detach <commit>` fails when an untracked file in the
// lander worktree sits at a path the queued commit tracks. Before the fix its
// exit was ignored and `git merge` merged origin/main into the lander's HOME
// branch, publishing an empty merge as LAND_PUBLISHED. The merge path must
// decline instead, and never publish a commit that lacks the queued one.
test('a checkout the untracked lander worktree refuses declines to the land step, publishing nothing via the merge path', () => {
  const fx = makeFixture();
  const { wt, queued } = buildLine(fx);
  // origin/main moves on after the line forked, so the land must merge.
  fs.writeFileSync(path.join(fx.root, 'other.txt'), 'other\n');
  git(fx.root, 'add', 'other.txt');
  git(fx.root, 'commit', '-q', '-m', 'BL-9002: another landed ticket');
  git(fx.root, 'push', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(wt, 'bl9001.txt'), 'stray\n');
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], { encoding: 'utf8', timeout: 60000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(out, /^LAND_PATH land-step: the queued commit could not be checked out in the lander worktree$/m, out);
  const handover = out.indexOf('LAND_PATH land-step');
  assert.doesNotMatch(out.slice(0, handover), /LAND_PUBLISHED/, out);
  // Whatever the land step then did, main never carries a commit that lacks
  // the queued one: either the queued commit is on main, or main did not
  // take a merge-path land at all.
  assert.doesNotMatch(git(fx.origin, 'log', '--format=%s', 'main'), /^Land BL-9001: merge origin\/main/m, out);
  assert.equal(git(wt, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
}, HEAVY_TIMEOUT_MS);

// BL-1901 hardening: registry-decline (the land step's registry-pass check,
// amendment 1c6f5d70a0) does its OWN checkout of the built sha, separate
// from build!'s. On the fast-forward path (the queued commit already
// contains origin/main) build! never checks the commit out at all - it is
// registry-decline's checkout that is the FIRST one in the whole flow. An
// untracked file at a path the queued commit tracks must fail it exactly as
// it fails build!'s own checkout on the merge path (QA D1's shape), never
// silently proceed as if the registers were readable.
test('a checkout the untracked lander worktree refuses, on the fast-forward path, declines to the land step', () => {
  const fx = makeFixture();
  const { wt, queued } = buildLine(fx);
  // origin/main has NOT moved since the line was cut: build! takes the
  // fast-forward branch ({:sha commit}), never checking the commit out.
  fs.writeFileSync(path.join(wt, 'bl9001.txt'), 'stray\n');
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], { encoding: 'utf8', timeout: 60000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(out, /^LAND_PATH land-step: the built commit could not be checked out to read its registers$/m, out);
  const handover = out.indexOf('LAND_PATH land-step');
  assert.doesNotMatch(out.slice(0, handover), /LAND_PUBLISHED/, out);
  assert.doesNotMatch(git(fx.origin, 'log', '--format=%s', 'main'), /^Land BL-9001: merge origin\/main/m, out);
  assert.equal(git(wt, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
}, HEAVY_TIMEOUT_MS);
