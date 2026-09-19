const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { captureBubblePipelineBoard, captureBubblePipelineDetail } = require('../out/bridge/bubblePipelinePage');
const {
  isBubblePipelinePagePath,
  isBubblePipelinePageStatePath,
  isBubblePipelinePageDetailPath,
  getBubblePipelinePageUiHtml,
} = require('../out/bridge/bubblePipelinePageUiHtml');

// BL-831: unit coverage for the Bubble Pipeline page's data functions and
// path matchers - the acceptance feature (run_acceptance.sh) drives these
// over real HTTP; this file covers the same module's edge cases (missing
// ticket, non-.feature acceptance value) directly.

function writeTicket(root, id, fields) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  let yamlText = `id: ${id}\ntitle: "${fields.title}"\n`;
  if (fields.description) yamlText += `description: |\n  ${fields.description}\n`;
  if (fields.acceptance) yamlText += `acceptance: ${fields.acceptance}\n`;
  fs.writeFileSync(path.join(dir, `${id}.yaml`), yamlText);
}

function writeStageMap(root, byId) {
  const dir = path.join(root, '.swarmforge', 'board');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify(byId));
}

test('captureBubblePipelineBoard: an empty backlog reports no in-flight tickets', () => {
  const root = mkTmpDir('bl831-empty-');
  const state = captureBubblePipelineBoard(root);
  assert.deepEqual(state.inFlight, []);
  assert.ok(Array.isArray(state.columns) && state.columns.length > 0);
});

// BL-831 hardening: the empty-backlog case above never runs the per-row map
// callback (it maps over zero rows), so its item-found branch (the blurb()
// call, and the title fallback when a matched item has no title) had no
// coverage. A role-held ticket with no backlog record never reaches this
// map at all - computeLivePipelineBoard's rows are built from activeIds
// (folders.active's own ids; pipelineGridLive.ts), and captureBubblePipelineBoard's
// byId is built from that same folders.active list, so every row's id is
// guaranteed present in byId (verified here as a negative: a stage-map
// entry with no backlog record is excluded from inFlight entirely, not
// shown with a fallback).
test('captureBubblePipelineBoard: an in-flight ticket with a matching backlog record gets its blurb; a stage-map entry with no backlog record is not listed at all', () => {
  const root = mkTmpDir('bl831-inflight-');
  writeTicket(root, 'BL-9010', { title: 'has a backlog record', description: 'First sentence here.' });
  writeStageMap(root, { 'BL-9010': 'coder', 'BL-9099': 'cleaner' });
  const state = captureBubblePipelineBoard(root);
  const withRecord = state.inFlight.find((row) => row.id === 'BL-9010');
  const withoutRecord = state.inFlight.find((row) => row.id === 'BL-9099');
  assert.ok(withRecord, 'expected BL-9010 to be listed as in flight');
  assert.equal(withRecord.blurb, 'First sentence here.');
  assert.equal(withoutRecord, undefined, 'a role-held ticket absent from the backlog must not appear in inFlight');
});

test('captureBubblePipelineDetail: returns null for a ticket id not in active or paused', () => {
  const root = mkTmpDir('bl831-missing-');
  assert.equal(captureBubblePipelineDetail(root, 'BL-9999'), null);
});

test('captureBubblePipelineDetail: an acceptance value that is not a .feature path never reads a feature file', () => {
  const root = mkTmpDir('bl831-nonfeature-');
  writeTicket(root, 'BL-9003', { title: 'inline gherkin ticket', acceptance: 'not a real path' });
  writeStageMap(root, { 'BL-9003': 'coder' });
  const detail = captureBubblePipelineDetail(root, 'BL-9003');
  assert.ok(detail);
  assert.equal(detail.scenarios.length, 0);
  assert.match(detail.scenariosNote, /no acceptance scenarios/i);
});

