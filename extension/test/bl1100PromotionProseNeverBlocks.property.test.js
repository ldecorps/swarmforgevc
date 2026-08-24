'use strict';

// BL-1100 declared invariants (coder first authorship — BL-654):
//
// 1. No ticket is disqualified from promotion by free prose.
// 2. Every skipped candidate is announced with id and gate.
//
// Non-vacuity: status: blocked still refuses and announces gate=blocked.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROMOTE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
const { installPromotionGates } = require('../../specs/pipeline/steps/lib/promotionGatesFixture');
const { computeClosure } = require('../../specs/pipeline/steps/lib/operatorRuntimeBbClosure.js');

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function mkRoot() {
  const root = fs.realpathSync(mkTmpDir('bl1100-prop-'));
  installPromotionGates(root, { maxDepth: 50 });
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of computeClosure(path.join(REPO_ROOT, 'swarmforge', 'scripts'), 'promotion_gates_cli.bb')) {
    const src = path.join(REPO_ROOT, 'swarmforge', 'scripts', name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scriptsDir, name));
  }
  fs.copyFileSync(PROMOTE_SH, path.join(scriptsDir, 'promote_and_route_next.sh'));
  fs.chmodSync(path.join(scriptsDir, 'promote_and_route_next.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  return root;
}

function writeTicket(root, id, { status = 'todo', type = 'feature', prose = '' }) {
  const body = [
    `id: ${id}`,
    'title: t',
    `type: ${type}`,
    `status: ${status}`,
    'human_approval: approved',
    'depends_on: []',
    'notes: |',
    `  ${prose}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'backlog', 'paused', `${id}.yaml`), body);
}

function list(root) {
  return spawnSync('bash', [path.join(root, 'swarmforge', 'scripts', 'promote_and_route_next.sh'), '--list-candidates', root], {
    encoding: 'utf8',
  });
}

const PROSE = [
  'Do not promote them concurrently; the second should merge main',
  'do not promote this one until BL-1022 has reached done/',
  '4. Do not flip human_approval. Do not promote. Do not dispatch.',
];

test('BL-1100/BL-654 invariant 1: ordering prose never removes a candidate', () => {
  fc.assert(
    fc.property(fc.constantFrom(...PROSE), fc.integer({ min: 1, max: 9 }), (sentence, n) => {
      const root = mkRoot();
      const id = `BL-91${n}0`;
      writeTicket(root, id, { prose: sentence });
      const result = list(root);
      assert.ok(result.stdout.includes(id), `prose must not exclude ${id}: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, new RegExp(`skip ${id}`));
    }),
    { numRuns: 9 }
  );
});

test('BL-1100/BL-654 invariant 2: structured skips announce id and gate', () => {
  const root = mkRoot();
  writeTicket(root, 'BL-9191', { status: 'blocked', prose: 'x' });
  writeTicket(root, 'BL-9192', { type: 'epic', prose: 'do not promote this epic in prose' });
  writeTicket(root, 'BL-9193', { prose: 'eligible' });
  const result = list(root);
  assert.match(result.stderr, /skip BL-9191 gate=blocked/);
  assert.match(result.stderr, /skip BL-9192 gate=epic/);
  assert.ok(result.stdout.includes('BL-9193'));
  assert.ok(!result.stdout.includes('BL-9191'));
  assert.ok(!result.stdout.includes('BL-9192'));
});
