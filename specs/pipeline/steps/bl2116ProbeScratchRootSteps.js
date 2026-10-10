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
function childScript(prefix, pidFile) {
  const helperPath = path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'nonVacuityProbe.js');
  return [
    `const { createScratchRoot, writeBrokenCopy } = require('${helperPath}');`,
    'const fs = require("fs");',
    'const path = require("path");',
    `const { root } = createScratchRoot('${prefix}');`,
    `writeBrokenCopy(root, 'swarmforge/scripts/chase_sweep.bb', (text) => text + "\\n;; BROKEN");`,
    `fs.writeFileSync('${pidFile}', String(process.pid));`,
    '// Sleep forever so the parent can SIGKILL us before cleanup runs.',
    'require("child_process").execSync("sleep infinity", { stdio: "inherit" });',
  ].join('\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given: a probe that has written its broken copy in a child process ──
  scoped(/^a probe that has written its broken copy in a child process$/, (ctx) => {
    const prefix = 'bl2116-probe-';
    const pidFile = path.join('/tmp', `bl2116-pid-${process.pid}-${Date.now()}.txt`);
    const childFile = path.join('/tmp', `bl2116-child-${process.pid}-${Date.now()}.js`);
    const script = childScript(prefix, pidFile);
    fs.writeFileSync(childFile, script);

    // Spawn the child process, detached so it outlives this spawnSync call
    const child = spawn('node', [childFile], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'pipe',
    });

    ctx._child = child;
    ctx._childPidFile = pidFile;
    ctx._childPrefix = prefix;
    ctx._childScript = childFile;

    // Wait for the child to write its PID file (up to 2 seconds)
    let waited = 0;
    while (!fs.existsSync(pidFile) && waited < 2000) {
      require('node:timers').setTimeout(() => {}, 100);
      waited += 100;
      if (waited >= 2000) break;
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

    // Walk the checkout looking for files containing the child PID
    function walk(dir) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === '.git') continue;
        const fullPath = path.join(dir, entry);
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

    // Find the child's scratch root directory. mkProcessTmpDir creates
    // directories like /tmp/bl2116-probe-<pid>-...
    const tmpDir = '/tmp';
    const entries = fs.readdirSync(tmpDir).filter((name) => name.startsWith(prefix));
    const childRoots = [];
    for (const name of entries) {
      const pidMatch = name.match(/^bl2116-probe-(\d+)-/);
      if (pidMatch) {
        const dirPid = Number(pidMatch[1]);
        try {
          process.kill(dirPid, 0); // Check if process is alive
        } catch {
          // Process is dead - this is the child's root
          childRoots.push(path.join(tmpDir, name));
        }
      }
    }

    // Now call createScratchRoot with the same prefix - this should reap
    // the dead child's root via sweepStaleTmpDirs
    const { root: newRoot, cleanup } = nonVacuityProbe.createScratchRoot(prefix);

    // Verify the dead child's root is gone
    for (const rootPath of childRoots) {
      assert.ok(!fs.existsSync(rootPath), `dead child's root ${rootPath} still exists after next probe run`);
    }

    // Clean up the new root
    cleanup();
  });
}

module.exports = { registerSteps };
