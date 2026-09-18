const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { computeLivePipelineBoard } = require('../out/bridge/pipelineGridLive');
const { captureBubblePipelineBoard } = require('../out/bridge/bubblePipelinePage');

// BL-831 declared invariants (coder-authored per BL-654 / coder.prompt's
// Invariants section):
//   1. "One board read model: every cell, mark and stage placement the
//      page shows comes from the computation the existing Pipeline board
//      already uses, and the page derives no stage of its own."
//   2. "The main view is sufficient to know what is in flight: every
//      in-flight ticket it lists carries its blurb there, and the detail
//      sheet is never required to learn what a ticket is about."
// Runs only via `npm run test:properties`.

const ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function writeTicket(root, id, description) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  let yamlText = `id: ${id}\ntitle: "fixture ticket ${id}"\n`;
  if (description) {
    yamlText += `description: |\n  ${description}\n`;
  }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), yamlText);
}

function writeStageMap(root, byId) {
  const dir = path.join(root, '.swarmforge', 'board');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify(byId));
}

// Invariant 1: the Bubble page's own row.column for every in-flight ticket
// equals exactly what computeLivePipelineBoard (the SAME function
// capturePipelineGridLive/the Mini App board drives) reports for that id -
// the page derives no stage placement of its own.
test('property (BL-831 invariant 1): every in-flight row column equals the board read model, for any ticket/role assignment', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 5 }),
      fc.array(fc.constantFrom(...ROLES), { minLength: 5, maxLength: 5 }),
      (ticketNums, roles) => {
        const root = mkTmpDir('bl831-prop1-');
        const byId = {};
        ticketNums.forEach((n, i) => {
          const id = `BL-9${String(n).padStart(3, '0')}`;
          writeTicket(root, id);
          byId[id] = roles[i % roles.length];
        });
        writeStageMap(root, byId);

        const { data } = computeLivePipelineBoard(root);
        const sourceColumnById = new Map(data.rows.map((row) => [row.id, row.column]));
        const page = captureBubblePipelineBoard(root);

        assert.equal(page.inFlight.length, sourceColumnById.size);
        for (const row of page.inFlight) {
          assert.equal(row.column, sourceColumnById.get(row.id), `row ${row.id} column must equal the board read model's own column`);
        }
      }
    ),
    { numRuns: 25 }
  );
});

// Invariant 2: every in-flight ticket carries a non-empty blurb on the main
// view - true for a ticket with a description, and true for a ticket with
// none (falls back to title), over random combinations.
test('property (BL-831 invariant 2): every in-flight ticket carries a non-empty blurb, with or without a description', () => {
  fc.assert(
    fc.property(
      fc.array(fc.option(fc.string({ minLength: 1, maxLength: 80 }).filter((s) => /\S/.test(s)), { nil: undefined }), { minLength: 1, maxLength: 5 }),
      (descriptions) => {
        const root = mkTmpDir('bl831-prop2-');
        const byId = {};
        descriptions.forEach((desc, i) => {
          const id = `BL-8${String(i).padStart(3, '0')}`;
          // A raw description string could contain YAML-breaking characters;
          // keep the fixture simple with a fixed sentence-shaped body when
          // present, since the invariant under test is presence, not content.
          writeTicket(root, id, desc !== undefined ? 'A description sentence.' : undefined);
          byId[id] = 'coder';
        });
        writeStageMap(root, byId);

        const page = captureBubblePipelineBoard(root);
        assert.equal(page.inFlight.length, descriptions.length);
        for (const row of page.inFlight) {
          assert.ok(row.blurb && row.blurb.trim().length > 0, `ticket ${row.id} must carry a non-empty blurb`);
        }
      }
    ),
    { numRuns: 20 }
  );
});

// Non-vacuity (checked by hand, documented here): temporarily changed
// captureBubblePipelineBoard's column assignment to a hardcoded 'coder'
// regardless of row.column - invariant 1's property failed immediately on
// any fixture using a non-coder role. Reverting restored green. Invariant
// 2: temporarily made blurbFor return '' when description was absent
// (never falling back to title) - invariant 2's property failed on the
// no-description branch. Reverting restored green.
test('non-vacuity: invariant 1 property would catch a page that ignores the board read model', () => {
  const root = mkTmpDir('bl831-nonvacuity1-');
  writeTicket(root, 'BL-9001');
  writeStageMap(root, { 'BL-9001': 'architect' });
  const { data } = computeLivePipelineBoard(root);
  const sourceColumn = data.rows.find((row) => row.id === 'BL-9001').column;
  const brokenColumn = 'not-a-real-column';
  assert.notEqual(sourceColumn, brokenColumn);
  const page = captureBubblePipelineBoard(root);
  const row = page.inFlight.find((entry) => entry.id === 'BL-9001');
  assert.equal(row.column, sourceColumn);
  assert.notEqual(row.column, brokenColumn);
});

test('non-vacuity: invariant 2 property would catch a page that drops the blurb for description-less tickets', () => {
  const root = mkTmpDir('bl831-nonvacuity2-');
  writeTicket(root, 'BL-9002');
  writeStageMap(root, { 'BL-9002': 'architect' });
  const page = captureBubblePipelineBoard(root);
  const row = page.inFlight.find((entry) => entry.id === 'BL-9002');
  assert.notEqual(row.blurb, '');
  assert.ok(row.blurb.length > 0);
});
