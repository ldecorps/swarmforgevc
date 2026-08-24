'use strict';

// BL-1091 declared invariants (coder first authorship — BL-654):
//
// 1. A backlog move is committed as both of its paths or neither.
// 2. backlog folders stay disjoint for a ticket id after Expedite.
//
// Non-vacuity: an in-place approval still commits exactly one path.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { promoteToActive } = require('../out/panel/backlogWriter');
const { commitExpediteWrites } = require('../out/tools/telegram-front-desk-bot');
const { commitApprovalWrites } = require('../out/util/commitIntegrityRunner');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function fixtureWithGatesAndIntegrity() {
  const root = mkTmpDir('sfvc-bl1091-prop-');
  copySeededRepoInto(root);
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['promotion_gates_cli.bb']);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  for (const folder of ['active', 'paused', 'done', 'hold']) {
    fs.mkdirSync(path.join(root, 'backlog', folder), { recursive: true });
  }
  return root;
}

test('BL-1091/BL-654 invariant 1+2: expedite rename commits both paths and leaves one folder', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (n) => {
      const id = `BL-91${String(n).padStart(2, '0')}`;
      const root = fixtureWithGatesAndIntegrity();
      const paused = path.join(root, 'backlog', 'paused', `${id}-fixture.yaml`);
      fs.writeFileSync(paused, `id: ${id}\ntitle: t\nhuman_approval: approved\ndepends_on: []\n`);
      git(root, 'add', '-A', 'backlog');
      git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `seed ${id}`);
      const promotion = promoteToActive(root, id);
      assert.equal(promotion.moved, true);
      assert.ok(promotion.source);
      const ok = await commitExpediteWrites(root, id, promotion.source);
      assert.equal(ok, true);
      const names = git(root, 'show', '--name-status', '--format=', 'HEAD');
      assert.match(names, new RegExp(`backlog/paused/${id}`));
      assert.match(names, new RegExp(`backlog/active/${id}`));
      assert.match(names, /^(?:D|R\d+)/m);
      assert.equal(git(root, 'status', '--porcelain', '--', 'backlog').trim(), '');
      const hits = fs.readdirSync(path.join(root, 'backlog', 'active')).filter((f) => f.startsWith(id));
      assert.equal(hits.length, 1);
      assert.equal(fs.existsSync(paused), false);
    }),
    { numRuns: 5 }
  );
});

test('BL-1091 non-vacuity: in-place approval still commits exactly one path', async () => {
  const root = fixtureWithGatesAndIntegrity();
  const id = 'BL-9199';
  const active = path.join(root, 'backlog', 'active', `${id}-fixture.yaml`);
  fs.writeFileSync(active, `id: ${id}\ntitle: t\nhuman_approval: approved\n`);
  git(root, 'add', '-A', 'backlog');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `seed ${id}`);
  fs.writeFileSync(active, `id: ${id}\ntitle: t\nhuman_approval: rejected\n`);
  const ok = await commitApprovalWrites(root, id, `Reject ${id}: record human_approval\n\nBy coder.`);
  assert.equal(ok, true);
  const names = git(root, 'show', '--name-status', '--format=', 'HEAD')
    .trim()
    .split('\n')
    .filter(Boolean);
  assert.equal(names.length, 1);
});
