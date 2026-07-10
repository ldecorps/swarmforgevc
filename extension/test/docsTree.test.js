const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DOCS_TREE_SCHEMA_VERSION,
  isFeatureFilePath,
  buildDocsTree,
  computeDocsTree,
  translateDocsTree,
  filterDocsTree,
} = require('../out/docs/docsTree');
const { createTranslationSession } = require('../out/i18n/translate');
const { emptyTranslationCache } = require('../out/i18n/translationCache');

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

// ── implemented flag (BL-253) ─────────────────────────────────────────────
// Whole-ticket implementation status derives purely from the backlog
// folder-authoritative status (done => implemented; active/paused =>
// not-yet), computed once here so both the ticket node and its milestone
// summary agree - a PWA consumer reads this field directly rather than
// re-deriving its own copy of the done/not-done rule.

test('a ticket in the done folder derives implemented: true', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'done' })], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.tickets[0].implemented, true);
});

test('a ticket in the active folder derives implemented: false (not-yet)', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'active' })], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.tickets[0].implemented, false);
});

test('a ticket in the paused folder derives implemented: false (not-yet)', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'paused' })], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal(tree.tickets[0].implemented, false);
});

// ── per-ticket timeline (BL-257 per-ticket-timeline-02) ───────────────────
// specDateIso/closeDateIso, sourced from gitHistoryAdapter.ts's
// deriveTicketLifecycles (git-derived, reproducible from a fresh clone -
// unlike per-role holding windows, which need live .swarmforge/ mailbox
// state this artifact's own generation pipeline does not have). Additive
// and OPTIONAL (default empty map) so every existing 5-arg buildDocsTree
// call site above keeps working unchanged.

test('a ticket with a matching lifecycle event gains specDateIso/closeDateIso', () => {
  const lifecycles = new Map([['BL-100', { ticketId: 'BL-100', specDateIso: '2026-07-01T00:00:00Z', closeDateIso: '2026-07-05T00:00:00Z' }]]);
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'done' })], new Map(), 'abc', '2026-07-09T00:00:00Z', lifecycles);
  assert.equal(tree.tickets[0].specDateIso, '2026-07-01T00:00:00Z');
  assert.equal(tree.tickets[0].closeDateIso, '2026-07-05T00:00:00Z');
});

test('an unclosed ticket carries specDateIso only, no closeDateIso', () => {
  const lifecycles = new Map([['BL-100', { ticketId: 'BL-100', specDateIso: '2026-07-01T00:00:00Z', closeDateIso: null }]]);
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'active' })], new Map(), 'abc', '2026-07-09T00:00:00Z', lifecycles);
  assert.equal(tree.tickets[0].specDateIso, '2026-07-01T00:00:00Z');
  assert.equal('closeDateIso' in tree.tickets[0], false);
});

test('a ticket with no matching lifecycle event carries neither field, not a crash', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'active' })], new Map(), 'abc', '2026-07-09T00:00:00Z', new Map());
  assert.equal('specDateIso' in tree.tickets[0], false);
  assert.equal('closeDateIso' in tree.tickets[0], false);
});

test('omitting the lifecycles argument entirely defaults to no timeline fields (backward compatible)', () => {
  const tree = buildDocsTree(emptyVisionDocs(), [item({ status: 'active' })], new Map(), 'abc', '2026-07-09T00:00:00Z');
  assert.equal('specDateIso' in tree.tickets[0], false);
});

test('the milestone ticket summary carries the same implemented flag as the full ticket node, not a separate derivation', () => {
  const items = [item({ id: 'BL-100', status: 'done', milestone: 'M4' }), item({ id: 'BL-101', status: 'active', milestone: 'M4' })];
  const tree = buildDocsTree(emptyVisionDocs(), items, new Map(), 'abc', '2026-07-09T00:00:00Z');
  const byId = Object.fromEntries(tree.milestones[0].tickets.map((t) => [t.id, t.implemented]));
  assert.deepEqual(byId, { 'BL-100': true, 'BL-101': false });
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

// ── translateDocsTree (BL-118) ───────────────────────────────────────────

function fakeEngine(translations = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      async translate(text) {
        calls.push(text);
        if (text in translations) {
          return { success: true, text: translations[text] };
        }
        return { success: false, error: 'no fake translation' };
      },
    },
  };
}

