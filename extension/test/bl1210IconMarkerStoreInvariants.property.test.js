const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { classifyTopicThread } = require('../out/concierge/topicThreadKind');
const {
  readSwarmIconId,
  recordSwarmIconId,
  recordPath,
} = require('../out/concierge/blTopicStore');

// BL-1210 declared invariants:
// 1. A durable write never returns normally having written nothing: when a
//    store refuses a record, the refusal reaches the CALLER as a value it
//    must handle - a line on stderr is a diagnostic, never the signal, and
//    no caller may report success on a write that did not happen.
// 2. Which store an icon ownership marker lands in may depend on the id's
//    kind; WHETHER it is recorded at all may not. Every id syncTopicIcon
//    accepts has a store, so the marker's availability is uniform across
//    topic kinds even though its location is not.
//
// Runs ONLY via `npm run test:properties`.

const SILENT = () => {};

// The generator's reach is the point of this file, not a detail: BL-1210
// existed because THREE id kinds - epic, standing, role - were the ones no
// test drove through recordSwarmIconId. A generator that draws only ticket
// and supervisor ids passes against the defect. So every kind is drawn
// explicitly, and the reachability floor below is ASSERTED, never hoped for.
const TICKET_IDS = () =>
  fc.oneof(
    fc.integer({ min: 1, max: 9999 }).map((n) => `BL-${n}`),
    fc.integer({ min: 1, max: 9999 }).map((n) => `GH-${n}`)
  );
const SUPERVISOR_IDS = () => fc.integer({ min: 1, max: 99 }).map((n) => `SUP-${n}`);
const EPIC_IDS = () =>
  fc.constantFrom('role-benchmarking', 'swarm-reliability', 'front-desk', 'bubble');
const STANDING_IDS = () => fc.constantFrom('OPERATOR', 'SUPPORT', 'BOX-OFFICE', 'Approvals');
const ROLE_IDS = () =>
  fc.constantFrom('coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'specifier');
const UNSTORABLE_IDS = () => fc.constantFrom('', ' ', '   ', '\t', '\n');

const ICON_ID = () =>
  fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0);

// Which of the five kinds an id belongs to, for the reachability floor.
// Deliberately NOT classifyTopicThread: that function collapses epic,
// standing and role into one 'unbound' bucket, which is exactly the
// collapse that hid this defect.
function idKind(id) {
  if (!id.trim()) return 'unstorable';
  if (/^(?:BL|GH)-\d+$/i.test(id)) return 'ticket';
  if (/^SUP-\d+$/i.test(id)) return 'supervisor';
  if (id === id.toUpperCase() && /[A-Z]/.test(id)) return 'standing';
  if (id.includes('-')) return 'epic';
  return 'role';
}

// BL-1691: per-kind generators for constructing reach by an outer loop -
// the same six/five kinds idKind() classifies, one arbitrary per cell.
// Filtered (not just the raw per-kind pool) because idKind()'s own
// classification disagrees with three pool members the original combined
// draw's post-hoc bucketing papered over: EPIC_IDS()'s 'bubble' has no
// dash (idKind falls through to 'role'), STANDING_IDS()'s 'Approvals' is
// not all-uppercase (falls through to 'role'), and ROLE_IDS()'s 'QA' IS
// all-uppercase (idKind reads it as 'standing' before ever reaching the
// role fallback). The filter guarantees every draw in a cell truly
// classifies as that cell's kind - construction, not "very likely".
function forKind(kind, generatorFn) {
  return () => generatorFn().filter((id) => idKind(id) === kind);
}
const STORABLE_KIND_GENERATORS = {
  ticket: forKind('ticket', TICKET_IDS),
  supervisor: forKind('supervisor', SUPERVISOR_IDS),
  epic: forKind('epic', EPIC_IDS),
  standing: forKind('standing', STANDING_IDS),
  role: forKind('role', ROLE_IDS),
};
const ANY_KIND_GENERATORS = { ...STORABLE_KIND_GENERATORS, unstorable: forKind('unstorable', UNSTORABLE_IDS) };

