'use strict';

// BL-1860 declared invariant (coder first authorship - BL-654):
//   "The register-row step passes when each row is present and owned by
//    BL-1712 while BL-1712 is open, and when no row names either file once
//    BL-1712 is in backlog/done; any other state fails."
//
// The step (bl1712PricingTableOpus55Steps.js) is ticketState(id, root)
// composed with registerRowsVerdict(state, register). Each draw builds a
// REAL backlog tree under mkdtemp: BL-1712's YAML is placed in any subset of
// active, paused, done, done/M8 and done/M8/archive, named either
// `BL-1712-<slug>.yaml` or bare `BL-1712.yaml`. The register gives each of
// the two files a row that is absent, owned by BL-1712, or owned by another
// ticket. The REAL functions must pass exactly when the invariant says so.
//
// Collision candidates are constructed:
// - the YAML in two places at once (open and done), which is no state the
//   invariant names, so the step must fail;
// - a decoy `BL-17120-<slug>.yaml`, the ticket's id as a prefix, placed
//   wherever the draw puts it, which must never count as BL-1712;
// - done folders two levels deep;
// - a row naming the right file but owned by another ticket.
// Reach floor: pass-open, pass-done, the two-place failure and the decoy-only
// tree all occur.
//
// Non-vacuity: with ticketState returning 'open' whenever active/paused
// holds the YAML (the hotfix's precedence, before this review), the
// two-place draws fail ("expected verdict false"). With the decoy matched
// by a bare prefix test, decoy-only trees read as BL-1712. Both restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { ticketState, registerRowsVerdict, REGISTER_NEEDLES } = require('../../specs/pipeline/steps/bl1712PricingTableOpus55Steps');

const PLACES = {
  active: ['active'],
  paused: ['paused'],
  done: ['done'],
  doneM8: ['done', 'M8'],
  doneDeep: ['done', 'M8', 'archive'],
};
const OPEN_PLACES = new Set(['active', 'paused']);
const ROW_FILES = {
  'pricingTable.test.js': 'extension/test/pricingTable.test.js',
  'BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature':
    'specs/features/BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature',
};

function build({ places, bare, decoyPlaces, rows }) {
  const root = mkTmpDir('sfvc-bl1860-');
  for (const dirs of Object.values(PLACES)) fs.mkdirSync(path.join(root, 'backlog', ...dirs), { recursive: true });
  for (const p of places) {
    fs.writeFileSync(path.join(root, 'backlog', ...PLACES[p], bare ? 'BL-1712.yaml' : 'BL-1712-the-pricing-table.yaml'), 'id: BL-1712\n');
  }
  for (const p of decoyPlaces) {
    fs.writeFileSync(path.join(root, 'backlog', ...PLACES[p], 'BL-17120-a-decoy.yaml'), 'id: BL-17120\n');
  }
  const lines = ['# lane\tfile\towner\tfirst_seen\tnote'];
  REGISTER_NEEDLES.forEach((needle, i) => {
    if (rows[i] === 'absent') return;
    lines.push(['unit', ROW_FILES[needle], rows[i] === 'owned' ? 'BL-1712' : 'BL-9999', '2026-10-03', 'drawn'].join('\t'));
  });
  return { root, register: `${lines.join('\n')}\n` };
}

function expected({ places, rows }) {
  const open = places.some((p) => OPEN_PLACES.has(p));
  const done = places.some((p) => !OPEN_PLACES.has(p));
  if (open && !done) return rows.every((r) => r === 'owned');
  if (done && !open) return rows.every((r) => r === 'absent');
  return false;
}

const draw = fc.record({
  places: fc.subarray(Object.keys(PLACES)),
  bare: fc.boolean(),
  decoyPlaces: fc.subarray(Object.keys(PLACES)),
  rows: fc.tuple(fc.constantFrom('absent', 'owned', 'other'), fc.constantFrom('absent', 'owned', 'other')),
});

const EXAMPLES = [
  [{ places: ['active'], bare: false, decoyPlaces: ['done'], rows: ['owned', 'owned'] }],
  [{ places: ['doneDeep'], bare: true, decoyPlaces: ['active'], rows: ['absent', 'absent'] }],
  [{ places: ['paused', 'doneM8'], bare: false, decoyPlaces: [], rows: ['owned', 'owned'] }],
  [{ places: [], bare: false, decoyPlaces: ['active', 'done'], rows: ['owned', 'owned'] }],
];

test('BL-1860/BL-654 invariant: the register-row step passes exactly in the two states the invariant names', () => {
  const reach = { passOpen: 0, passDone: 0, twoPlaces: 0, decoyOnly: 0 };
  fc.assert(
    fc.property(draw, (d) => {
      const { root, register } = build(d);
      const got = registerRowsVerdict(ticketState('BL-1712', root), register).ok;
      const want = expected(d);
      assert.equal(got, want, `expected verdict ${want}, got ${got}: ${JSON.stringify(d)}`);
      const open = d.places.some((p) => OPEN_PLACES.has(p));
      const done = d.places.some((p) => !OPEN_PLACES.has(p));
      if (want && open) reach.passOpen += 1;
      if (want && done) reach.passDone += 1;
      if (open && done) reach.twoPlaces += 1;
      if (!d.places.length && d.decoyPlaces.length) reach.decoyOnly += 1;
    }),
    { numRuns: 200, examples: EXAMPLES }
  );
  for (const k of Object.keys(reach)) assert.ok(reach[k] >= 1, `${k} reached: ${JSON.stringify(reach)}`);
});
