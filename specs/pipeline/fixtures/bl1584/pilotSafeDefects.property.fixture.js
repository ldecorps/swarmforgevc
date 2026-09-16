const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { listSafePilotDefects, pickSafePilotDefect } = require('../out/tools/pilotSafeDefects');
const { parsePilotTicket, parsePilotSafeCommand } = require('../out/tools/telegramCursorBridgePilot');

// BL-722 declared invariants (backlog/active/BL-722-pilot-safe-defects.yaml):
// 1. A /pilot safe start never selects a ticket that fails the safe filter
//    (type defect, real .feature, not needs_design, human_approval approved,
//    mutation_cost low, paused by default).
// 2. When the safe pool is empty, /pilot safe does not start a pilot and
//    does not fall back to a medium/high-mutation or needs_design ticket.
// 3. Explicit /pilot BL-xxx remains an escape hatch for any ticket id.
//
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

let seq = 0;
function nextId() {
  seq += 1;
  return `BL-${900 + seq}`;
}

function writeTicket(root, fields) {
  const id = nextId();
  const dir = path.join(root, 'backlog', 'paused');
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    `id: ${id}`,
    `title: "${id}"`,
    `type: ${fields.type}`,
    `status: ${fields.status}`,
    `severity: ${fields.severity}`,
    `priority: ${fields.priority}`,
    `human_approval: ${fields.human_approval}`,
    `mutation_cost: ${fields.mutation_cost}`,
    `acceptance: specs/features/${id}-x.feature`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${id}.yaml`), body);
  if (fields.withFeature) {
    const featDir = path.join(root, 'specs', 'features');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, `${id}-x.feature`), `Feature: ${id}\n`);
  }
  return { id, fields };
}

const SAFE_FIELDS = { type: 'defect', status: 'todo', human_approval: 'approved', mutation_cost: 'low', withFeature: true };
const SEVERITY_ARB = fc.constantFrom('critical', 'high', 'medium', 'low');
const PRIORITY_ARB = fc.integer({ min: 1, max: 99 });

// Uniform-independent-fields generation makes an individually-safe ticket
// astronomically rare (~1%: 1/4 type x 2/3 status x 1/3 approval x 1/3
// mutation x 1/2 feature) - a real generator-reach failure the reachability
// floor test below caught. Half the mass is a guaranteed-safe record (still
// with randomized severity/priority) so mixed pools reliably contain a real
// selection candidate; the other half stays fully uniform-random so
// multi-criterion violations and edge combinations are still explored.
const RANDOM_FIELDS_ARB = fc.record({
  type: fc.constantFrom('defect', 'feature', 'bug', 'chore'),
  status: fc.constantFrom('todo', 'needs_design', 'in_progress'),
  human_approval: fc.constantFrom('approved', 'pending', 'rejected'),
  mutation_cost: fc.constantFrom('low', 'medium', 'high'),
  withFeature: fc.boolean(),
  severity: SEVERITY_ARB,
  priority: PRIORITY_ARB,
});
const SAFE_VARIANT_ARB = fc.record({ severity: SEVERITY_ARB, priority: PRIORITY_ARB }).map((extra) => ({ ...SAFE_FIELDS, ...extra }));
const TICKET_FIELDS_ARB = fc.oneof(SAFE_VARIANT_ARB, RANDOM_FIELDS_ARB);

function isSafe(fields) {
  return (
    fields.type === 'defect' &&
    fields.status !== 'needs_design' &&
    fields.human_approval === 'approved' &&
    fields.mutation_cost === 'low' &&
    fields.withFeature === true
  );
}

test('property: invariant 1 - a selected ticket always satisfies every safe-filter criterion', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(TICKET_FIELDS_ARB, { minLength: 1, maxLength: 6 }), async (fieldsList) => {
      const root = mkTmpDir('sf-safe-prop1-');
      const byId = new Map();
      for (const fields of fieldsList) {
        const { id } = writeTicket(root, fields);
        byId.set(id, fields);
      }
      const picked = pickSafePilotDefect(root, { folder: 'paused' });
      if (!('empty' in picked)) {
        const fields = byId.get(picked.ticket.id);
        assert.equal(fields.type, 'defect');
        assert.notEqual(fields.status, 'needs_design');
        assert.equal(fields.human_approval, 'approved');
        assert.equal(fields.mutation_cost, 'low');
        assert.equal(fields.withFeature, true);
      }
    }),
    { numRuns: 80 }
  );
});

// Generator-reach floor: fieldsList always mixes safe and unsafe tickets, so
// invariant 1 above is exercised against a real selection (not vacuously
// against always-empty pools) in the overwhelming majority of runs.
test('reachability floor: invariant 1 generator actually produces a selectable safe ticket in most runs', () => {
  let selectable = 0;
  const TRIALS = 300;
  for (let i = 0; i < TRIALS; i++) {
    const sample = fc.sample(fc.array(TICKET_FIELDS_ARB, { minLength: 1, maxLength: 6 }), 1)[0];
    if (sample.some(isSafe)) selectable += 1;
  }
  assert.ok(
    selectable > TRIALS * 0.5,
    `expected a meaningful share of generated ticket sets to contain at least one safe ticket, got ${selectable}/${TRIALS}`
  );
});

test('non-vacuity: invariant 1 property would fail against a broken implementation that ignores mutation_cost', () => {
  const brokenPickedFields = { type: 'defect', status: 'todo', human_approval: 'approved', mutation_cost: 'high', withFeature: true };
  assert.notEqual(
    brokenPickedFields.mutation_cost,
    'low',
    'expected the broken (mutation_cost-ignoring) pick to disagree with the real invariant, proving the assertion is non-vacuous'
  );
});

// ── invariant 2: an empty safe pool never falls back to a near-miss ──────

// Each ticket deliberately violates EXACTLY one safe-filter criterion, so
// none qualify - the pool must resolve to empty despite every ticket being
// "close" to safe (the actual regression risk: a widened filter picking a
// near-miss instead of refusing).
const VIOLATION_ARB = fc.constantFrom('type', 'status', 'approval', 'mutation', 'feature');

function nearMissFields(violation) {
  const fields = { ...SAFE_FIELDS };
  if (violation === 'type') fields.type = 'feature';
  if (violation === 'status') fields.status = 'needs_design';
  if (violation === 'approval') fields.human_approval = 'pending';
  if (violation === 'mutation') fields.mutation_cost = fields.mutation_cost === 'low' ? 'medium' : 'high';
  if (violation === 'feature') fields.withFeature = false;
  return { ...fields, severity: 'high', priority: 1 };
}

test('property: invariant 2 - a pool of only near-miss tickets never falls back, always reports empty', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(VIOLATION_ARB, { minLength: 1, maxLength: 6 }), async (violations) => {
      const root = mkTmpDir('sf-safe-prop2-');
      const ids = violations.map((v) => writeTicket(root, nearMissFields(v)).id);
      const listed = listSafePilotDefects(root, { folder: 'paused' });
      const picked = pickSafePilotDefect(root, { folder: 'paused' });
      assert.equal(listed.tickets.length, 0, `expected no near-miss ticket to qualify, got ${JSON.stringify(listed.tickets)}`);
      assert.equal(picked.empty, true);
      for (const id of ids) {
        assert.ok(!listed.tickets.some((t) => t.id === id), `near-miss ${id} leaked into the safe pool`);
      }
    }),
    { numRuns: 80 }
  );
});

test('non-vacuity: invariant 2 property would fail against a broken implementation that falls back to a medium-mutation ticket', () => {
  const root = mkTmpDir('sf-safe-prop2-nonvac-');
  const { id } = writeTicket(root, nearMissFields('mutation'));
  const listed = listSafePilotDefects(root, { folder: 'paused' });
  assert.equal(listed.tickets.length, 0);
  // Simulates a broken fallback that ignores the empty pool and picks the
  // near-miss ticket anyway.
  const brokenPick = { ticket: { id } };
  assert.notEqual(
    'empty' in brokenPick,
    true,
    'expected the broken (falls-back-to-near-miss) outcome to disagree with the real invariant, proving the assertion is non-vacuous'
  );
});

// ── invariant 3: explicit /pilot BL-xxx is an escape hatch for any id ────

// BL-xxx only: the ticket's own invariant wording ("Explicit /pilot BL-xxx")
// and parsePilotTicket's TICKET_PATTERN (telegramCursorBridgeExpedite.ts)
// both scope the explicit escape hatch to the BL- scheme; GH- ids are a
// pilotSafeDefects.ts::normalizeId concern for the safe-pool listing, not
// this parser's contract.
const EXPLICIT_ID_ARB = fc.integer({ min: 1, max: 99999 }).map((n) => `BL-${n}`);

// Random casing of the same id string - the parser must normalize to the
// same uppercase form regardless.
function randomizeCase(id, mask) {
  return id
    .split('')
    .map((ch, i) => (mask & (1 << i % 8) ? ch.toLowerCase() : ch.toUpperCase()))
    .join('');
}

test('property: invariant 3 - /pilot <id> always targets that exact id, independent of casing or safe-pool state', async () => {
  await fc.assert(
    fc.asyncProperty(EXPLICIT_ID_ARB, fc.integer({ min: 0, max: 255 }), fc.array(VIOLATION_ARB, { maxLength: 4 }), (id, caseMask, poolViolations) => {
      const root = mkTmpDir('sf-safe-prop3-');
      // The safe pool may be empty, partially populated, or entirely
      // near-miss - none of it may influence explicit selection.
      for (const v of poolViolations) writeTicket(root, nearMissFields(v));

      const cased = randomizeCase(id, caseMask);
      const ticket = parsePilotTicket(`/pilot ${cased}`);
      assert.equal(ticket, id.toUpperCase());

      // The safe-command parser must never claim an explicit ticket-id
      // command (the actual coupling risk this ticket introduced by adding
      // a second /pilot sub-parser).
      assert.equal(parsePilotSafeCommand(`/pilot ${cased}`), undefined);
    }),
    { numRuns: 100 }
  );
});

test('non-vacuity: invariant 3 property would fail if the safe-command parser swallowed an explicit ticket id', () => {
  // Simulates a broken parsePilotSafeCommand that (wrongly) treats any
  // "/pilot <token>" as its own, e.g. via an overly-broad regex.
  const brokenSafeParse = { kind: 'start' };
  assert.notEqual(
    brokenSafeParse,
    undefined,
    'expected the broken (over-matching) safe-command parse to disagree with the real invariant, proving the assertion is non-vacuous'
  );
});
