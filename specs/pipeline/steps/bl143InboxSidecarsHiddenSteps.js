'use strict';

// BL-1946 (BL-143 stamp-off): step handlers for "coordinator views are
// payload-first and sidecar-safe". Drives the REAL compiled
// inboxVisibility.js (computeRoleQueueView/listSidecars) for scenarios
// 01-03, and the REAL chase_sweep_lib.bb sidecar read/write functions for
// scenario 04 - never a restatement of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

let _inboxVisibility = null;
function inboxVisibility() {
  if (!_inboxVisibility) _inboxVisibility = require(path.join(EXT_DIR, 'out', 'swarm', 'inboxVisibility'));
  return _inboxVisibility;
}

const FEATURE = 'coordinator views are payload-first and sidecar-safe';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeHandoff(dir, name) {
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, name), 'id: t\nfrom: a\nto: b\npriority: 50\ntype: note\n\nbody\n');
}

function writeSidecar(dir, name) {
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, name), '{}');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^inbox directories contain \.handoff payloads and sidecar files$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl143-');
    const inboxNew = path.join(root, 'inbox', 'new');
    const inProcess = path.join(root, 'inbox', 'in_process');
    writeHandoff(inboxNew, '00_a.handoff');
    writeSidecar(inboxNew, '00_a.handoff.chase.json');
    writeSidecar(inboxNew, '00_b.handoff.nudge');
    ctx.bl143 = { root, inboxNew, inProcess };
  });

  scoped(/^coordinator queue state is rendered in default mode$/, (ctx) => {
    ctx.bl143.view = inboxVisibility().computeRoleQueueView('coder', ctx.bl143.inboxNew, ctx.bl143.inProcess, false);
  });

  scoped(/^only \.handoff payload files are counted and listed$/, (ctx) => {
    assert.deepEqual(ctx.bl143.view.newPayloads, ['00_a.handoff']);
    assert.deepEqual(ctx.bl143.view.sidecars, []);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^inbox directories contain sidecar files$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl143-');
    const inboxNew = path.join(root, 'inbox', 'new');
    const inProcess = path.join(root, 'inbox', 'in_process');
    writeHandoff(inboxNew, '00_a.handoff');
    writeSidecar(inboxNew, '00_a.handoff.chase.json');
    ctx.bl143 = { root, inboxNew, inProcess };
  });

  scoped(/^coordinator enables debug\/diagnostic mode$/, (ctx) => {
    ctx.bl143.view = inboxVisibility().computeRoleQueueView('coder', ctx.bl143.inboxNew, ctx.bl143.inProcess, true);
  });

  scoped(/^sidecar files are visible with explicit metadata labeling$/, (ctx) => {
    assert.deepEqual(ctx.bl143.view.sidecars, [{ name: '00_a.handoff.chase.json', kind: 'chase-sidecar' }]);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^an inbox has sidecars but no \.handoff payload$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl143-');
    const inboxNew = path.join(root, 'inbox', 'new');
    const inProcess = path.join(root, 'inbox', 'in_process');
    writeSidecar(inboxNew, 'orphaned.handoff.nudge');
    ctx.bl143 = { root, inboxNew, inProcess };
  });

  scoped(/^coordinator evaluates whether work is pending$/, (ctx) => {
    ctx.bl143.view = inboxVisibility().computeRoleQueueView('coder', ctx.bl143.inboxNew, ctx.bl143.inProcess, false);
  });

  scoped(/^result is no pending payload work$/, (ctx) => {
    assert.equal(ctx.bl143.view.newPayloads.length, 0);
    assert.equal(ctx.bl143.view.inProcessPayloads.length, 0);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^sidecar files are hidden from default coordinator views$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl143-chaser-');
    const inboxNew = path.join(root, 'inbox', 'new');
    writeHandoff(inboxNew, '00_c.handoff');
    const handoffPath = path.join(inboxNew, '00_c.handoff');
    const view = inboxVisibility().computeRoleQueueView('coder', inboxNew, path.join(root, 'inbox', 'in_process'), false);
    assert.deepEqual(view.sidecars, [], 'sidecars must be hidden from this default-mode view before the sweep runs');
    ctx.bl143 = { root, handoffPath };
  });

  scoped(/^chaser sweep runs$/, (ctx) => {
    const expr = [
      `(load-file ${JSON.stringify(CHASE_LIB)})`,
      `(chase-sweep-lib/write-chase-count! ${JSON.stringify(ctx.bl143.handoffPath)} 1)`,
      `(chase-sweep-lib/write-nudge-count! ${JSON.stringify(ctx.bl143.handoffPath)} 1)`,
      '(println (chase-sweep-lib/read-chase-count ' + JSON.stringify(ctx.bl143.handoffPath) + '))',
      '(println (chase-sweep-lib/read-nudge-count ' + JSON.stringify(ctx.bl143.handoffPath) + '))',
    ].join('\n');
    const res = spawnSync('bb', ['-e', expr], { encoding: 'utf8', timeout: 60000 });
    assert.equal(res.status, 0, `chase_sweep_lib.bb call failed: ${res.stderr}`);
    const [chaseCount, nudgeCount] = res.stdout.trim().split('\n').map(Number);
    ctx.bl143.chaseCount = chaseCount;
    ctx.bl143.nudgeCount = nudgeCount;
  });

  scoped(/^chase\/nudge logic still reads and writes sidecars as before$/, (ctx) => {
    assert.equal(ctx.bl143.chaseCount, 1, 'write-chase-count!/read-chase-count must still round-trip');
    assert.equal(ctx.bl143.nudgeCount, 1, 'write-nudge-count!/read-nudge-count must still round-trip');
    assert.ok(fs.existsSync(`${ctx.bl143.handoffPath}.chase.json`), 'the real .chase.json sidecar must exist on disk, unaffected by the visibility filter');
    assert.ok(fs.existsSync(`${ctx.bl143.handoffPath}.nudge`), 'the real .nudge sidecar must exist on disk, unaffected by the visibility filter');
  });
}

module.exports = { registerSteps };
