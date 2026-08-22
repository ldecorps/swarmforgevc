'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-857 invariants (property authorship rests with the coder, first pass -
// BL-654). Drives the REAL tunnel_ownership_lib.sh / stop_ancillary_services.sh
// / launch_resident_spy_tunnel.sh against real filesystem fixtures with a
// stubbed cloudflared binary and real (harmless, self-spawned) background
// processes - never a fabricated process list or a mocked reap decision.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Every fixture uses a per-run, randomized, "bl857-prop-<pid>-..." tunnel
// name - NEVER the real production name ("swarmforge-bubble") - because
// these tests spawn REAL processes and run the REAL, unscoped-by-nothing-
// but-the-name reap logic; a dev/CI host may have the real operator's
// tunnel running under that exact name at the same time (this is not
// hypothetical - it happened once while developing this ticket).

const REPO_ROOT = path.join(__dirname, '..', '..');
const OWNERSHIP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');
const STOP = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'stop_ancillary_services.sh');
const LAUNCH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_resident_spy_tunnel.sh');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function ownershipLib(args, env) {
  const result = spawnSync('bash', [OWNERSHIP_LIB, ...args], { encoding: 'utf8', env });
  return (result.stdout || '').trim();
}

// Spawns a real, harmless background process whose full command line
// contains "run <name>" the way a real cloudflared invocation would.
// Redirected away from this process's own stdio and detached via `&` in a
// throwaway bash -c wrapper that exits immediately - spawnSync only waits
// for that short-lived wrapper, never for the long-running fixture itself.
function spawnFakeCloudflared(name) {
  const dir = mkTmpDir('bl857-prop-fake-cf-');
  const bin = path.join(dir, 'cloudflared');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\nsleep 300\n');
  fs.chmodSync(bin, 0o755);
  const child = spawnSync('bash', [
    '-c',
    `"$1" tunnel --config "$2/fake-config.yml" --no-autoupdate run "$3" >/dev/null 2>&1 & echo $!`,
    '_',
    bin,
    dir,
    name,
  ]);
  return Number(child.stdout.toString().trim());
}

