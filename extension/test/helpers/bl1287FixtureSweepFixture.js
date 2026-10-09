'use strict';

// BL-1287: fixture builders shared by the property test
// (bl1287FixtureSweepScopingInvariants.property.test.js) and the acceptance
// step handler (bl1287FixtureSweepSparesLiveRunSteps.js) - both built the
// same real-process fixtures independently at mint; factored out here at
// the cleaner stage (bounce-fix pass, 2026-09-05) so the fixture shape is
// defined once. Real processes throughout - never a fabricated process
// table, matching this ticket's own house style.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./tmpDir');
const { SHELL_DASH_C_RE } = require('./fixtureTunnelName');

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// A real, harmless background process whose command line contains
// "run <name>" the way a real cloudflared invocation would, launched from
// a script under `dir` (defaults to a fresh temp directory - the fixture
// shape leakedFixtureTunnelPids scopes to).
function spawnFakeCloudflared(name, dir) {
  const binDir = dir || mkTmpDir('bl1287-fake-cf-');
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
  const pid = Number(child.stdout.toString().trim());
  waitForOwnArgv(pid);
  return pid;
}

// Hotfix 2026-10-09 (QA note 003958, BL-2082 held): `& echo $!` hands back
// the background child's pid before that child has exec'd the fake
// cloudflared. Until it does, ps shows the spawning shell's own `bash -c`
// line, which leakedFixtureTunnelPids drops on purpose (BL-1974,
// SHELL_DASH_C_RE), so a sweep sampled in that window missed a fixture it
// had to select - bl1287 invariant 1 failed that way under load, with a
// hardener Stryker run live. Return only once ps shows the child's own
// argv, bounded so a child that never gets there still returns.
const OWN_ARGV_DEADLINE_MS = 10000;

function waitForOwnArgv(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const start = Date.now();
  while (Date.now() - start < OWN_ARGV_DEADLINE_MS) {
    const ps = spawnSync('ps', ['-ww', '-o', 'pid=,args=', '-p', String(pid)], { encoding: 'utf8' });
    const line = (ps.stdout || '').trim();
    if (ps.status !== 0 || !line) return;
    if (!SHELL_DASH_C_RE.test(line)) return;
    Atomics.wait(sleeper, 0, 0, 10);
  }
}

// A tunnel name in fixtureTunnelName()'s own shape, but with an EXPLICIT
// creator pid rather than this process's own - the same read-back seam
// leakedFixtureTunnelPids itself relies on.
function nameWithCreator(creatorPid) {
  return `sfvc-test-${creatorPid}-1-bl1287-${Math.random().toString(36).slice(2, 8)}`;
}

// A pid guaranteed dead: spawnSync waits for the child to fully exit
// before returning, so its pid has already been reaped by the time this
// function returns.
function deadPid() {
  const child = spawnSync('true', []);
  return child.pid;
}

module.exports = { killPid, spawnFakeCloudflared, nameWithCreator, deadPid };
