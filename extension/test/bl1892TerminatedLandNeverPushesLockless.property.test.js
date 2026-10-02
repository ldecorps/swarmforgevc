'use strict';

// BL-1892 declared invariant (coder first authorship - BL-654):
//   "A land never pushes or re-points after it has released the land lock."
//
// Each draw runs the REAL land_main_publish.sh --land against a bare-origin
// fixture (mkdtemp, BL-1390) and signals it once, at a drawn moment - held in
// a pre-push hook (just before the push), held mid re-point (a
// reference-transaction hook on the re-pointed branch), or after a random
// delay - with TERM or INT, to the land alone or to its whole process group.
// Hooks timestamp every push start and re-point start; the driver
// timestamps the signal. A land releases its lock only when it honours a
// signal (it prints LAND_STOPPED: signalled ...) or at its normal end. So the
// invariant reads: when the land honoured the signal, nothing started a push
// or a re-point after the signal (a re-point already started may finish -
// scenario 02); when it did not, it ran to its normal end (bash's
// wait-and-cooperative-exit rule: a SIGINT to the land alone while a child it
// waits on exits normally is treated as the child's to handle, so no trap
// runs and the lock stays held to the end). Either way the lock is gone.
//
// Generator reach is asserted: every moment and both targets are drawn, a
// signal lands before any push at least twice, and mid re-point at least
// twice.
//
// Non-vacuity: with origin/main's land_main_publish.sh (land_release_trap as
// the INT/TERM handler, which returns), a pre-push signal released the lock
// and the land rematched and pushed after it - the property failed. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const LAND = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'land_main_publish.sh');
const BRANCH = 'swarmforge-lander';

function hookScript(log, marker, kind, holdHere, lock) {
  // Each start records whether the land lock was held at that moment - the
  // invariant is about the lock, and a push spawned just before the signal
  // can reach its hook a few ms after it while the lock is still held.
  const held = `$([ -e '${lock}' ] && echo held || echo free)`;
  const hold = holdHere ? `[ -e '${marker}' ] || { touch '${marker}'; sleep ${kind === 'push' ? 6 : 4}; }` : ':';
  if (kind === 'push') {
    return ['#!/usr/bin/env bash', `echo "push-start $(date +%s%N) ${held}" >> '${log}'`, hold, ''].join('\n');
  }
  return [
    '#!/usr/bin/env bash',
    '[ "$1" = prepared ] || exit 0',
    'while read -r o n r; do',
    `  if [ "$r" = refs/heads/${BRANCH} ]; then`,
    `    echo "repoint-start $(date +%s%N) ${held}" >> '${log}'`,
    `    ${hold}`,
    '  fi',
    'done',
    'exit 0',
    '',
  ].join('\n');
}

function runDraw({ moment, signal, target, delayMs }) {
  const work = mkTmpDir('bl1892prop-');
  const repo = path.join(work, 'repo');
  const log = path.join(work, 'events');
  const marker = path.join(work, 'moment');
  const lock = path.join(repo, '.swarmforge', 'land-main.publish.lock');
  const g = (cwd, ...a) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...a], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', path.join(work, 'origin.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  assert.equal(path.resolve(repo, g(repo, 'rev-parse', '--git-common-dir')), path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.swarmforge/\n.worktrees/\n');
  g(repo, 'add', '.gitignore');
  g(repo, 'commit', '-q', '-m', 'seed');
  g(repo, 'remote', 'add', 'origin', path.join(work, 'origin.git'));
  g(repo, 'push', '-q', 'origin', 'main');
  g(repo, 'fetch', '-q', 'origin');
  const side = path.join(repo, '.worktrees', 'side');
  g(repo, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  fs.writeFileSync(path.join(side, 'a.txt'), 'a\n');
  g(side, 'add', 'a.txt');
  g(side, 'commit', '-q', '-m', 'BL-9001: own line');
  const sha = g(side, 'rev-parse', 'HEAD');
  g(repo, 'checkout', '-q', '-b', BRANCH, 'origin/main');
  fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-push'), hookScript(log, marker, 'push', moment === 'pre-push', lock), { mode: 0o755 });
  fs.writeFileSync(
    path.join(repo, '.git', 'hooks', 'reference-transaction'),
    hookScript(log, marker, 'repoint', moment === 'repoint', lock),
    { mode: 0o755 }
  );
  const wait =
    moment === 'random'
      ? `sleep ${(delayMs / 1000).toFixed(2)}`
      : `for i in $(seq 1 600); do [ -e '${marker}' ] && break; sleep 0.05; done`;
  const kill = target === 'group' ? `kill -${signal} -- -$pid` : `kill -${signal} $pid`;
  const driver = [
    `setsid bash '${LAND}' '${repo}' --land BL-9001 ${sha} > '${work}/land.out' 2>&1 &`,
    'pid=$!',
    wait,
    `echo "signal $(date +%s%N)" >> '${log}'`,
    `${kill} 2>/dev/null`,
    'wait $pid; echo "rc=$?"',
    'sleep 0.5',
    `[ -e '${repo}/.swarmforge/land-main.publish.lock' ] && echo LOCK_LEFT || echo LOCK_GONE`,
  ].join('\n');
  const out = execFileSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 120000 });
  const events = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '))
    : [];
  return { out, events, landOut: fs.readFileSync(path.join(work, 'land.out'), 'utf8') };
}

