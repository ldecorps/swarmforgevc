'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-797 invariant (property authorship rests with the coder, first pass -
// BL-654): "A missing or failing host probe binary never crashes the gate:
// every probe degrades to its documented fallback (nproc -> sysctl ->
// default 4 cores; uptime -> 0.0 load), whatever combination is absent."
//
// Drives the REAL mutation_cooldown_gate.bb under a PATH restricted to a
// throwaway fixture bin dir (never the real host's PATH, so results are
// deterministic regardless of what this machine actually has installed).
// "Missing" and "failing" are DISTINCT failure modes in babashka - a probe
// binary that does not exist at all makes process/sh THROW, while a probe
// binary that exists but exits nonzero returns normally - so both are
// generated for each of the three probes, never just one.
//
// Generator reach: the invariant quantifies over "whatever combination is
// absent" - all 3^3 = 27 (success | fail | absent) states across the three
// probes. Rather than leave that to chance (a uniform random draw would give
// a non-trivial chance of never sampling a specific rare combination), every
// one of the 27 combinations is exhaustively iterated in the loop below;
// fast-check only randomizes the reported magnitudes (cores / load) within
// each combination, so the numeric parsing path is still fuzzed. Stub probe
// scripts use an absolute `#!/bin/bash` shebang - never `#!/usr/bin/env
// bash` - because under a PATH this narrow, `env` itself cannot resolve
// `bash` by searching a PATH that doesn't contain it.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mutation_cooldown_gate.bb');
const BB_BIN = execFileSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' }).trim();
const GIT_BIN = execFileSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).trim();

const PROBE_STATES = ['success', 'fail', 'absent'];
const ALL_COMBOS = [];
for (const nproc of PROBE_STATES) {
  for (const sysctl of PROBE_STATES) {
    for (const uptime of PROBE_STATES) {
      ALL_COMBOS.push({ nproc, sysctl, uptime });
    }
  }
}

function makeRepo() {
  const root = mkTmpDir('bl797-prop-repo-');
  execFileSync(GIT_BIN, ['-C', root, 'init', '-q', '-b', 'main']);
  execFileSync(GIT_BIN, ['-C', root, 'config', 'user.email', 'test@test']);
  execFileSync(GIT_BIN, ['-C', root, 'config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    'config active_backlog_max_depth 5\nconfig mutation_cooldown_days 3\n'
  );
  const file = path.join(root, 'src', 'thing.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export const thing = 1;\n');
  execFileSync(GIT_BIN, ['-C', root, 'add', '-A']);
  execFileSync(GIT_BIN, ['-C', root, 'commit', '-q', '-m', 'seed']);
  return { root, file };
}

function writeStub(binDir, name, state, successBody) {
  if (state === 'absent') return;
  const body = state === 'success' ? successBody : 'exit 1';
  const target = path.join(binDir, name);
  fs.writeFileSync(target, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(target, 0o755);
}

test(
  'property (invariant): a missing or failing probe never crashes the gate, for every combination of probe states',
  () => {
    const { root, file } = makeRepo();

    for (const combo of ALL_COMBOS) {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 128 }),
          fc.integer({ min: 1, max: 128 }),
          fc.integer({ min: 0, max: 6400 }),
          (nprocCores, sysctlCores, loadCentiunits) => {
            const uptimeLoad = (loadCentiunits / 100).toFixed(2);
            const binDir = mkTmpDir('bl797-prop-bin-');
            fs.symlinkSync(GIT_BIN, path.join(binDir, 'git'));
            writeStub(binDir, 'nproc', combo.nproc, `echo ${nprocCores}`);
            writeStub(binDir, 'sysctl', combo.sysctl, `echo ${sysctlCores}`);
            writeStub(binDir, 'uptime', combo.uptime, `echo "load average: ${uptimeLoad}, 0.10, 0.05"`);

            const result = spawnSync(BB_BIN, [GATE, root, file], {
              encoding: 'utf8',
              env: { PATH: binDir },
              timeout: 15000,
            });

            assert.equal(
              result.status,
              0,
              `expected exit 0 (never a crash) for nproc=${combo.nproc} sysctl=${combo.sysctl} uptime=${combo.uptime}, got ${result.status}: ${result.stdout}${result.stderr}`
            );
            const out = result.stdout;
            assert.match(out, /^DECISION: /m, `expected a DECISION line for ${JSON.stringify(combo)}: ${out}${result.stderr}`);

            const expectedCores = combo.nproc === 'success' ? nprocCores : combo.sysctl === 'success' ? sysctlCores : 4;
            assert.match(
              out,
              new RegExp(`cores: ${expectedCores}\\b`),
              `nproc=${combo.nproc} sysctl=${combo.sysctl}: expected cores: ${expectedCores}, got: ${out}`
            );

            const expectedLoad = combo.uptime === 'success' ? uptimeLoad : '0.00';
            assert.match(
              out,
              new RegExp(`load_avg: ${expectedLoad.replace('.', '\\.')}\\b`),
              `uptime=${combo.uptime}: expected load_avg: ${expectedLoad}, got: ${out}`
            );
          }
        ),
        { numRuns: 1 }
      );
    }
  },
  120000
);