function withRoot(fn) {
  const root = mkTmpDir('sfvc-bl1210-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function markerStoreFiles(root) {
  const dir = path.join(root, '.swarmforge');
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('topic-icons.json'));
  } catch {
    return [];
  }
}

test('property (invariant 1): recordSwarmIconId reports recorded if and only if the marker is readable back', () => {
  const KINDS = Object.keys(ANY_KIND_GENERATORS);
  const PER_CELL_RUNS = runsPerCell(150, KINDS.length);
  const seen = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const kind of KINDS) {
    fc.assert(
      fc.property(ANY_KIND_GENERATORS[kind](), ICON_ID(), (id, iconId) => {
        assert.equal(idKind(id), kind, `generator for ${kind} produced an id of a different kind: ${id}`);
        seen[kind] += 1;
        withRoot((root) => {
          const outcome = recordSwarmIconId(root, id, iconId, SILENT, SILENT);
          assert.ok(
            outcome === 'recorded' || outcome === 'refused',
            `recordSwarmIconId returned ${JSON.stringify(outcome)}, which no caller can handle`
          );
          if (outcome === 'recorded') {
            assert.equal(readSwarmIconId(root, id), iconId);
          } else {
            // A refusal wrote NOTHING - not a tracked record, not a store entry.
            assert.equal(readSwarmIconId(root, id), undefined);
            assert.equal(fs.existsSync(recordPath(root, id)), false);
            assert.deepEqual(markerStoreFiles(root), []);
          }
        });
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, PER_CELL_RUNS, 'id-kind');
});

test('property (invariant 1): a refused write is a returned value, never only a line on stderr', () => {
  let cases = 0;
  fc.assert(
    fc.property(UNSTORABLE_IDS(), ICON_ID(), (id, iconId) => {
      cases += 1;
      withRoot((root) => {
        // No reporter at all: the caller must still be able to tell.
        const outcome = recordSwarmIconId(root, id, iconId, SILENT, SILENT);
        assert.equal(outcome, 'refused');
      });
    }),
    { numRuns: 20 }
  );
  assert.ok(cases > 0);
});

test('property (invariant 2): every storable id records a readable marker, whatever kind it is', () => {
  const KINDS = Object.keys(STORABLE_KIND_GENERATORS);
  const PER_CELL_RUNS = runsPerCell(150, KINDS.length);
  const seen = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const kind of KINDS) {
    fc.assert(
      fc.property(STORABLE_KIND_GENERATORS[kind](), ICON_ID(), (id, iconId) => {
        assert.equal(idKind(id), kind, `generator for ${kind} produced an id of a different kind: ${id}`);
        seen[kind] += 1;
        withRoot((root) => {
          assert.equal(recordSwarmIconId(root, id, iconId, SILENT, SILENT), 'recorded');
          assert.equal(readSwarmIconId(root, id), iconId);
        });
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, PER_CELL_RUNS, 'id-kind');
});

test('property (invariant 2): the marker location varies by kind but only ticket ids get a tracked record', () => {
  const KINDS = Object.keys(STORABLE_KIND_GENERATORS);
  const PER_CELL_RUNS = runsPerCell(150, KINDS.length);
  const seen = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const kind of KINDS) {
    fc.assert(
      fc.property(STORABLE_KIND_GENERATORS[kind](), ICON_ID(), (id, iconId) => {
        assert.equal(idKind(id), kind, `generator for ${kind} produced an id of a different kind: ${id}`);
        seen[kind] += 1;
        withRoot((root) => {
          recordSwarmIconId(root, id, iconId, SILENT, SILENT);
          // BL-695's boundary, kept: tracked records stay ticket-only.
          assert.equal(
            fs.existsSync(recordPath(root, id)),
            classifyTopicThread(id) === 'ticket',
            `tracked record presence is wrong for ${kind} id ${JSON.stringify(id)}`
          );
        });
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, PER_CELL_RUNS, 'id-kind');
});
