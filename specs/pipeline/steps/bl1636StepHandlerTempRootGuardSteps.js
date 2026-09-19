'use strict';

// BL-1636: step handlers for "A step handler never leaks its temp root".
// Drives the REAL finder (extension/test/helpers/stepHandlerTmpRootFinder.js,
// out/-compiled reach not needed - it is plain JS, required directly) and
// the REAL reap script (specs/pipeline/scripts/reap_stale_tmp_roots.js)
// against real fixture directories under mkdtemp - never a reimplementation
// of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { onAbnormalExit } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1636 A step handler never leaks its temp root';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_TEST_DIR = path.join(REPO_ROOT, 'extension', 'test');

const { findStepHandlerTmpRootOffenders } = require(
  path.join(EXTENSION_TEST_DIR, 'helpers', 'stepHandlerTmpRootFinder')
);
const { reapStaleTmpRoots } = require(path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'reap_stale_tmp_roots'));

const trackedDirs = new Set();
function trackDir(dir) {
  trackedDirs.add(dir);
  return () => {
    if (trackedDirs.delete(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
onAbnormalExit(() => {
  for (const dir of Array.from(trackedDirs)) {
    trackedDirs.delete(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
});

function cleanupFixtureRoot(ctx) {
  if (ctx.cleanupBl1636Root) {
    ctx.cleanupBl1636Root();
    ctx.cleanupBl1636Root = undefined;
  }
}

function ensure(ctx) {
  if (!ctx.bl1636) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1636-'));
    ctx.cleanupBl1636Root = trackDir(root);
    ctx.bl1636 = { root };
  }
  return ctx.bl1636;
}

const OFFENDING_HANDLER = `'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
function registerSteps(registry) {
  registry.defineScoped(/^unused$/, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-offender-'));
  }, 'unused');
}
module.exports = { registerSteps };
`;

const REGISTERING_HANDLER = `'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { track } = require('./lib/fixtureReaper');
function registerSteps(registry) {
  registry.defineScoped(/^unused$/, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-registering-'));
    track(root);
  }, 'unused');
}
module.exports = { registerSteps };
`;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture handler directory holding one handler that creates a temp root and never registers it and one that registers its root with the fixture reaper$/,
    (ctx) => {
      const st = ensure(ctx);
      fs.writeFileSync(path.join(st.root, 'bl9001OffenderSteps.js'), OFFENDING_HANDLER);
      fs.writeFileSync(path.join(st.root, 'bl9002RegisteringSteps.js'), REGISTERING_HANDLER);
    }
  );

  scoped(/^the temp-root guard scans that directory against an empty census$/, (ctx) => {
    ctx.bl1636.offenders = findStepHandlerTmpRootOffenders(ctx.bl1636.root);
  });

  scoped(/^it names the unregistering handler as an offender$/, (ctx) => {
    assert.ok(ctx.bl1636.offenders.includes('bl9001OffenderSteps.js'), `expected bl9001OffenderSteps.js among offenders, got: ${JSON.stringify(ctx.bl1636.offenders)}`);
  });

  scoped(/^it does not name the registering handler$/, (ctx) => {
    try {
      assert.ok(!ctx.bl1636.offenders.includes('bl9002RegisteringSteps.js'), `expected bl9002RegisteringSteps.js NOT among offenders, got: ${JSON.stringify(ctx.bl1636.offenders)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  scoped(
    /^a fixture handler directory holding one handler that registers its root with the fixture reaper$/,
    (ctx) => {
      const st = ensure(ctx);
      fs.writeFileSync(path.join(st.root, 'bl9002RegisteringSteps.js'), REGISTERING_HANDLER);
    }
  );

  scoped(/^a census naming that handler as an offender$/, (ctx) => {
    ctx.bl1636.staleCensus = new Set(['bl9002RegisteringSteps.js']);
  });

  scoped(/^the temp-root guard scans that directory against that census$/, (ctx) => {
    const offenders = new Set(findStepHandlerTmpRootOffenders(ctx.bl1636.root));
    const stale = [...ctx.bl1636.staleCensus].filter((f) => !offenders.has(f));
    ctx.bl1636.staleEntries = stale;
  });

  scoped(/^it fails naming the stale census entry$/, (ctx) => {
    try {
      assert.deepEqual(ctx.bl1636.staleEntries, ['bl9002RegisteringSteps.js']);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  scoped(/^the temp-root guard scans specs\/pipeline\/steps against the committed census$/, (ctx) => {
    ensure(ctx);
    const stepsDir = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
    const censusPath = path.join(EXTENSION_TEST_DIR, 'step-handler-tmp-root-census.txt');
    const census = new Set(
      fs.readFileSync(censusPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    );
    const offenders = new Set(findStepHandlerTmpRootOffenders(stepsDir));
    ctx.bl1636.realTreeCensus = census;
    ctx.bl1636.realTreeNewOffenders = [...offenders].filter((f) => !census.has(f));
  });

  scoped(/^it names no offender outside the census$/, (ctx) => {
    assert.deepEqual(ctx.bl1636.realTreeNewOffenders, []);
  });

  scoped(/^the census names at least 400 handlers$/, (ctx) => {
    try {
      assert.ok(ctx.bl1636.realTreeCensus.size >= 400, `expected at least 400, got ${ctx.bl1636.realTreeCensus.size}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── Scenario Outline 04 (the reap) ─────────────────────────────────────

  const DAY_MS = 24 * 60 * 60 * 1000;

  scoped(/^a fixture temp directory holding a bl-prefixed root that is (.+)$/, (ctx, rootKind) => {
    const st = ensure(ctx);
    let name;
    let ageMs;
    let alivePid;
    if (rootKind === 'two days old with no owner pid in its name') {
      name = 'bl-no-owner-old';
      ageMs = 2 * DAY_MS;
    } else if (rootKind === 'one hour old with no owner pid in its name') {
      name = 'bl-no-owner-young';
      ageMs = 60 * 60 * 1000;
    } else if (rootKind === 'two days old and named for a live pid') {
      alivePid = process.pid; // this very process - unambiguously alive.
      name = `bl${alivePid}-owned-old`;
      ageMs = 2 * DAY_MS;
    } else {
      throw new Error(`unknown root kind: ${rootKind}`);
    }
    const fullPath = path.join(st.root, name);
    fs.mkdirSync(fullPath);
    const mtime = new Date(Date.now() - ageMs);
    fs.utimesSync(fullPath, mtime, mtime);
    ctx.bl1636.rootPath = fullPath;
    ctx.bl1636.expectedOutcome = rootKind.endsWith('no owner pid in its name') && ageMs > DAY_MS ? 'removed' : 'survives';
  });

  scoped(/^the stale temp-root reap runs on that directory with a floor of 24 hours$/, (ctx) => {
    ctx.bl1636.removed = reapStaleTmpRoots({
      dir: ctx.bl1636.root,
      prefix: 'bl',
      olderThanHoursFloor: 24,
    });
  });

  scoped(/^the root (is removed|survives)$/, (ctx, outcome) => {
    try {
      const wasRemoved = ctx.bl1636.removed.includes(ctx.bl1636.rootPath);
      if (outcome === 'is removed') {
        assert.ok(wasRemoved, `expected ${ctx.bl1636.rootPath} to be removed`);
        assert.equal(fs.existsSync(ctx.bl1636.rootPath), false);
      } else {
        assert.ok(!wasRemoved, `expected ${ctx.bl1636.rootPath} to survive`);
        assert.equal(fs.existsSync(ctx.bl1636.rootPath), true);
      }
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });
}

module.exports = { registerSteps };
