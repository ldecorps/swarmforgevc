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

  const root = mkTmpDir('bl759-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${root}\t_\tcoder\tclaude\n`);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  assert.equal(bot.isPipelineEmpty(root), drain.isPipelineEmpty(root));
  assert.deepEqual(bot.resolveLiveRoles(root), drain.resolveLiveRoles(root));
});