function uniqueName(label) {
  return `bl857-prop-${process.pid}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Invariant 1 ──────────────────────────────────────────────────────────
// "Exactly one process may own the production tunnel name at a time; any
// other process bound to it is an orphan by definition, whatever launched
// it."
//
// Generator reach: 1-5 candidate processes all bound to the SAME name,
// with the registered owner index ranging over every one of them (or
// none at all, `ownerIndex === candidateCount`) - so both "the owner is
// the only survivor" and "nobody is registered, everybody dies" are
// exercised, not just the two-process happy path.
const candidateCountArb = fc.integer({ min: 1, max: 5 });

test(
  'property (invariant 1): exactly one registered owner survives a reap; every other process bound to the name is treated as an orphan',
  () => {
    fc.assert(
      fc.property(candidateCountArb, fc.nat({ max: 5 }), (candidateCount, ownerSlot) => {
        const name = uniqueName('inv1');
        const registryDir = mkTmpDir('bl857-prop-registry-');
        const env = { ...process.env, SWARMFORGE_TUNNEL_REGISTRY_DIR: registryDir };
        const ownerIndex = ownerSlot >= candidateCount ? -1 : ownerSlot; // -1 = nobody registered

        const pids = [];
        try {
          for (let i = 0; i < candidateCount; i++) {
            pids.push(spawnFakeCloudflared(name));
          }
          if (ownerIndex >= 0) {
            ownershipLib(['record-owner', name, String(pids[ownerIndex]), '/irrelevant/root'], env);
          }

          spawnSync('bash', [OWNERSHIP_LIB, 'reap-orphans', name, ''], { env });

          pids.forEach((pid, i) => {
            const shouldSurvive = i === ownerIndex;
            assert.equal(
              isAlive(pid),
              shouldSurvive,
              `candidateCount=${candidateCount} ownerIndex=${ownerIndex}: pid[${i}] expected alive=${shouldSurvive}, got alive=${isAlive(pid)}`
            );
          });
        } finally {
          pids.forEach((pid) => killPid(pid));
        }
      }),
      { numRuns: 15 }
    );
  },
  60000
);

// ── Invariant 2 ──────────────────────────────────────────────────────────
// "A tunnel's ownership record outlives the tree that launched it -
// deleting a sandbox never destroys the only record of a live process."
//
// Generator reach: the registry directory is ALWAYS structurally separate
// from the launching root (the real design - "somewhere tied to the HOST,
// not to the caller's $ROOT"), and the root's own nesting depth and
// leftover-file noise vary, proving the record's survival does not depend
// on any accident of the root's shape - `rm -rf` on an arbitrarily
// populated, arbitrarily nested tree must never take the registry with it.
const nestingDepthArb = fc.integer({ min: 0, max: 3 });
const noiseFileCountArb = fc.integer({ min: 0, max: 4 });

test(
  'property (invariant 2): the ownership record survives deletion of the tree that launched it',
  () => {
    fc.assert(
      fc.property(nestingDepthArb, noiseFileCountArb, (depth, noiseCount) => {
        const name = uniqueName('inv2');
        const registryDir = mkTmpDir('bl857-prop-registry-'); // never inside the root below
        const opRootBase = mkTmpDir('bl857-prop-root-');
        let root = opRootBase;
        for (let i = 0; i < depth; i++) {
          root = path.join(root, `nested-${i}`);
        }
        fs.mkdirSync(root, { recursive: true });
        for (let i = 0; i < noiseCount; i++) {
          fs.writeFileSync(path.join(root, `noise-${i}.txt`), 'noise');
        }

        const env = { ...process.env, SWARMFORGE_TUNNEL_REGISTRY_DIR: registryDir };
        let pid;
        try {
          ownershipLib(['register-operator-root', root], env);
          const binDir = path.join(root, 'bin');
          fs.mkdirSync(binDir, { recursive: true });
          const fakeCf = path.join(binDir, 'cloudflared');
          fs.writeFileSync(
            fakeCf,
            [
              '#!/usr/bin/env bash',
              'DIR="$(cd "$(dirname "$0")" && pwd)"',
              'echo "INF Registered tunnel connection connIndex=0"',
              'sleep 60 &',
              'echo $! > "$DIR/cf.pid"',
              'wait',
              '',
            ].join('\n')
          );
          fs.chmodSync(fakeCf, 0o755);
          const cfHome = path.join(root, 'cloudflared-home');
          fs.mkdirSync(cfHome, { recursive: true });
          const configYml = path.join(cfHome, 'config.yml');
          fs.writeFileSync(
            configYml,
            `tunnel: 00000000-0000-0000-0000-0000000000dd\ncredentials-file: ${path.join(cfHome, 'cred.json')}\ningress:\n  - hostname: bubble.prop-test.invalid\n    service: http://127.0.0.1:8765\n  - service: http_status:404\n`
          );
          fs.writeFileSync(path.join(cfHome, 'cred.json'), '{}');

          const launchResult = spawnSync('bash', [LAUNCH, root], {
            encoding: 'utf8',
            timeout: 75000,
            env: {
              ...env,
              CLOUDFLARED: fakeCf,
              SWARMFORGE_NAMED_TUNNEL: name,
              SWARMFORGE_NAMED_TUNNEL_HOSTNAME: 'bubble.prop-test.invalid',
              SWARMFORGE_CLOUDFLARED_CONFIG: configYml,
              SWARMFORGE_SKIP_CAFFEINATE: '1',
              // A wider wait budget than the 45s default - this test runs
              // right after invariant 1's own heavy process-spawn churn in
              // the same file, and a loaded host can genuinely delay a
              // freshly forked process's first scheduled slice well past
              // the default window (confirmed: the same fixture launches
              // in 3-7s standalone but has been observed taking >45s here
              // under contention - not a logic bug, a scheduling one).
              SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS: '140',
              SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL: '0.5',
            },
          });
          if (launchResult.status !== 0) {
            const logPath = path.join(root, '.swarmforge', 'operator', 'resident-spy-cloudflared.log');
            const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '<no log file>';
            const pidFilePath = path.join(root, '.swarmforge', 'operator', 'resident-spy-cloudflared.pid');
            const pidFileContent = fs.existsSync(pidFilePath) ? fs.readFileSync(pidFilePath, 'utf8') : '<no pid file>';
            throw new Error(
              `expected the launch to succeed (signal=${launchResult.signal}): ${launchResult.stderr}\n--- log file (${logPath}) ---\n${logContent}\n--- pid file ---\n${pidFileContent}`
            );
          }
          pid = Number(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'resident-spy-cloudflared.pid'), 'utf8').trim());
          assert.ok(isAlive(pid), 'expected the launched tunnel to be alive before deletion');

          fs.rmSync(root, { recursive: true, force: true });
          assert.equal(fs.existsSync(root), false, 'expected the launching root to actually be gone');

          const readBack = ownershipLib(['read-owner-pid', name], env);
          assert.equal(readBack, String(pid), `expected the registry (separate from the deleted root) to still name pid ${pid}, got "${readBack}"`);
          assert.ok(isAlive(pid), 'expected the process itself to still be running - deleting its tree must not kill it');
        } finally {
          killPid(pid);
        }
      }),
      { numRuns: 6 }
    );
  },
  400000
);

// ── Invariant 3 ──────────────────────────────────────────────────────────
// "Reaping is scoped to the production tunnel name; a cloudflared serving
// any other name is never touched."
//
// Generator reach: the bystander name is sometimes an unrelated random
// string and sometimes deliberately built by extending the target name
// with a random prefix/suffix (e.g. target "x" vs bystander "x-staging"
// or "old-x") - proving the scope is an exact match, never "starts with"
// or "contains", the same failure shape a naive substring check would
// only reveal on these specifically-crafted overlaps.
const bystanderShapeArb = fc.constantFrom('unrelated', 'suffixed', 'prefixed');

test(
  'property (invariant 3): reaping never touches a process serving a different tunnel name, including near-miss overlaps',
  () => {
    fc.assert(
      fc.property(bystanderShapeArb, fc.boolean(), (shape, registerTargetOwner) => {
        const target = uniqueName('inv3-target');
        const bystander =
          shape === 'unrelated' ? uniqueName('inv3-bystander') : shape === 'suffixed' ? `${target}-staging` : `old-${target}`;
        const registryDir = mkTmpDir('bl857-prop-registry-');
        const env = { ...process.env, SWARMFORGE_TUNNEL_REGISTRY_DIR: registryDir };

        const targetPid = spawnFakeCloudflared(target);
        const bystanderPid = spawnFakeCloudflared(bystander);
        try {
          if (registerTargetOwner) {
            ownershipLib(['record-owner', target, String(targetPid), '/irrelevant/root'], env);
          }

          spawnSync('bash', [OWNERSHIP_LIB, 'reap-orphans', target, ''], { env });

          assert.ok(isAlive(bystanderPid), `expected the bystander ("${bystander}") to survive a reap scoped to "${target}"`);
          assert.equal(
            isAlive(targetPid),
            registerTargetOwner,
            `expected the target pid's survival to depend only on its own registration (registered=${registerTargetOwner})`
          );
        } finally {
          killPid(targetPid);
          killPid(bystanderPid);
        }
      }),
      { numRuns: 15 }
    );
  },
  60000
);
