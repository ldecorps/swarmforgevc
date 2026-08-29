'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  findSelfClaim,
  splitTopLevelFields,
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

test('evaluateDeprecatorFreshness holds on retired surface token without RETIRED word', () => {
  // Isolates the retiredSurfaceHits branch from the /\bRETIRED\b/ yamlText fallback.
  const d = evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText: 'depends_on: [BL-1]\ndescription: still calls legacy-verb from docs\n',
    pausedPathExists: true,
    dependsOnIds: ['BL-1'],
    dependsOnAllDone: true,
    doneClosureExists: false,
    retiredSurfaceHits: ['legacy-verb'],
    specGapBounceCount: 0,
  });
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /retired surface/);
  assert.match(d.reason, /legacy-verb/);
});

test('evaluateDeprecatorFreshness holds on stale claim without done closure', () => {
  // BL-1268: the claim has to be about THIS ticket. A bare prose mention of
  // another ticket's disposition no longer holds - see the cross-reference
  // cases below - so this case states the ticket's own disposition.
  const d = evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText: 'closed_as: superseded-by-BL-8\n',
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
  });
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /claims itself superseded-by in field 'closed_as'/);
});

test('evaluateDeprecatorFreshness holds on repeated spec-gap bounces', () => {
  const d = evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText: 'id: BL-9\n',
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 2,
  });
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /spec-gap/);
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


// ── BL-1268: the generic-claim branch fires on a claim about THIS ticket ──

function freshness(yamlText, overrides = {}) {
  return evaluateDeprecatorFreshness({
    ticketId: 'BL-9',
    yamlText,
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
    ...overrides,
  });
}

test('splitTopLevelFields attributes continuation lines to the field that opened them', () => {
  const fields = splitTopLevelFields('id: BL-9\nnotes: |\n  first line\n  second line\n');
  assert.deepEqual(
    fields.map((f) => f.name),
    ['id', 'notes']
  );
  assert.match(fields[1].text, /first line[\s\S]*second line/);
});

test('a notes line citing another ticket\'s disposition is not a claim about this one', () => {
  assert.equal(findSelfClaim('notes: |\n  BL-1173 was superseded by BL-1268.\n', 'BL-9'), null);
  assert.equal(findSelfClaim('notes: |\n  BL-900 had its logic retired in 2026-08.\n', 'BL-9'), null);
  assert.equal(freshness('notes: |\n  BL-1173 was superseded by BL-1268.\n').decision, 'allow');
});

test('this ticket explaining why ANOTHER ticket was retired is still not a self-claim', () => {
  assert.equal(
    findSelfClaim('notes: |\n  This ticket explains why another ticket was retired.\n', 'BL-9'),
    null
  );
});

test('a structured disposition field is a claim about the ticket carrying it', () => {
  assert.deepEqual(findSelfClaim('closed_as: superseded-by-BL-8\n', 'BL-9'), {
    field: 'closed_as',
    claim: 'superseded-by',
  });
  assert.deepEqual(findSelfClaim('status: superseded\n', 'BL-9'), {
    field: 'status',
    claim: 'superseded',
  });
});

test('prose calling this ticket itself obsolete is a self-claim', () => {
  assert.deepEqual(findSelfClaim('description: this ticket is itself obsolete now.\n', 'BL-9'), {
    field: 'description',
    claim: 'obsolete',
  });
  assert.deepEqual(findSelfClaim('description: BL-9 is retired in favour of BL-10.\n', 'BL-9'), {
    field: 'description',
    claim: 'retired',
  });
});

test('a denied disposition is not a claim that it happened', () => {
  assert.equal(findSelfClaim('notes: |\n  This ticket is NOT retired - it is retargeted.\n', 'BL-9'), null);
  assert.equal(findSelfClaim('status: not superseded\n', 'BL-9'), null);
});

test('a claim word inside a path or a hyphenated compound names a surface, not a disposition', () => {
  assert.equal(findSelfClaim('acceptance: specs/features/BL-9-assertions-are-retired.feature\n', 'BL-9'), null);
  assert.equal(
    findSelfClaim("required_wiring:\n  - 'runner.bb::case (BL-9)::the retired-type guard lands'\n", 'BL-9'),
    null
  );
});

test('a claim about something else later in a long sentence is not this ticket\'s disposition', () => {
  assert.equal(
    findSelfClaim(
      'description: |\n  This ticket is the durable fix behind it, so the convention can eventually be retired.\n',
      'BL-9'
    ),
    null
  );
});

test('a recorded deprecator adjudication is not itself a claim about the ticket', () => {
  const yamlText = [
    'notes: |',
    '  [2026-08-29] specifier, freshness adjudication: the hold cited a notes',
    '  line about BL-900, whose logic was retired in BL-1000. That is a',
    '  cross-reference, not a claim about this ticket; promote confirmed.',
    '',
  ].join('\n');
  assert.equal(findSelfClaim(yamlText, 'BL-9'), null);
  assert.equal(freshness(yamlText).decision, 'allow');
});

test('the hold reason names the field the claim was found in', () => {
  const d = freshness('closed_as: superseded-by-BL-8\n');
  assert.equal(d.decision, 'hold');
  assert.match(d.reason, /field 'closed_as'/);
});

test('a done closure still clears a genuine self-claim', () => {
  assert.equal(freshness('closed_as: superseded-by-BL-8\n', { doneClosureExists: true }).decision, 'allow');
});
