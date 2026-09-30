'use strict';

// BL-1797 declared invariant (coder-authored). Runs via npm run test:properties.
//
// "Each scenario of test_ollama_ancillary_launch_gate.sh launches the stub
// it wrote, named through SWARMFORGE_OLLAMA_BINARY's absolute path, never
// a binary that PATH order under zsh -c selects."
//
// Drives the REAL gate test script (never a reimplementation of its
// launch logic) under GENERATED .zshenv decoys - varying how many decoy
// PATH segments a hostile zshenv stacks ahead of the fixture bin, and
// whether the decoy itself claims success (exit 0) or failure (exit 1) -
// the acceptance feature's own scenario fixes both of those at one point
// each; this property sweeps the space the fix must be robust over.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_ollama_ancillary_launch_gate.sh');

function buildDecoyZdotdir(decoyCount, decoyExitCode) {
  const zdotdir = mkTmpDir('sfvc-bl1797-prop-');
  const marker = path.join(zdotdir, 'decoy-ran');
  const pathParts = [];
  for (let i = 0; i < decoyCount; i += 1) {
    const decoyBin = path.join(zdotdir, `decoy${i}`);
    fs.mkdirSync(decoyBin, { recursive: true });
    fs.writeFileSync(
      path.join(decoyBin, 'ollama'),
      `#!/usr/bin/env bash\necho "\$\$ decoy${i}" >> ${JSON.stringify(marker)}\nexit ${decoyExitCode}\n`
    );
    fs.chmodSync(path.join(decoyBin, 'ollama'), 0o755);
    pathParts.push(decoyBin);
  }
  fs.writeFileSync(path.join(zdotdir, '.zshenv'), `export PATH="${pathParts.join(':')}:$PATH"\n`);
  return { zdotdir, marker };
}

test('BL-1797 invariant: the gate test always launches its own stub through SWARMFORGE_OLLAMA_BINARY, whatever PATH decoys a hostile zshenv stacks ahead of it', () => {
  let reached = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }), // how many decoy PATH segments
      fc.constantFrom(0, 1), // whether the decoy itself claims success or failure
      (decoyCount, decoyExitCode) => {
        reached += 1;
        const { zdotdir, marker } = buildDecoyZdotdir(decoyCount, decoyExitCode);
        const env = { ...process.env, ZDOTDIR: zdotdir };
        delete env.SWARMFORGE_OLLAMA_BINARY;
        const result = spawnSync('bash', [GATE_TEST], { encoding: 'utf8', env, timeout: 60000 });
        const rc = result.status ?? 1;
        const out = result.stdout || '';
        const err = result.stderr || '';

        assert.equal(
          rc,
          0,
          `decoyCount=${decoyCount} decoyExitCode=${decoyExitCode}: expected the gate test to exit 0, got ${rc}: ${out}${err}`
        );
        assert.match(out, /^ALL PASS$/m, `decoyCount=${decoyCount} decoyExitCode=${decoyExitCode}: expected ALL PASS, got: ${out}`);
        assert.ok(
          !fs.existsSync(marker),
          `decoyCount=${decoyCount} decoyExitCode=${decoyExitCode}: expected the decoy to never run, but its marker exists`
        );
      }
    ),
    { numRuns: 6 }
  );
  assert.ok(reached >= 6, `generator reach floor: expected at least 6 runs, got ${reached}`);
});
