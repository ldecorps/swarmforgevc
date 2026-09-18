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
