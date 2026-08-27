const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  DOCS_TREE_SCHEMA_VERSION,
  NO_EPIC_KEY,
  buildDocsTree,
} = require('../out/docs/docsTree');

function item(overrides = {}) {
  return { id: 'BL-100', title: 't', status: 'active', ...overrides };
}

function ticketsInMilestone(milestoneNode) {
  return milestoneNode.epics.flatMap((epic) => epic.tickets);
}

function epicBucketForTicket(tree, ticketId) {
  const full = tree.tickets.find((t) => t.id === ticketId);
  const milestoneName = full.milestone ?? 'unspecified';
  const milestone = tree.milestones.find((m) => m.milestone === milestoneName);
  if (!milestone) {
    return null;
  }
  for (const epic of milestone.epics) {
    if (epic.tickets.some((t) => t.id === ticketId)) {
      return epic;
    }
  }
  return null;
}

test('BL-592 invariants: every non-tracker ticket appears in exactly one epic bucket per milestone', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          id: fc.stringMatching(/^BL-[0-9]{3}$/),
          milestone: fc.constantFrom('M8', 'M9', 'M4'),
          epic: fc.option(fc.constantFrom('alpha', 'beta', 'gamma'), { nil: undefined }),
          type: fc.constantFrom('feature', 'bug', undefined),
        }),
        { minLength: 1, maxLength: 12 }
      ),
      (rawItems) => {
        const seen = new Set();
        const items = [];
        for (const raw of rawItems) {
          if (seen.has(raw.id)) {
            continue;
          }
          seen.add(raw.id);
          items.push(item({ ...raw, status: 'active' }));
        }
        const tree = buildDocsTree([], items, new Map(), 'abc', '2026-07-09T00:00:00Z');
        assert.equal(tree.schemaVersion, DOCS_TREE_SCHEMA_VERSION);
        for (const ticket of tree.tickets) {
          if (items.some((i) => i.id === ticket.id && i.type === 'epic')) {
            continue;
          }
          const appearances = tree.milestones
            .flatMap((m) => m.epics)
            .flatMap((e) => e.tickets)
            .filter((t) => t.id === ticket.id);
          assert.equal(appearances.length, 1, `ticket ${ticket.id} should appear once in epic leaves`);
          assert.ok(epicBucketForTicket(tree, ticket.id));
        }
      }
    ),
    { numRuns: 40 }
  );
});

test('BL-592 invariants: cross-milestone epic members only appear under matching milestone', () => {
  const items = [
    item({ id: 'BL-100', milestone: 'M8', epic: 'shared' }),
    item({ id: 'BL-101', milestone: 'M9', epic: 'shared' }),
  ];
  const tree = buildDocsTree([], items, new Map(), 'abc', '2026-07-09T00:00:00Z');
  const m8 = tree.milestones.find((m) => m.milestone === 'M8');
  const m9 = tree.milestones.find((m) => m.milestone === 'M9');
  assert.deepEqual(ticketsInMilestone(m8).map((t) => t.id), ['BL-100']);
  assert.deepEqual(ticketsInMilestone(m9).map((t) => t.id), ['BL-101']);
});
