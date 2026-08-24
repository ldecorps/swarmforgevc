'use strict';

// BL-1106 declared invariants (coder first authorship — BL-654):
//
// 1. Every input to the effective-depth decision resolves at the repository's
//    master checkout — configured cap, throttle recommendation and pause alike.
// 2. A non-git scratch root and a never-launched repository keep today's
//    stdout and exit code (BL-966 invariant 3, unchanged).
//
// Encoded by driving effective_backlog_depth_cli.bb against master vs
// worktree (with a real pause on master only) and against a plain temp dir.
//
// Non-vacuity: temporarily point pause-marker-path at raw project-root →
// worktree prints 7 while master prints 0. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'backlog_depth_lib.bb');

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function writeConf(root, cap) {
  fs.mkdirSync(path.join(root, 'swarmforge', 'packs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config active_backlog_max_depth ${cap}\n`
  );
  const pack = path.join(root, 'swarmforge', 'packs', 'big.conf');
  fs.writeFileSync(pack, 'config active_backlog_max_depth 7\n');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm-identity'),
    `active_backlog_max_depth_conf_path\t${pack}\n`
  );
  const toolsDir = path.join(root, 'extension', 'out', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'emit-throttle-recommendation.js'), 'process.exit(0);\n');
}

function depthCli(root) {
  const r = spawnSync('bb', [CLI, root], { encoding: 'utf8' });
  return { exit: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}

function mkLinkedPair() {
  const master = mkTmpDir('sfvc-bl1106-prop-');
  fs.writeFileSync(path.join(master, 'README.md'), 'x\n');
  git(master, ['init', '-q', '-b', 'main']);
  git(master, ['add', '-A']);
  git(master, ['commit', '-q', '-m', 'init']);
  writeConf(master, 3);
  const worktree = `${master}-wt`;
  git(master, ['worktree', 'add', '-q', worktree, `-b`, `wt-${Date.now()}`]);
  writeConf(worktree, 3);
  return { master, worktree };
}

test(
  'BL-1106/BL-654 invariant 1: pause + throttle paths resolve at identity-root for every checkout',
  () => {
    const { master, worktree } = mkLinkedPair();
    fs.mkdirSync(path.join(master, '.swarmforge', 'operator'), { recursive: true });
    fs.writeFileSync(
      path.join(master, '.swarmforge', 'operator', 'control-pause.json'),
      JSON.stringify({ active: true })
    );
    // Throttle sidecar only on master — worktree must still see it.
    fs.mkdirSync(path.join(master, '.swarmforge', 'coordinator'), { recursive: true });
    fs.writeFileSync(
      path.join(master, '.swarmforge', 'coordinator', 'throttle-recommendation.json'),
      JSON.stringify({ recommendedCap: 2 })
    );

    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom(master, worktree), (root) => {
        draws += 1;
        // With pause active, effective depth is 0 regardless of throttle.
        const d = depthCli(root);
        assert.equal(d.exit, 0);
        assert.equal(d.out, '0', `pause must win from ${root}: ${JSON.stringify(d)}`);

        const pausePath = execFileSync(
          'bb',
          [
            '-e',
            `(load-file "${LIB}") (println (str (backlog-depth-lib/pause-marker-path "${root}")))`,
          ],
          { encoding: 'utf8' }
        ).trim();
        const throttlePath = execFileSync(
          'bb',
          [
            '-e',
            `(load-file "${LIB}") (println (str (backlog-depth-lib/throttle-recommendation-path "${root}")))`,
          ],
          { encoding: 'utf8' }
        ).trim();
        assert.ok(pausePath.startsWith(master), `pause path must be under master, got ${pausePath}`);
        assert.ok(
          throttlePath.startsWith(master),
          `throttle path must be under master, got ${throttlePath}`
        );
      }),
      { numRuns: 6 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('BL-1106/BL-654 invariant 2: non-git scratch root keeps exit 0 and a numeric cap', () => {
  const plain = mkTmpDir('sfvc-bl1106-plain-');
  fs.mkdirSync(path.join(plain, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(plain, 'swarmforge', 'swarmforge.conf'),
    'config active_backlog_max_depth 3\n'
  );
  const toolsDir = path.join(plain, 'extension', 'out', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'emit-throttle-recommendation.js'), 'process.exit(0);\n');

  const d = depthCli(plain);
  assert.equal(d.exit, 0);
  assert.match(d.out, /^-?\d+$/);
});
