'use strict';

// BL-1905: step handlers for "An acceptance step handler never runs a real
// receive or completion dispatcher from its fixture". The dispatcher set is
// derived from BL-998's guard (lib/realDispatcherScan.js reads its step 1+1b
// self-rooting set and keeps the receive and completion members), and the
// scan parses the REAL specs/pipeline/steps tree. Scenario 03's synthetic
// handler is written under a tracked mkdtemp (BL-1636) and scanned there,
// never added to the real steps dir.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const { STEPS_DIR, dispatcherNames, scanDir } = require('./lib/realDispatcherScan');

const FEATURE =
  'BL-1905 An acceptance step handler never runs a real receive or completion dispatcher from its fixture';

// Scenario 02's census (backlog/evidence/BL-1905-census-20261002.md): the
// handlers that only NAME a real dispatcher. KNOWN_VALUES for the step's list.
const NAME_ONLY = new Set([
  'bl1611DriftGuardSeesBatchParcelSteps.js',
  'bl1642QaApprovalCompletesOnNoteEvidenceSteps.js',
  'bl1645EvidenceWindowOpensAtCreationSteps.js',
  'complianceBatterySteps.js',
]);

// bl1317AdaptEffortSteps.js's shape on 2026-10-02: the real completion
// helper, started with the fixture as cwd.
const SYNTHETIC = `'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
function complete(ctx) {
  return spawnSync('bb', [path.join(SCRIPTS_DIR, 'done_with_current_task.bb'), '--no-op', 'fixture'], {
    cwd: ctx.fixtureRoot,
    encoding: 'utf8',
  });
}
module.exports = { complete };
`;
const SYNTHETIC_NAME = 'syntheticRealDispatcherSteps.js';

function listOf(text) {
  return text.split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the receive and completion dispatchers that cd into their own scripts dir$/, (ctx) => {
    const names = dispatcherNames();
    // The closure matters: step 1 alone misses the completion helpers, whose
    // trailing receive is what escaped on 2026-10-02.
    assert.ok(names.includes('done_with_current_task.bb'), `derived set lacks done_with_current_task.bb: ${names}`);
    assert.ok(names.includes('ready_for_next.bb'), `derived set lacks ready_for_next.bb: ${names}`);
    ctx.bl1905 = { names };
  });

  scoped(/^every step handler under specs\/pipeline\/steps is scanned for a real-scripts-dir path to one of those dispatchers$/, (ctx) => {
    ctx.bl1905.results = scanDir(STEPS_DIR, ctx.bl1905.names);
  });

  scoped(/^no handler passes such a path to a process it starts$/, (ctx) => {
    const flagged = ctx.bl1905.results.filter((r) => r.flagged.length);
    assert.deepEqual(
      flagged.map((r) => `${r.file}: ${r.flagged.map((f) => `line ${f.line} ${f.callee}(${f.path})`).join('; ')}`),
      [],
      'run the fixture\'s own scripts copy (lib/fixtureScriptsInstall.js) or the cwd-rooted leaf'
    );
  });

  scoped(/^the candidates include (.+)$/, (ctx, list) => {
    const named = listOf(list);
    for (const n of named) assert.ok(NAME_ONLY.has(n), `unknown handler in the step's list: ${n}`);
    const candidates = ctx.bl1905.results.filter((r) => r.candidate).map((r) => r.file);
    for (const n of named) assert.ok(candidates.includes(n), `${n} is not a candidate; candidates: ${candidates.join(', ')}`);
    ctx.bl1905.named = named;
  });

  scoped(/^none of those four is flagged$/, (ctx) => {
    const { named, results } = ctx.bl1905;
    assert.equal(named.length, 4, `expected four named handlers, got ${named}`);
    for (const n of named) {
      const r = results.find((x) => x.file === n);
      assert.deepEqual(r.flagged, [], `${n} flagged: ${JSON.stringify(r.flagged)}`);
    }
  });

  scoped(/^a synthetic step handler that spawns the real done_with_current_task\.bb with its fixture as cwd$/, (ctx) => {
    const dir = trackedTmpRoot('sfvc-bl1905-');
    fs.writeFileSync(path.join(dir, SYNTHETIC_NAME), SYNTHETIC);
    ctx.bl1905.syntheticDir = dir;
  });

  scoped(/^that handler is scanned$/, (ctx) => {
    try {
      ctx.bl1905.results = scanDir(ctx.bl1905.syntheticDir, ctx.bl1905.names);
    } finally {
      fs.rmSync(ctx.bl1905.syntheticDir, { recursive: true, force: true });
    }
  });

  scoped(/^it is flagged and named$/, (ctx) => {
    const r = ctx.bl1905.results.find((x) => x.file === SYNTHETIC_NAME);
    assert.ok(r, JSON.stringify(ctx.bl1905.results));
    assert.ok(r.flagged.length >= 1, `not flagged: ${JSON.stringify(r)}`);
    assert.ok(
      r.flagged.some((f) => f.callee === 'spawnSync' && f.path.includes('done_with_current_task.bb')),
      `flagged without naming the helper: ${JSON.stringify(r.flagged)}`
    );
  });
}

module.exports = { registerSteps };
