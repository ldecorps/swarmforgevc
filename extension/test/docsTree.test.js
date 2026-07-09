const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DOCS_TREE_SCHEMA_VERSION,
  isFeatureFilePath,
  buildDocsTree,
  computeDocsTree,
} = require('../out/docs/docsTree');

function item(overrides = {}) {
  return { id: 'BL-100', title: 't', status: 'active', ...overrides };
}

// ── isFeatureFilePath (pure) ─────────────────────────────────────────────

test('isFeatureFilePath recognizes a specs/features/*.feature reference', () => {
  assert.equal(isFeatureFilePath('specs/features/BL-100-thing.feature'), true);
});

test('isFeatureFilePath rejects inline Gherkin text', () => {
  assert.equal(isFeatureFilePath('Feature: x\n\nScenario: y\n  Given a\n'), false);
});

test('isFeatureFilePath rejects undefined/empty', () => {
  assert.equal(isFeatureFilePath(undefined), false);
  assert.equal(isFeatureFilePath(''), false);
});

// ── buildDocsTree (pure) ─────────────────────────────────────────────────

function emptyVisionDocs() {
  return [];
}

test('schema_version is present', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.schemaVersion, DOCS_TREE_SCHEMA_VERSION);
});

test('vision docs pass through as provided', () => {
  const vision = [{ id: 'specification', title: 'Specification', kind: 'markdown', content: '# Spec' }];
  const tree = buildDocsTree(vision, [], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.deepEqual(tree.vision, vision);
});

test('tickets are grouped into milestone nodes with folder-authoritative status', () => {
  const items = [item({ id: 'BL-100', status: 'active', milestone: 'M4' }), item({ id: 'BL-101', status: 'done', milestone: 'M4' })];
  const tree = buildDocsTree(emptyVisionDocs(), items, new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.milestones.length, 1);
  assert.equal(tree.milestones[0].milestone, 'M4');
  assert.deepEqual(
    tree.milestones[0].tickets.map((t) => [t.id, t.status]).sort(),
    [['BL-100', 'active'], ['BL-101', 'done']]
  );
});

test('a ticket with no milestone is grouped under "unspecified"', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item({ milestone: undefined })], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.milestones[0].milestone, 'unspecified');
});

test('a ticket node carries its prose description', () => {
  const items = [item({ description: 'Some prose.' })];
  const tree = buildDocsTree(emptyVisionDocs(), items, new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.tickets[0].description, 'Some prose.');
});

test('a ticket node carries its resolved Gherkin scenarios (docs-drilldown-01)', () => {
  const scenariosByTicketId = new Map([['BL-100', [{ name: 'a scenario', text: 'Scenario: a scenario\n  Given x' }]]]);
  const tree = buildDocsTree(emptyVisionDocs(), [item()], scenariosByTicketId, 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.tickets[0].scenarios.length, 1);
  assert.equal(tree.tickets[0].scenarios[0].name, 'a scenario');
});

test('a ticket with no resolved scenarios reports an empty array, not an error', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item()], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.deepEqual(tree.tickets[0].scenarios, []);
});

test('an empty backlog produces an empty, valid, non-throwing tree', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [], new Map(), null, '2026-07-09T00:00:00Z');
  assert.deepEqual(tree.milestones, []);
  assert.deepEqual(tree.tickets, []);
  assert.equal(tree.sourceSha, null);
});

// ── computeDocsTree (impure orchestrator, real fs + real feature files) ─

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-docs-tree-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

test('computeDocsTree resolves a specs/features/ reference into readable scenarios (docs-drilldown-03, file-reference form)', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));
  mkdirp(path.join(target, 'specs', 'features'));
  fs.writeFileSync(
    path.join(target, 'backlog', 'active', 'BL-100.yaml'),
    'id: BL-100\ntitle: t\nstatus: active\nacceptance: specs/features/BL-100-thing.feature\n'
  );
  fs.writeFileSync(
    path.join(target, 'specs', 'features', 'BL-100-thing.feature'),
    'Feature: x\n\nScenario: file-backed\n  Given a\n  Then b\n'
  );

  const tree = computeDocsTree(target);
  const ticket = tree.tickets.find((t) => t.id === 'BL-100');
  assert.equal(ticket.scenarios.length, 1);
  assert.equal(ticket.scenarios[0].name, 'file-backed');
});

test('computeDocsTree resolves an inline acceptance: | block into readable scenarios (docs-drilldown-03, inline form)', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(target, 'backlog', 'active', 'BL-101.yaml'),
    'id: BL-101\ntitle: t\nstatus: active\nacceptance: |\n  Feature: x\n\n  Scenario: inline-backed\n    Given a\n'
  );

  const tree = computeDocsTree(target);
  const ticket = tree.tickets.find((t) => t.id === 'BL-101');
  assert.equal(ticket.scenarios.length, 1);
  assert.equal(ticket.scenarios[0].name, 'inline-backed');
});

test('computeDocsTree tolerates a dangling feature-file reference (file missing) without throwing', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(target, 'backlog', 'active', 'BL-102.yaml'),
    'id: BL-102\ntitle: t\nstatus: active\nacceptance: specs/features/does-not-exist.feature\n'
  );

  assert.doesNotThrow(() => computeDocsTree(target));
  const tree = computeDocsTree(target);
  assert.deepEqual(tree.tickets.find((t) => t.id === 'BL-102').scenarios, []);
});

test('computeDocsTree reads the vision docs that exist and skips any that are missing', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'docs', 'diagrams'));
  fs.writeFileSync(path.join(target, 'docs', 'Specification.MD'), '# Spec content');
  fs.writeFileSync(path.join(target, 'docs', 'diagrams', 'architecture.mmd'), 'graph TD; A-->B;');
  // GettingStarted.md, Milestone Roadmap.MD, swarm-flow.mmd intentionally absent.

  const tree = computeDocsTree(target);
  const ids = tree.vision.map((v) => v.id);
  assert.ok(ids.includes('specification'));
  assert.ok(ids.includes('architectureDiagram'));
  assert.ok(!ids.includes('gettingStarted'));
  const spec = tree.vision.find((v) => v.id === 'specification');
  assert.equal(spec.content, '# Spec content');
  assert.equal(spec.kind, 'markdown');
  const diagram = tree.vision.find((v) => v.id === 'architectureDiagram');
  assert.equal(diagram.kind, 'mermaid');
});
