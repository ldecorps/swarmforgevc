'use strict';

// BL-759 declared invariants (coder first authorship — BL-654):
// 1. Whole-repo dependency-rule gate reports zero forbidden edges.
// 2. isPipelineEmpty / controlDrainTimeoutMs / resolveLiveRoles keep the
//    same behaviour after the extract (re-exports + operator imports).
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO = path.join(__dirname, '..', '..');
const EXT = path.join(REPO, 'extension');
const GATE = path.join(EXT, 'out', 'tools', 'dependency-gate.js');
const bot = require('../out/tools/telegram-front-desk-bot');
const drain = require('../out/tools/telegramPipelineDrain');
const core = require('../out/tools/telegramControlCore');

test('BL-759/BL-654 invariant 1: full-repo dependency gate stays green', () => {
  const r = spawnSync('node', [GATE], { cwd: EXT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /PASSED/);
});

test('BL-759/BL-654 invariant 2: bot re-exports match extracted implementations', () => {
  assert.equal(bot.controlDrainTimeoutMs, core.controlDrainTimeoutMs);
  assert.equal(bot.isPipelineEmpty, drain.isPipelineEmpty);
  assert.equal(bot.resolveLiveRoles, drain.resolveLiveRoles);

  fc.assert(
    fc.property(fc.option(fc.constantFrom(undefined, '5000', '0', 'x'), { nil: undefined }), (raw) => {
      assert.equal(bot.controlDrainTimeoutMs(raw), core.controlDrainTimeoutMs(raw));
    }),
    { numRuns: 20 }
  );

  // Env parse must honour positive ints (kills "always default" mutants).
  assert.equal(bot.controlDrainTimeoutMs('5000'), 5000);
  assert.equal(bot.controlDrainTimeoutMs(undefined), core.DEFAULT_CONTROL_DRAIN_TIMEOUT_MS);
  assert.equal(bot.controlDrainTimeoutMs('0'), core.DEFAULT_CONTROL_DRAIN_TIMEOUT_MS);
  assert.equal(bot.controlDrainTimeoutMs('x'), core.DEFAULT_CONTROL_DRAIN_TIMEOUT_MS);

  const root = mkTmpDir('bl759-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${root}\t_\tcoder\tclaude\n`);
  const inboxNew = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  const inProcess = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inboxNew, { recursive: true });
  fs.mkdirSync(inProcess, { recursive: true });

  // Empty + roles present (kills always-[] resolveLiveRoles and always-true empty).
  const roles = bot.resolveLiveRoles(root);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].role, 'coder');
  assert.deepEqual(roles, drain.resolveLiveRoles(root));
  assert.equal(bot.isPipelineEmpty(root), true);
  assert.equal(drain.isPipelineEmpty(root), true);

  fs.writeFileSync(path.join(inboxNew, 'x.handoff'), 'type: awake\nto: coder\npriority: 50\n');
  assert.equal(bot.isPipelineEmpty(root), false);
  assert.equal(drain.isPipelineEmpty(root), false);
});
