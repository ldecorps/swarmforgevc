'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { buildDocsTree, filterDocsTree, filterSpecTree } = require('../out/docs/docsTree');

// BL-1412 declared invariants:
//   1. All matching lives in docsTree.ts, applied by the bridge route: the
//      ticket match is filterDocsTree REUSED (never re-implemented), the
//      label match sits beside it in filterSpecTree, and the inline Spec
//      tree script never matches text itself - it only sends the term.
//   2. Filtering prunes, never regroups: every matching ticket keeps its
//      full scenario list and its exact milestone/epic placement; a
//      non-matching ticket is absent at every level.
//   3. The screen stays read-only: the term rides a GET query parameter,
//      no other request method exists on the spec tree surface.
//
// P1 (invariant 2, the load-bearing property, generative): random trees,
//    random marker terms - some tickets match by title/description/
//    scenario/id, some milestones match by name (label match, keeping
//    their whole subtree) - every kept ticket is byte-identical to its
//    unfiltered self at the exact same milestone/epic bucket; every
//    dropped ticket is absent everywhere.
// P2 (invariant 1's structural half, generative): filterSpecTree's own
//    ticket-match set always AGREES with filterDocsTree's real output
//    (never a silently-diverging re-implementation) on every generated
//    tree/query, for tickets that match by text.
// Invariant 1's "the inline script never matches text" and invariant 3's
// "GET only" are STRUCTURAL facts about shipped source, not generatable
// over a domain - checked once below by reading the real files, per
// BL-654's allowance for a declared invariant with no property-shaped
// encoding (a stated reason, not a skipped test).

const EXTENSION_ROOT = path.join(__dirname, '..');
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
const MARKER = 'zqmarker';

function wordsArb(min, max) {
  return fc.array(fc.constantFrom(...WORDS), { minLength: min, maxLength: max }).map((ws) => ws.join(' '));
}

const ticketSpecArb = fc.record({
  idNum: fc.integer({ min: 1, max: 999999 }),
  titleWords: wordsArb(1, 2),
  titleHasMarker: fc.boolean(),
  descWords: wordsArb(0, 2),
  descHasMarker: fc.boolean(),
  scenarioWords: wordsArb(0, 2),
  scenarioHasMarker: fc.boolean(),
  idHasMarker: fc.boolean(),
  // Milestone/epic pools SOMETIMES literally equal the marker itself, so
  // a label match (keep-the-whole-subtree path) is generated too, not
  // just the plain ticket-text/id match.
  milestone: fc.constantFrom('M1', 'M2', MARKER),
  epic: fc.constantFrom('epic-a', 'epic-b'),
});

function buildTreeFromSpecs(specs) {
  const items = [];
  const scenariosByTicketId = new Map();
  const seen = new Set();
  for (const spec of specs) {
    const id = 'BL-' + spec.idNum + (spec.idHasMarker ? '-' + MARKER : '');
    if (seen.has(id)) continue; // fast-check may draw a duplicate idNum/marker combo
    seen.add(id);
    const title = spec.titleHasMarker ? `${spec.titleWords} ${MARKER}` : spec.titleWords;
    const description = spec.descHasMarker ? `${spec.descWords} ${MARKER}` : spec.descWords;
    items.push({ id, title, status: 'active', milestone: spec.milestone, epic: spec.epic, description });
    const scenarioText = spec.scenarioHasMarker ? `Scenario: s\n  Given ${spec.scenarioWords} ${MARKER}` : `Scenario: s\n  Given ${spec.scenarioWords}`;
    scenariosByTicketId.set(id, [{ name: 's', text: scenarioText }]);
  }
  return buildDocsTree([], items, scenariosByTicketId, 'sha', '2026-09-06T00:00:00Z');
}

function findInHierarchy(tree, ticketId) {
  for (const milestone of tree.milestones) {
    for (const epic of milestone.epics) {
      const found = epic.tickets.find((t) => t.id === ticketId);
      if (found) {
        return { milestone: milestone.milestone, epicKey: epic.epicKey };
      }
    }
  }
  return null;
}

function oracleMatches(ticket) {
  const lower = MARKER.toLowerCase();
  const textMatch =
    ticket.title.toLowerCase().includes(lower) ||
    (ticket.description || '').toLowerCase().includes(lower) ||
    ticket.scenarios.some((s) => s.text.toLowerCase().includes(lower));
  const idMatch = ticket.id.toLowerCase().includes(lower);
  const milestoneLabelMatch = ticket.milestone.toLowerCase().includes(lower);
  return textMatch || idMatch || milestoneLabelMatch;
}

