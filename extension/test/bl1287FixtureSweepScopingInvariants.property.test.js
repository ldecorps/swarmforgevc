'use strict';

// BL-1287 declared invariants (property authorship rests with the coder,
// BL-654). Drives the REAL leakedFixtureTunnelPids
// (extension/test/helpers/fixtureTunnelName.js) against REAL spawned
// processes - never a fabricated process table.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const { leakedFixtureTunnelPids } = require('./helpers/fixtureTunnelName');
const { spawnZombie } = require('./helpers/fixtureLiveness');
const { mkTmpDir } = require('./helpers/tmpDir');

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function spawnFakeCloudflared(name, dir) {
  const binDir = dir || mkTmpDir('bl1287-prop-fake-cf-');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'cloudflared');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\nsleep 300\n');
  fs.chmodSync(bin, 0o755);
  const child = spawnSync('bash', [
    '-c',
    `"$1" tunnel --config "$2/fake-config.yml" --no-autoupdate run "$3" >/dev/null 2>&1 & echo $!`,
    '_',
    bin,
    binDir,
    name,
  ]);
  return Number(child.stdout.toString().trim());
}

function nameWithCreator(creatorPid) {
  return `sfvc-test-${creatorPid}-1-bl1287prop-${Math.random().toString(36).slice(2, 8)}`;
}

// A pid guaranteed dead: spawnSync waits for full exit before returning.
function deadPid() {
  return spawnSync('true', []).pid;
}

// A pid guaranteed alive, killed a specific way (per invariant 2's "however
// that run died"). Returns the corpse's own now-dead pid once fully reaped.
function deadPidVia(signal) {
  const child = spawnSync('bash', ['-c', 'sleep 2 >/dev/null 2>&1 & echo $!']);
  const pid = Number(child.stdout.toString().trim());
  process.kill(pid, signal);
  const start = Date.now();
  while (Date.now() - start < 2000) {
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
  }
  throw new Error(`pid ${pid} did not die within 2s of ${signal}`);
}

// ── Invariant 1 ────────────────────────────────────────────────────────
// "A fixture sweep only ever signals a pid whose creating run is no longer
// alive; a fixture a live run still owns is never selected, however its
// temp path or tunnel name is shaped."
//
// Generator reach: creator liveness (alive/dead) crossed with a random
// label shape for the tunnel name's own free-text suffix - proving the
// decision tracks creator liveness alone, never the label's own shape.
const labelArb = fc.stringMatching(/^[a-z][a-zA-Z0-9-]{0,12}$/);

test('property (invariant 1): a fixture is selected only when its creating run is no longer alive, whatever its tunnel name looks like', () => {
  fc.assert(
    fc.property(fc.boolean(), labelArb, (creatorAlive, label) => {
      const creatorPid = creatorAlive ? process.pid : deadPid();
      const name = `sfvc-test-${creatorPid}-1-${label}-${Math.random().toString(36).slice(2, 8)}`;
      const pid = spawnFakeCloudflared(name);
      try {
        const selected = leakedFixtureTunnelPids(execFileSync);
        const isSelected = selected.includes(pid);
        assert.equal(
          isSelected,
          !creatorAlive,
          `creatorAlive=${creatorAlive}: expected selected=${!creatorAlive}, got ${isSelected}`
        );
      } finally {
        killPid(pid);
      }
    }),
    { numRuns: 12 }
  );
});

// ── Invariant 2 ────────────────────────────────────────────────────────
// "The sweep still clears every fixture left by a run that is gone,
// however that run died - nothing traps SIGKILL, so a killed run always
// leaves its fixtures behind and the next run must still find them."
//
// Generator reach: the creator dies by different signals (SIGKILL, the
// untrappable one nothing can clean up after, and SIGTERM, a cooperative
// one), OR is left as an unreaped ZOMBIE (BL-1287 bounce, 2026-09-05:
// architect found isProcessAlive misreported a zombie creator as alive,
// so its fixture was never swept - the exact "however that run died"
// case this invariant names). The fixture must still be swept every way,
// since the sweep's own job starts only once the creator is already gone
// (functionally, for a zombie - awaiting a reaper it will never usefully
// answer signals for again).
const DEATH_MODES = ['SIGKILL', 'SIGTERM', 'ZOMBIE'];

