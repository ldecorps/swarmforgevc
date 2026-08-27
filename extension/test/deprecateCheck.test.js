'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseArgs,
  parseDependsOn,
  findSupersedeMarker,
  evaluateDeprecatorFreshness,
  deprecateCheck,
  gatherTicketFreshnessFacts,
} = require('../out/tools/deprecate-check');

function writeTicket(root, folder, id, body) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}-slug.yaml`);
  fs.writeFileSync(file, body);
  return file;
}

test('parseArgs requires root and ticket id', () => {
  assert.equal(parseArgs([]), null);
  assert.deepEqual(parseArgs(['/repo', 'BL-9']), { root: '/repo', ticketId: 'BL-9' });
});

test('parseDependsOn reads bracket list', () => {
  assert.deepEqual(parseDependsOn('depends_on: [BL-1, BL-2]\n'), ['BL-1', 'BL-2']);
  assert.deepEqual(parseDependsOn('depends_on: []\n'), []);
});

test('evaluateDeprecatorFreshness holds on supersede marker', () => {
  const d = evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText: 'id: BL-9\n',
    pausedPathExists: true,
    supersedeMarkerPath: '/r/.swarmforge/superseded/BL-9',
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
  });
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /supersede marker/);
});

test('evaluateDeprecatorFreshness allows a clean ticket', () => {
  const d = evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText: 'id: BL-9\ndescription: fresh work\n',
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
  });
  assert.equal(d.decision, 'allow');
});

test('evaluateDeprecatorFreshness holds when depends_on done and RETIRED named', () => {
  const d = evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText: 'depends_on: [BL-1]\ndescription: still uses RETIRED foo\n',
    pausedPathExists: true,
    dependsOnIds: ['BL-1'],
    dependsOnAllDone: true,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
  });
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /stale premise/);
});

test('deprecateCheck integration: supersede marker on disk', () => {
  const root = mkTmpDir('deprecate-check-');
  writeTicket(root, 'paused', 'BL-42', 'id: BL-42\ntitle: x\n');
  fs.mkdirSync(path.join(root, '.swarmforge', 'superseded'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'superseded', 'BL-42'), 'retired\n');
  const d = deprecateCheck(root, 'BL-42');
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /supersede marker/);
  assert.ok(findSupersedeMarker(root, 'BL-42'));
});

test('gatherTicketFreshnessFacts sees depends_on all done', () => {
  const root = mkTmpDir('deprecate-deps-');
  writeTicket(root, 'paused', 'BL-50', 'id: BL-50\ndepends_on: [BL-49]\ndescription: ok\n');
  const doneDir = path.join(root, 'backlog', 'done', 'M8');
  fs.mkdirSync(doneDir, { recursive: true });
  fs.writeFileSync(path.join(doneDir, 'BL-49-done.yaml'), 'id: BL-49\n');
  const facts = gatherTicketFreshnessFacts(root, 'BL-50');
  assert.deepEqual(facts.dependsOnIds, ['BL-49']);
  assert.equal(facts.dependsOnAllDone, true);
});
