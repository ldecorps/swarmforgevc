'use strict';

// BL-1979 D1 (QA bounce 2026-10-06): scaffoldStepHandler.test.js and
// scaffoldStepHandlerInvariants.property.test.js each built mkdtemp
// fixture roots with fs.mkdtempSync(path.join(os.tmpdir(), '<prefix>-'))
// and never removed them - every run leaked (6 per unit run, 160 per
// property run). Shared here rather than duplicated in both files.
//
// Mirrors the engineering rule (BL-971/BL-1385/BL-1390, extension/test's
// own sweepStaleTmpDirs): name each root `<prefix><pid>-...` so a sweep
// can tell which roots are this process's own (or a dead process's) apart
// from a live peer's, remove this process's own roots in a per-test
// t.after (never waiting for process exit), and sweep stale roots - dead
// owner pid - before the run too, so a killed run's leftovers clear on
// the next run rather than accumulating forever.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err.code === 'EPERM';
  }
  return true;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Removes every root under os.tmpdir() named `<prefix><pid>-...` whose
// owner pid is dead, or is this process's own (left by an earlier test in
// the same run that skipped its own t.after, e.g. a thrown assertion
// before registration) - never a live peer's.
function sweepStaleTmpDirs(prefix) {
  const ownedName = new RegExp(`^${escapeRegExp(prefix)}(\\d+)-`);
  const dir = os.tmpdir();
  for (const name of fs.readdirSync(dir)) {
    const match = ownedName.exec(name);
    if (!match) continue;
    const ownerPid = Number(match[1]);
    if (ownerPid === process.pid || !isPidAlive(ownerPid)) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }
}

// Creates an owned, owner-pid-named mkdtemp root under the given prefix
// and registers it for removal in the test context's own t.after - never
// left for process exit. `t` is the node:test TestContext (first
// parameter of a `test('...', (t) => {...})` callback); every call site
// passes it through.
function mkOwnedTmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${process.pid}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

module.exports = { sweepStaleTmpDirs, mkOwnedTmpDir };