// BL-831 hardening: distinct from the "not a .feature path" case above -
// here `acceptance:` DOES name a `.feature` path, but that file does not
// exist on disk. Must still fall back to scenariosNote, not throw or read
// a nonexistent file.
test('captureBubblePipelineDetail: a .feature acceptance path that does not exist on disk still opens with a note, not a crash', () => {
  const root = mkTmpDir('bl831-missingfeature-');
  writeTicket(root, 'BL-9005', { title: 'feature path but no file', acceptance: 'specs/features/BL-9005-does-not-exist.feature' });
  writeStageMap(root, { 'BL-9005': 'hardener' });
  const detail = captureBubblePipelineDetail(root, 'BL-9005');
  assert.ok(detail);
  assert.equal(detail.scenarios.length, 0);
  assert.match(detail.scenariosNote, /no acceptance scenarios/i);
});

// BL-831 hardening: the feature-exists branch (parseFeatureScenarioTitles
// actually reading and parsing a real file) had zero coverage - both of
// the tests above take the acceptance-missing/not-a-path route, so the
// detail sheet's real reason to exist (surfacing Gherkin scenario titles)
// was never unit-exercised, only reached indirectly via the acceptance
// suite's own subprocess (invisible to this file's coverage instrumentation).
test('captureBubblePipelineDetail: a .feature acceptance path that exists on disk has its scenario titles parsed, not its Given/When/Then steps', () => {
  const root = mkTmpDir('bl831-realfeature-');
  writeTicket(root, 'BL-9006', { title: 'ticket with a real feature file', acceptance: 'specs/features/BL-9006-x.feature' });
  writeStageMap(root, { 'BL-9006': 'architect' });
  const featureDir = path.join(root, 'specs', 'features');
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'BL-9006-x.feature'),
    [
      'Feature: something',
      '',
      '  Scenario: the first one',
      '    Given a precondition',
      '    When something happens',
      '    Then something is true',
      '',
      '  Scenario Outline: the second one',
      '    Given <value>',
      '',
      '    Examples:',
      '      | value |',
      '      | 1     |',
    ].join('\n')
  );
  const detail = captureBubblePipelineDetail(root, 'BL-9006');
  assert.deepEqual(detail.scenarios, ['the first one', 'the second one']);
  assert.equal(detail.scenariosNote, undefined);
  assert.ok(!detail.scenarios.some((s) => /^Given |^When |^Then /.test(s)), 'scenario titles must not include step lines');
});

test('captureBubblePipelineDetail: carries invariants and out_of_scope when the ticket declares them', () => {
  const root = mkTmpDir('bl831-sections-');
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'BL-9004.yaml'),
    'id: BL-9004\ntitle: "ticket with sections"\ninvariants:\n  - "first invariant"\n  - "second invariant"\nout_of_scope: |\n  Nothing outside this slice.\n'
  );
  const detail = captureBubblePipelineDetail(root, 'BL-9004');
  assert.deepEqual(detail.invariants, ['first invariant', 'second invariant']);
  assert.equal(detail.outOfScope, 'Nothing outside this slice.');
});

test('isBubblePipelinePagePath/isBubblePipelinePageStatePath/isBubblePipelinePageDetailPath: match their own routes only', () => {
  assert.equal(isBubblePipelinePagePath('/pipeline-page'), true);
  assert.equal(isBubblePipelinePagePath('/pipeline-page?token=x'), true);
  assert.equal(isBubblePipelinePagePath('/pipeline-page-state'), false);
  assert.equal(isBubblePipelinePageStatePath('/pipeline-page-state'), true);
  assert.equal(isBubblePipelinePageStatePath('/pipeline-page-state?token=x'), true);
  assert.equal(isBubblePipelinePageStatePath('/pipeline-page'), false);
  assert.equal(isBubblePipelinePageDetailPath('/pipeline-page-detail?id=BL-1'), true);
  assert.equal(isBubblePipelinePageDetailPath('/pipeline-page'), false);
});

test('getBubblePipelinePageUiHtml: renders a page shell that fetches the state and detail routes', () => {
  const html = getBubblePipelinePageUiHtml();
  assert.match(html, /<title>Pipeline<\/title>/);
  assert.match(html, /\/pipeline-page-state/);
  assert.match(html, /\/pipeline-page-detail/);
});

test('getBubblePipelinePageUiHtml: renders the grid as a horizontally-scrollable matrix, not just a card list', () => {
  const html = getBubblePipelinePageUiHtml();
  assert.match(html, /grid-scroll/);
  assert.match(html, /<table>/);
  assert.match(html, /data\.columns/);
});