test('property (invariant 2): a fixture is cleared whatever signal killed its creator, zombie window included', async () => {
  const seen = new Set();
  for (const mode of DEATH_MODES) {
    await fc.assert(
      fc.asyncProperty(fc.constant(mode), async (m) => {
        seen.add(m);
        let creatorPid;
        let creatorCleanup = () => {};
        if (m === 'ZOMBIE') {
          const zombie = await spawnZombie(`bl1287-inv2-zombie-${Math.random().toString(36).slice(2, 8)}`);
          if (!zombie.confirmedZombie) {
            throw new Error(`expected a genuine zombie (/proc State: Z), got pid ${zombie.pid}`);
          }
          creatorPid = zombie.pid;
          creatorCleanup = zombie.cleanup;
        } else {
          creatorPid = deadPidVia(m);
        }
        const name = nameWithCreator(creatorPid);
        const pid = spawnFakeCloudflared(name);
        try {
          const selected = leakedFixtureTunnelPids(execFileSync);
          assert.ok(selected.includes(pid), `expected pid ${pid} (creator died via ${m}) to be selected, got: ${JSON.stringify(selected)}`);
        } finally {
          killPid(pid);
          creatorCleanup();
        }
      }),
      { numRuns: 3 }
    );
  }
  const undrawn = DEATH_MODES.filter((m) => !seen.has(m));
  assert.deepEqual(undrawn, [], `expected every death mode to be exercised, never omitted: ${JSON.stringify(undrawn)}`);
});

// ── Invariant 3 ────────────────────────────────────────────────────────
// "No selection path can reach a cloudflared outside the OS temp
// directory, however the tunnel names collide."
//
// Generator reach: the installed (non-temp) process's tunnel name is
// sometimes identical to the fixture's own and sometimes merely similar -
// neither ever selects it, proving the temp-path boundary holds
// regardless of name collision shape. The shared name carries a DEAD
// creator pid deliberately: if the temp-path filter alone were removed,
// the creator-liveness check would otherwise wave a dead-creator fixture
// straight through, so this isolates the temp-path boundary as the one
// thing standing between the installed process and being selected - a
// live-creator name would leave this property vacuous (masked by
// invariant 1's own mechanism instead of exercising invariant 3's).
const collisionShapeArb = fc.constantFrom('identical', 'similar');

test('property (invariant 3): an installed cloudflared outside the OS temp directory is never selected, whatever its tunnel name collides with', () => {
  fc.assert(
    fc.property(collisionShapeArb, (shape) => {
      const creatorPid = deadPid();
      const fixtureName = nameWithCreator(creatorPid);
      const installedName = shape === 'identical' ? fixtureName : `${fixtureName}-similar`;
      const installedDir = fs.mkdtempSync(path.join(os.homedir(), '.bl1287-prop-installed-'));
      const fixturePid = spawnFakeCloudflared(fixtureName);
      const installedPid = spawnFakeCloudflared(installedName, installedDir);
      try {
        const selected = leakedFixtureTunnelPids(execFileSync);
        assert.ok(
          !selected.includes(installedPid),
          `expected the installed-path pid ${installedPid} (shape=${shape}) to never be selected, got: ${JSON.stringify(selected)}`
        );
        // Non-vacuity: the matching temp-path fixture (same dead-creator
        // name) IS selected - proving the creator check alone would have
        // waved the installed one through too.
        assert.ok(
          selected.includes(fixturePid),
          `expected the matching temp-path fixture pid ${fixturePid} to be selected, got: ${JSON.stringify(selected)}`
        );
      } finally {
        killPid(fixturePid);
        killPid(installedPid);
        fs.rmSync(installedDir, { recursive: true, force: true });
      }
    }),
    { numRuns: 6 }
  );
});

// Non-vacuity, each mutation run for real and restored byte-identical
// afterward (`diff` against a pre-break backup confirmed exact
// restoration):
//   - Invariant 1: reverting leakedFixtureTunnelPids to select unconditionally
//     on temp-path shape alone (dropping the creatingPidFor/isProcessAlive
//     filter) failed on the very first generated case with creatorAlive=true
//     - "expected selected=false, got true" - proving the property actually
//     exercises the creator-liveness discriminator.
//   - Invariant 2: forcing creatingPidFor to always return null (so every
//     fixture falls back to the "unparseable, sweep it" branch) happened to
//     still pass invariant 2 (a dead creator's fixture is still swept
//     either way) but FAILED invariant 1 immediately - confirming the two
//     properties are checking genuinely different halves of the same
//     mechanism, not one masking the other.
//   - Invariant 2 (zombie mode, BL-1287 bounce fix): reverting isProcessAlive
//     to the bare `process.kill(pid, 0)` form (no `ps -o stat=` zombie
//     check) failed immediately on the ZOMBIE case - "expected pid ...
//     (creator died via ZOMBIE) to be selected, got: []" - proving this
//     property actually exercises the zombie window the bounce named,
//     not merely the two already-reaped signal paths.
//   - Invariant 3: reverting the temp-path filter (matching cloudflared
//     anywhere on the host, not only under os.tmpdir()) failed immediately
//     - "expected the installed-path pid ... to never be selected, got
//     [...]" - proving the property is sensitive to the temp-path
//     boundary itself, not merely to some list coming back.
