'use strict';

// BL-1797: step handlers for "The ollama gate test runs its own stub
// whatever zshenv puts first". Drives the REAL
// swarmforge/scripts/test/test_ollama_ancillary_launch_gate.sh with a real
// zsh -c launch, ZDOTDIR pointed at a decoy fixture - never a
// reimplementation of the test's own logic. Handler lands in the SAME
// commit as the feature (BL-233, BL-1371).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1797 The ollama gate test runs its own stub whatever zshenv puts first';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_ollama_ancillary_launch_gate.sh');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a zsh startup directory whose \.zshenv puts a decoy ollama first on PATH$/, (ctx) => {
    const zdotdir = trackedTmpRoot('sfvc-bl1797-zdotdir-');
    const decoyMarker = path.join(zdotdir, 'decoy-ran');
    const decoyBin = path.join(zdotdir, 'decoybin');
    fs.mkdirSync(decoyBin, { recursive: true });
    fs.writeFileSync(
      path.join(decoyBin, 'ollama'),
      `#!/usr/bin/env bash\necho "\$\$" >> ${JSON.stringify(decoyMarker)}\nexit 1\n`
    );
    fs.chmodSync(path.join(decoyBin, 'ollama'), 0o755);
    fs.writeFileSync(path.join(zdotdir, '.zshenv'), `export PATH="${decoyBin}:$PATH"\n`);
    ctx.bl1797 = { zdotdir, decoyMarker };
  });

  scoped(/^the ollama ancillary launch gate test runs with that startup directory$/, (ctx) => {
    const { zdotdir } = ctx.bl1797;
    const env = { ...process.env, ZDOTDIR: zdotdir };
    delete env.SWARMFORGE_OLLAMA_BINARY;
    const result = spawnSync('bash', [GATE_TEST], { encoding: 'utf8', env, timeout: 60000 });
    ctx.bl1797.rc = result.status ?? 1;
    ctx.bl1797.out = result.stdout || '';
    ctx.bl1797.err = result.stderr || '';
  });

  scoped(/^it prints ALL PASS and exits 0$/, (ctx) => {
    const { rc, out, err } = ctx.bl1797;
    assert.equal(rc, 0, `expected the gate test to exit 0, got ${rc}: ${out}${err}`);
    assert.match(out, /^ALL PASS$/m, `expected ALL PASS, got: ${out}`);
  });

  scoped(/^the decoy never ran$/, (ctx) => {
    assert.ok(
      !fs.existsSync(ctx.bl1797.decoyMarker),
      `expected the decoy ollama to never run, but its marker exists: ${ctx.bl1797.decoyMarker}`
    );
  });
}

module.exports = { registerSteps };
