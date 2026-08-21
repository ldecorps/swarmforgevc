'use strict';

// BL-868: proving the property lane's isolation guards actually intervene
// requires running a REAL test file through the REAL vitest.properties.config.mjs
// - reimplementing what tmpDirSetup.js/envRestoreGuardSetup.js do against a
// mocked runner would only prove the mock agrees with itself. Vitest's
// `include` glob (test/**/*.property.test.js) is resolved relative to the
// config's root (extension/), so a fixture file must briefly exist under
// extension/test/ to be picked up at all - this is the same "temporarily add
// a property test... remove the probe afterwards" procedure BL-868's own
// qa_e2e_procedure describes for manual verification, done here generatively
// and cleaned up unconditionally.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXTENSION_DIR = path.join(__dirname, '..', '..');
const TEST_DIR = path.join(EXTENSION_DIR, 'test');

const trackedFixturePaths = new Set();
let abnormalExitHandlersInstalled = false;

function untrackFixturePath(filePath) {
  trackedFixturePaths.delete(filePath);
}

function removeTrackedFixture(filePath) {
  untrackFixturePath(filePath);
  fs.rmSync(filePath, { force: true });
}

function removeAllTrackedFixtures() {
  for (const filePath of [...trackedFixturePaths]) {
    removeTrackedFixture(filePath);
  }
}

function installAbnormalExitHandlersOnce() {
  if (abnormalExitHandlersInstalled) {
    return;
  }
  abnormalExitHandlersInstalled = true;
  process.on('exit', removeAllTrackedFixtures);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      removeAllTrackedFixtures();
      process.exit(1);
    });
  }
}

function trackFixturePath(filePath) {
  installAbnormalExitHandlersOnce();
  trackedFixturePaths.add(filePath);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A pid still in the process table is not necessarily a running peer.
// SIGKILL a process whose parent has not reaped it yet and it becomes a
// ZOMBIE: the process is dead, but its entry lingers so `kill(pid, 0)`
// still succeeds. That is exactly the case BL-984 exists for - the run is
// over and can never write another fixture, so the pid counts as gone.
// The window is wide in this helper's own idiom: everything here is
// synchronous (spawnSync), so a killed child stays unreaped for as long as
// the event loop is blocked, which is the whole run.
// macOS and Linux both report 'Z' here (the only two target platforms);
// anything else, including a failed `ps`, is read as alive so the sweep
// errs toward keeping a file it is unsure about.
function isZombiePid(pid) {
  const probe = spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
  return probe.status === 0 && /^\s*Z/.test(probe.stdout || '');
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    // EPERM: the pid exists but belongs to another user - alive.
    return err.code === 'EPERM';
  }
  return !isZombiePid(pid);
}

// BL-984: the exit/signal cleanup above is thorough for every exit the
// process can observe, but nothing traps SIGKILL - a kill -9 or OOM kill
// strands the generated fixture inside extension/test/, where the lane's
// include glob collects it on every later run as a false red. The hole
// cannot be closed on the way out, so the guarantee is built on the way
// in: each entry point sweeps stale fixtures BEFORE writing its own.
//
// The sweep is deliberately narrow: only files carrying the given basename
// prefix, only in the helper's own fixture directory, and only those whose
// originating run is gone. A live peer run in the same worktree owns its
// in-flight fixtures, and a human's real *.property.test.js is untouchable.
// Our OWN pid counts as gone: both entry points are synchronous (spawnSync),
// so no other invocation in this process can be mid-run, and this one has
// not written yet - such a file is pid reuse from a run that died.
function sweepStaleFixtures({ basenamePrefix, dir = TEST_DIR, isPidAlive = defaultIsPidAlive } = {}) {
  const generatedName = new RegExp(`^${escapeRegExp(basenamePrefix)}(\\d+)-[0-9a-z]*(?:-\\d+)?\\.property\\.test\\.js$`);
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    const match = generatedName.exec(name);
    if (!match) {
      continue;
    }
    const originPid = Number(match[1]);
    if (originPid === process.pid || !isPidAlive(originPid)) {
      const filePath = path.join(dir, name);
      fs.rmSync(filePath, { force: true });
      removed.push(filePath);
    }
  }
  return removed;
}

function runAsPropertyLaneFixture(source, { basenamePrefix = 'bl868-fixture-', timeout = 30000, env, spawnFn = spawnSync } = {}) {
  sweepStaleFixtures({ basenamePrefix });
  const filename = `${basenamePrefix}${process.pid}-${Math.random().toString(36).slice(2)}.property.test.js`;
  const filePath = path.join(TEST_DIR, filename);
  trackFixturePath(filePath);
  fs.writeFileSync(filePath, source);
  try {
    const result = spawnFn('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', `test/${filename}`], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout,
      env: env || process.env,
    });
    return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
  } finally {
    removeTrackedFixture(filePath);
  }
}

// BL-871 invariant 1: "The property lane's verdict for a given file does
// not depend on how many other property files are running alongside it."
// Proving the pool cap is what makes that true requires running MULTIPLE
// real fixture files through the REAL vitest.properties.config.mjs in a
// SINGLE `vitest run` invocation - runAsPropertyLaneFixture above only ever
// targets one file, which cannot exercise pool sizing across files at all.
function runManyAsPropertyLaneFixtures(sources, { basenamePrefix = 'bl871-fixture-', timeout = 60000, env, spawnFn = spawnSync } = {}) {
  sweepStaleFixtures({ basenamePrefix });
  const files = sources.map((source, index) => {
    const filename = `${basenamePrefix}${process.pid}-${Math.random().toString(36).slice(2)}-${index}.property.test.js`;
    const filePath = path.join(TEST_DIR, filename);
    trackFixturePath(filePath);
    fs.writeFileSync(filePath, source);
    return { filePath, relPath: `test/${filename}` };
  });
  try {
    const result = spawnFn('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', ...files.map((f) => f.relPath)], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout,
      env: env || process.env,
    });
    return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
  } finally {
    files.forEach((f) => removeTrackedFixture(f.filePath));
  }
}

module.exports = { runAsPropertyLaneFixture, runManyAsPropertyLaneFixtures, sweepStaleFixtures };
