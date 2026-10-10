'use strict';

// BL-2116: step handlers for "a killed non-vacuity probe leaves nothing in
// the checkout". The scenario drives a child node process that creates a
// scratch root and writes a broken copy, then sleeps (simulating a killed
// run). The parent SIGKILLs the child before its cleanup runs, checks the
// checkout is clean, then calls createScratchRoot with the same prefix and
// verifies the dead child's root is reaped.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const nonVacuityProbe = require('../../../extension/test/helpers/nonVacuityProbe.js');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'BL-2116 A killed non-vacuity probe leaves nothing in the checkout';

// A child-process script that creates a scratch root, writes a broken copy,
// writes its PID to a file, then sleeps forever (so the parent can SIGKILL
// it before cleanup runs).
function childScript(prefix, pidFile, rootFile) {
  const helperPath = path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'nonVacuityProbe.js');
  return [
    `const { createScratchRoot, writeBrokenCopy } = require('${helperPath}');`,
    'const fs = require("fs");',
    'const path = require("path");',
    `const { root } = createScratchRoot('${prefix}${process.pid}-');`,
    `writeBrokenCopy(root, 'swarmforge/scripts/chase_sweep_lib.bb', (text) => text + "\\n;; BROKEN");`,
    `fs.writeFileSync('${pidFile}', String(process.pid));`,
    `fs.writeFileSync('${rootFile}', root);`,
    '// Sleep forever so the parent can SIGKILL us before cleanup runs.',
    'require("child_process").execSync("sleep infinity", { stdio: "inherit" });',
  ].join('\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given: a probe that has written its broken copy in a child process ──
  scoped(/^a probe that has written its broken copy in a child process$/, async (ctx) => {
    const prefix = 'bl2116-probe-';
    const pidFile = path.join('/tmp', `bl2116-pid-${process.pid}-${Date.now()}.txt`);
    const rootFile = path.join('/tmp', `bl2116-root-${process.pid}-${Date.now()}.txt`);
    const childFile = path.join('/tmp', `bl2116-child-${process.pid}-${Date.now()}.js`);
    const script = childScript(prefix, pidFile, rootFile);
    fs.writeFileSync(childFile, script);

    // Spawn the child process, detached so it outlives this spawnSync call
    const child = spawn('node', [childFile], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'pipe',
    });

    ctx._child = child;
    ctx._childPidFile = pidFile;
    ctx._childRootFile = rootFile;
    ctx._childPrefix = prefix;
    ctx._childScript = childFile;

    // Wait for the child to write its PID file (up to 2 seconds)
    for (let waited = 0; waited < 2000; waited += 100) {
      if (fs.existsSync(pidFile)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  // ── When: the child process is killed before its cleanup runs ──────────
  scoped(/^the child process is killed before its cleanup runs$/, (ctx) => {
    const pidFile = ctx._childPidFile;
    assert.ok(fs.existsSync(pidFile), `PID file ${pidFile} does not exist`);
    const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    try {
      process.kill(childPid, 'SIGKILL');
    } catch {
      // Already dead - fine
    }
    ctx._childPid = childPid;
  });

  // ── Then: no path carrying the child's pid is under the checkout ──────
  scoped(/^no path carrying the child's pid is under the checkout$/, (ctx) => {
    const childPid = ctx._childPid;
    const pidStr = String(childPid);

    // Walk the checkout looking for files containing the child PID.
    // Skip node_modules, .stryker-tmp, .git, venv, and other large non-checkout dirs.
    // Use path-based matching so nested dirs like extension/node_modules are also skipped.
    const SKIP_PREFIXES = [
      'node_modules',
      '.stryker-tmp',
      '.git',
      'venv',
      'swarmforge/vendor',
      'swarmforge/vendor/aps',
    ];
    function shouldSkip(fullPath) {
      for (const prefix of SKIP_PREFIXES) {
        if (fullPath.includes(`/${prefix}/`) || fullPath.endsWith(`/${prefix}`)) return true;
      }
      return false;
    }
    function walk(dir) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === '.git') continue;
        const fullPath = path.join(dir, entry);
        if (shouldSkip(fullPath)) continue;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            assert.ok(!content.includes(pidStr), `found child PID ${pidStr} in ${fullPath}`);
          } catch {
            // Binary file or permission error - skip
          }
        }
      }
    }
    walk(REPO_ROOT);
  });

  // ── And: the next probe run reaps the dead child's temporary root ─────
  scoped(/^the next probe run reaps the dead child's temporary root$/, (ctx) => {
    const prefix = ctx._childPrefix;
    const childPid = ctx._childPid;

    // Read the child's scratch root path from the file the child wrote
    const rootFile = ctx._childRootFile;
    assert.ok(fs.existsSync(rootFile), `root file ${rootFile} does not exist`);
    const childRootPath = fs.readFileSync(rootFile, 'utf8').trim();

    // Verify the child process is dead
    try {
      process.kill(childPid, 0);
      assert.fail(`child process ${childPid} is still alive`);
    } catch {
      // Process is dead - expected
    }

    // Verify the child's scratch root still exists (wasn't cleaned up)
    assert.ok(fs.existsSync(childRootPath), `child's root ${childRootPath} should still exist before next probe run`);

    // Now call createScratchRoot with the same prefix - this should reap
    // the dead child's root via sweepStaleTmpDirs
    const { root: newRoot, cleanup } = nonVacuityProbe.createScratchRoot(prefix);

    // Verify the dead child's root is gone
    assert.ok(!fs.existsSync(childRootPath), `dead child's root ${childRootPath} still exists after next probe run`);

    // Clean up the new root
    cleanup();
  });
}

module.exports = { registerSteps };