test(
  'BL-1892/BL-654 invariant: a land never pushes or re-points after it has released the land lock',
  () => {
    const reach = { 'pre-push': 0, repoint: 0, random: 0, group: 0, process: 0, beforeAnyPush: 0, midRepoint: 0, honoured: 0 };
    fc.assert(
      fc.property(
        fc.record({
          moment: fc.constantFrom('pre-push', 'repoint', 'random'),
          signal: fc.constantFrom('TERM', 'TERM', 'INT'),
          target: fc.constantFrom('process', 'group'),
          // Half the random delays land in the window where the land is
          // building and verifying its push (~0.6-1.5 s in) - QA's bounce D1
          // (seed -12637621) was a TERM there, reached only by luck before.
          delayMs: fc.oneof(fc.integer({ min: 200, max: 4000 }), fc.integer({ min: 600, max: 1500 })),
        }),
        (draw) => {
          const { out, events, landOut } = runDraw(draw);
          assert.match(out, /LOCK_GONE/, `lock left behind:\n${landOut}`);
          const sig = BigInt((events.find(([k]) => k === 'signal') || [])[1] || '0');
          assert.ok(sig > 0n, `no signal recorded: ${out}`);
          if (/LAND_STOPPED: signalled/.test(landOut)) {
            reach.honoured += 1;
            // A stop honoured DURING the re-point means the re-point process
            // was already running when the signal came (the land marks it
            // before spawning it); its ref-transaction hook only logs when the
            // ref moves, which can be after the signal. The lock is released
            // after that re-point, so its event is not "after release". A push
            // start after the signal with the lock already released never is
            // allowed (QA bounce 2, delayMs 600); one whose hook logs just
            // after the signal while the lock is still held was spawned before
            // it, and the stop kills it before the lock goes.
            const midRepointStop = /LAND_STOPPED: signalled during the re-point/.test(landOut);
            const after = events.filter(
              ([k, t, lock]) =>
                BigInt(t) > sig && lock === 'free' && (k === 'push-start' || (k === 'repoint-start' && !midRepointStop))
            );
            assert.deepEqual(after, [], `${JSON.stringify(draw)} started after the signal: ${JSON.stringify(events)}\n${landOut}`);
          } else {
            assert.match(landOut, /LAND_PUBLISHED|LAND_STOPPED/, `${JSON.stringify(draw)} neither stopped nor finished:\n${landOut}`);
          }
          reach[draw.moment] += 1;
          reach[draw.target] += 1;
          if (draw.moment === 'pre-push') reach.beforeAnyPush += 1;
          if (draw.moment === 'repoint' && events.some(([k, t]) => k === 'repoint-start' && BigInt(t) < sig)) reach.midRepoint += 1;
        }
      ),
      { numRuns: 16 }
    );
    for (const k of ['pre-push', 'repoint', 'random', 'group', 'process']) {
      assert.ok(reach[k] >= 2, `reach: ${JSON.stringify(reach)}`);
    }
    assert.ok(reach.beforeAnyPush >= 2 && reach.midRepoint >= 2 && reach.honoured >= 5, `reach: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS * 4
);