test('translateDocsTree adds titleFr/descriptionFr to a ticket, leaving the English fields untouched', async () => {
  const tree = {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T00:00:00Z',
    sourceSha: 'abc',
    vision: [],
    milestones: [],
    tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', description: 'Full prose.', scenarios: [] }],
  };
  const { engine } = fakeEngine({ 'cost telemetry': 'télémétrie des coûts', 'Full prose.': 'Prose complète.' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateDocsTree(tree, session);

  const ticket = translated.tickets[0];
  assert.equal(ticket.title, 'cost telemetry', 'the English field must be unchanged');
  assert.equal(ticket.titleFr, 'télémétrie des coûts');
  assert.equal(ticket.description, 'Full prose.');
  assert.equal(ticket.descriptionFr, 'Prose complète.');
});

test('bilingual-06: a ticket id is never sent through the translation engine', async () => {
  const tree = {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T00:00:00Z',
    sourceSha: 'abc',
    vision: [],
    milestones: [],
    tickets: [{ id: 'BL-100', title: 't', status: 'active', scenarios: [] }],
  };
  const { engine, calls } = fakeEngine({ t: 'traduit' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateDocsTree(tree, session);

  assert.equal(translated.tickets[0].id, 'BL-100');
  assert.ok(!calls.includes('BL-100'));
});

test('bilingual-04: a scenario keeps canonical English text and gains textFr for the French rendering', async () => {
  const tree = {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T00:00:00Z',
    sourceSha: 'abc',
    vision: [],
    milestones: [],
    tickets: [{
      id: 'BL-100', title: 't', status: 'active',
      scenarios: [{ id: 'BL-100/s1', name: 'works', text: 'Given a\nThen b' }],
    }],
  };
  const { engine } = fakeEngine({ 'Given a\nThen b': 'Étant donné a\nAlors b' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateDocsTree(tree, session);

  const scenario = translated.tickets[0].scenarios[0];
  assert.equal(scenario.text, 'Given a\nThen b', 'canonical English text is unchanged - it stays the binding contract');
  assert.equal(scenario.textFr, 'Étant donné a\nAlors b');
});

test('bilingual-06: a mermaid vision doc is never translated - no contentFr field at all', async () => {
  const tree = {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T00:00:00Z',
    sourceSha: 'abc',
    vision: [{ id: 'architectureDiagram', title: 'Architecture', kind: 'mermaid', content: 'graph TD; A-->B;' }],
    milestones: [],
    tickets: [],
  };
  const { engine, calls } = fakeEngine({});
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateDocsTree(tree, session);

  assert.equal('contentFr' in translated.vision[0], false);
  assert.equal(calls.length, 0);
});

test('a markdown vision doc gains contentFr via the code-fence-aware translation pass', async () => {
  const tree = {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T00:00:00Z',
    sourceSha: 'abc',
    vision: [{ id: 'specification', title: 'Specification', kind: 'markdown', content: 'Some prose.' }],
    milestones: [],
    tickets: [],
  };
  const { engine } = fakeEngine({ 'Some prose.': 'Un peu de prose.' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateDocsTree(tree, session);

  assert.equal(translated.vision[0].content, 'Some prose.');
  assert.equal(translated.vision[0].contentFr, 'Un peu de prose.');
});

test('bilingual-05: a failed translation flags the ticket titleFrUntranslated, and publishing (translateDocsTree itself) never throws', async () => {
  const tree = {
    schemaVersion: DOCS_TREE_SCHEMA_VERSION,
    generatedAtIso: '2026-07-09T00:00:00Z',
    sourceSha: 'abc',
    vision: [],
    milestones: [],
    tickets: [{ id: 'BL-100', title: 'untranslatable', status: 'active', scenarios: [] }],
  };
  const { engine } = fakeEngine({});
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateDocsTree(tree, session);

  assert.equal(translated.tickets[0].titleFr, 'untranslatable');
  assert.equal(translated.tickets[0].titleFrUntranslated, true);
});

// ── filterDocsTree (pure, BL-254) ─────────────────────────────────────────
// PURE client-side case-insensitive substring filter over an already-built
// tree: matches a ticket's Gherkin scenario text OR its title/description,
// prunes to matching tickets while keeping the milestone grouping - the
// DOM search box (pwa/app.js) is the unsuitable-for-testing boundary the
// ticket itself calls out; only this pure function is driven here and by
// the acceptance step handlers.

function scenario(text, name) {
  return { name: name ?? 'a scenario', text };
}

function docsTreeFixture(items, scenariosByTicketId = new Map()) {
  return buildDocsTree(emptyVisionDocs(), items, scenariosByTicketId, 'abc', '2026-07-09T00:00:00Z');
}

test('filter-by-gherkin-01: a query matching a ticket\'s Gherkin scenario text keeps that ticket, hides one that matches nowhere', () => {
  const tree = docsTreeFixture(
    [item({ id: 'BL-100', title: 'a', milestone: 'M1' }), item({ id: 'BL-101', title: 'b', milestone: 'M1' })],
    new Map([
      ['BL-100', [scenario('Scenario: x\n  Given the fleet console refreshes')]],
      ['BL-101', [scenario('Scenario: y\n  Given something unrelated')]],
    ])
  );

  const filtered = filterDocsTree(tree, 'fleet console');

  assert.deepEqual(filtered.tickets.map((t) => t.id), ['BL-100']);
});

test('match-title-description-02: a query matching only a ticket\'s title or description keeps that ticket', () => {
  const tree = docsTreeFixture([
    item({ id: 'BL-100', title: 'Baton fleet epic', milestone: 'M1' }),
    item({ id: 'BL-101', title: 'unrelated', description: 'the fleet is a composite of swarms', milestone: 'M1' }),
    item({ id: 'BL-102', title: 'no match here', milestone: 'M1' }),
  ]);

  const filtered = filterDocsTree(tree, 'fleet');

  assert.deepEqual(filtered.tickets.map((t) => t.id).sort(), ['BL-100', 'BL-101']);
});

test('case-insensitive-03: a query differing only in letter case from tree text still matches', () => {
  const tree = docsTreeFixture(
    [item({ id: 'BL-100', title: 'a', milestone: 'M1' })],
    new Map([['BL-100', [scenario('Scenario: x\n  Given the FLEET console refreshes')]]])
  );

  const filtered = filterDocsTree(tree, 'fleet CONSOLE');

  assert.deepEqual(filtered.tickets.map((t) => t.id), ['BL-100']);
});

test('spans-implemented-and-not-yet-04: a query matching both a done and an active ticket keeps both, status untouched', () => {
  const tree = docsTreeFixture([
    item({ id: 'BL-100', title: 'fleet console', status: 'done', milestone: 'M1' }),
    item({ id: 'BL-101', title: 'fleet console', status: 'active', milestone: 'M1' }),
  ]);

  const filtered = filterDocsTree(tree, 'fleet');

  assert.deepEqual(
    filtered.tickets.map((t) => [t.id, t.status]).sort(),
    [['BL-100', 'done'], ['BL-101', 'active']]
  );
});

test('empty-query-05: an empty query returns the full unfiltered tree unchanged', () => {
  const tree = docsTreeFixture([item({ id: 'BL-100', milestone: 'M1' }), item({ id: 'BL-101', milestone: 'M1' })]);

  assert.deepEqual(filterDocsTree(tree, ''), tree);
});

test('empty-query-05: a whitespace-only query is treated the same as empty - the full tree, not zero matches', () => {
  const tree = docsTreeFixture([item({ id: 'BL-100', milestone: 'M1' })]);

  assert.deepEqual(filterDocsTree(tree, '   '), tree);
});

test('no-results-06: a query matching no ticket returns an empty tickets list, not a throw', () => {
  const tree = docsTreeFixture([item({ id: 'BL-100', title: 'a', milestone: 'M1' })]);

  const filtered = filterDocsTree(tree, 'nothing matches this');

  assert.deepEqual(filtered.tickets, []);
});

test('the milestone hierarchy is kept, but each milestone\'s own ticket summaries are pruned to matches too', () => {
  const tree = docsTreeFixture([
    item({ id: 'BL-100', title: 'fleet console', milestone: 'M7' }),
    item({ id: 'BL-101', title: 'unrelated', milestone: 'M7' }),
  ]);

  const filtered = filterDocsTree(tree, 'fleet');

  assert.equal(filtered.milestones.length, 1);
  assert.equal(filtered.milestones[0].milestone, 'M7');
  assert.deepEqual(filtered.milestones[0].tickets.map((t) => t.id), ['BL-100']);
});

test('a milestone left with zero matching tickets is dropped from the filtered hierarchy', () => {
  const tree = docsTreeFixture([
    item({ id: 'BL-100', title: 'fleet console', milestone: 'M7' }),
    item({ id: 'BL-101', title: 'no match', milestone: 'M8' }),
  ]);

  const filtered = filterDocsTree(tree, 'fleet');

  assert.deepEqual(filtered.milestones.map((m) => m.milestone), ['M7']);
});

test('vision docs and every other tree field pass through untouched by filtering', () => {
  const tree = {
    ...docsTreeFixture([item({ id: 'BL-100', title: 'fleet console', milestone: 'M1' })]),
    vision: [{ id: 'specification', title: 'Specification', kind: 'markdown', content: '# Spec' }],
  };

  const filtered = filterDocsTree(tree, 'fleet');

  assert.deepEqual(filtered.vision, tree.vision);
  assert.equal(filtered.schemaVersion, tree.schemaVersion);
  assert.equal(filtered.sourceSha, tree.sourceSha);
});
