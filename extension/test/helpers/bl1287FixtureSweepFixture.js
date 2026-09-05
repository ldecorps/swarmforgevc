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
  return Number(child.stdout.toString().trim());
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