test('BL-1412 P1 (invariant 2): filtering prunes, never regroups - a kept ticket is unchanged at its exact original placement, a dropped ticket is absent everywhere', () => {
  fc.assert(
    fc.property(fc.uniqueArray(ticketSpecArb, { minLength: 1, maxLength: 8, selector: (s) => s.idNum + ':' + s.idHasMarker }), (specs) => {
      const tree = buildTreeFromSpecs(specs);
      fc.pre(tree.tickets.length > 0);
      const filtered = filterSpecTree(tree, MARKER);
      const filteredById = new Map(filtered.tickets.map((t) => [t.id, t]));

      for (const original of tree.tickets) {
        const originalPlacement = findInHierarchy(tree, original.id);
        if (oracleMatches(original)) {
          const kept = filteredById.get(original.id);
          assert.ok(kept, `expected a matching ticket ${original.id} to be kept`);
          assert.deepEqual(kept, original, `expected the kept ticket to be byte-identical to its unfiltered self (full scenario list, every field) - ${original.id}`);
          const keptPlacement = findInHierarchy(filtered, original.id);
          assert.deepEqual(keptPlacement, originalPlacement, `expected ${original.id} at the SAME milestone/epic bucket, not regrouped`);
        } else {
          assert.ok(!filteredById.has(original.id), `expected a non-matching ticket ${original.id} to be absent from tree.tickets`);
          assert.equal(findInHierarchy(filtered, original.id), null, `expected ${original.id} absent from every milestone/epic level too`);
        }
      }
    }),
    { numRuns: 150 }
  );
});

test('BL-1412 P2 (invariant 1, structural half): filterSpecTree\'s ticket-text match always agrees with filterDocsTree\'s own real output - never a silently-diverging re-implementation', () => {
  fc.assert(
    fc.property(fc.uniqueArray(ticketSpecArb, { minLength: 1, maxLength: 8, selector: (s) => s.idNum + ':' + s.idHasMarker }), (specs) => {
      const tree = buildTreeFromSpecs(specs);
      fc.pre(tree.tickets.length > 0);

      const viaFilterDocsTree = new Set(filterDocsTree(tree, MARKER).tickets.map((t) => t.id));
      const viaFilterSpecTree = new Set(filterSpecTree(tree, MARKER).tickets.map((t) => t.id));

      // Every ticket filterDocsTree (BL-254's own ticket-text match) keeps
      // must ALSO be kept by filterSpecTree - the reuse this invariant
      // requires. filterSpecTree may keep MORE (id match, label match),
      // never fewer, for a ticket filterDocsTree already decided matches.
      for (const id of viaFilterDocsTree) {
        assert.ok(viaFilterSpecTree.has(id), `expected filterSpecTree to keep everything filterDocsTree's own ticket-text match keeps - missing ${id}`);
      }
    }),
    { numRuns: 150 }
  );
});

test('BL-1412 invariant 1 (structural): the inline Spec tree script never matches text itself, only sends the term', () => {
  const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'bridge', 'specTreeUiHtml.ts'), 'utf8');
  assert.equal((source.match(/toLowerCase/g) || []).length, 0, 'expected no client-side text matching (toLowerCase) in the inline script');
  assert.match(source, /q=/, 'expected the script to build a q= query parameter');
});

test('BL-1412 invariant 3 (structural): the bridge route is wired GET-only, no write method added for the spec tree surface', () => {
  const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'bridge', 'bridgeServer.ts'), 'utf8');
  assert.match(source, /filterSpecTree\(computeDocsTree\(targetPath, nowMs\), queryParams\(url\)\.get\('q'\) \?\? ''\)/, 'expected the exact wired compute() call');
  const uiSource = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'bridge', 'specTreeUiHtml.ts'), 'utf8');
  // A bracket-counting match, not a naive /fetch\([^)]*\)/ regex - a real
  // fetch() call here nests its OWN parens (fetch(stateUrl(), {...})), so a
  // regex that stops at the FIRST ")" only ever captures "fetch(stateUrl("
  // and silently never sees the options object at all (caught live: a
  // method: 'POST' planted in the real options object passed this check
  // right up until this fix).
  const fetchCalls = [];
  const fetchStart = /fetch\(/g;
  let m;
  while ((m = fetchStart.exec(uiSource))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < uiSource.length && depth > 0) {
      if (uiSource[i] === '(') depth++;
      else if (uiSource[i] === ')') depth--;
      i++;
    }
    fetchCalls.push(uiSource.slice(m.index, i));
  }
  assert.ok(fetchCalls.length > 0, 'expected at least one fetch() call in the inline script');
  for (const call of fetchCalls) {
    assert.ok(!/method\s*:/.test(call), `expected no method: override on any fetch() call in the inline script, found: ${call}`);
  }
});
