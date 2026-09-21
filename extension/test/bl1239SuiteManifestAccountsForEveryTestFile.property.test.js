'use strict';

// BL-1239 declared invariant: "Every file under swarmforge/scripts/test/
// appears in exactly one manifest lane, and every manifest row names a file
// that exists."
//
// Runs ONLY via `npm run test:properties`.
//
// The invariant is enforced by suite_inventory_cli.bb / suite_inventory_lib.bb
// (Babashka), so this drives the REAL CLI against generated scratch trees
// rather than reimplementing the verdict in JS - a JS copy of the check would
// only assert that the copy agrees with itself.
//
// Generator reach (BL-654): the manifest is DERIVED from the generated file
// set by one deliberately applied breakage drawn from an explicit enum, so
// every case is a targeted violation by construction rather than a hoped-for
// coincidence. Independent generation would essentially never produce a
// duplicate lane row or a row naming an absent file. The floor below asserts
// each breakage was actually reached.
//
// Non-vacuity: verified by hand while authoring - reverting
// suite_inventory_lib.bb's `first column is not a test file name` clause makes
// the `ticket-id-row` case fail here, and removing the duplicate/missing
// clauses makes their cases fail.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { spawnSync } = require('node:child_process');
const { mkTmpDir, sweepStaleTmpDirs } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const INVENTORY_CLI = path.join(TEST_DIR, 'suite_inventory_cli.bb');
const FIXTURE_PREFIX = 'bl1239-prop-';

// BL-971: a killed run traps nothing, so sweep by prefix BEFORE the run too.
// BL-1677: scoped by owner pid through the shared helper - a blind prefix
// sweep destroys a live peer's roots the instant two instances of this file
// are ever alive at once on the host (BL-1385/BL-1390's shape).
function sweepStaleFixtures() {
  sweepStaleTmpDirs({ prefix: FIXTURE_PREFIX });
}
sweepStaleFixtures();

const BREAKAGES = ['none', 'unlisted-file', 'row-without-file', 'listed-twice', 'ticket-id-row'];

const nameArb = fc.uniqueArray(
  fc.tuple(fc.stringMatching(/^[a-z]{3,8}$/), fc.constantFrom('sh', 'bb')).map(
    ([stem, kind]) => (kind === 'sh' ? `test_${stem}.sh` : `${stem}_test_runner.bb`)
  ),
  { minLength: 2, maxLength: 6 }
);

function row(file, lane, date, reason) {
  return `${file}\t${lane}\t${date || ''}\t${reason || ''}`;
}

// The manifest is built FROM the file set, then broken in exactly one way.
function buildCase(files, breakage) {
  const present = [...files];
  const rows = present.map((f) => row(f, 'standing'));
  switch (breakage) {
    case 'none':
      break;
    case 'unlisted-file':
      rows.pop();
      break;
    case 'row-without-file':
      // Derive the absent name FROM a present one, so it is a plausible row
      // rather than an obviously foreign string.
      rows.push(row(`test_${present[0].replace(/\W/g, '')}_gone.sh`, 'standing'));
      break;
    case 'listed-twice':
      rows.push(row(present[0], 'excluded', '2026-08-29', 'slow'));
      break;
    case 'ticket-id-row':
      // The exact shape found on main: ticket id in column 1, the filename
      // shoved into column 3.
      rows.push(`BL-780\tbl780_rotation_actionability_ordering\t${present[0]}\tunit`);
      break;
    default:
      throw new Error(`unknown breakage ${breakage}`);
  }
  return { present, manifest: `# fixture\n${rows.join('\n')}\n` };
}

function runInventory(present, manifest) {
  const dir = fs.realpathSync(mkTmpDir(`${FIXTURE_PREFIX}${process.pid}-`));
  try {
    for (const f of present) fs.writeFileSync(path.join(dir, f), '');
    fs.writeFileSync(path.join(dir, 'suite-manifest.tsv'), manifest);
    const res = spawnSync('bb', [INVENTORY_CLI, dir], { encoding: 'utf8', timeout: 60_000 });
    return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// BL-1587: every breakage is reached BY CONSTRUCTION - an outer loop over
// BREAKAGES, each cell drawing runsPerCell(60, 5) times - rather than hoped
// for by a single fc.constantFrom(...BREAKAGES) draw. The draw budget of 60
// and the floor value of 3 are unchanged.
const BREAKAGE_CELL_RUNS = runsPerCell(60, BREAKAGES.length);

test('property: the inventory gate passes exactly when every file has one row and every row names a file', () => {
  const reached = new Map(BREAKAGES.map((b) => [b, 0]));
  for (const breakage of BREAKAGES) {
    fc.assert(
      fc.property(nameArb, fc.constant(breakage), (files, breakage) => {
        const { present, manifest } = buildCase(files, breakage);
        const result = runInventory(present, manifest);
        reached.set(breakage, reached.get(breakage) + 1);
        if (breakage === 'none') {
          assert.equal(result.status, 0, `a manifest in exact agreement was rejected:\n${result.out}`);
        } else {
          assert.equal(result.status, 1, `breakage ${breakage} was accepted:\n${result.out}`);
        }
      }),
      { numRuns: BREAKAGE_CELL_RUNS }
    );
  }
  // Asserted reachability floor, never a hoped-for one: a breakage the
  // generator never produced proves nothing about it.
  assertReachFloor(Object.fromEntries(reached), BREAKAGES, 3, 'breakage');
});

test('property: a malformed row is reported as malformed, not as a missing file', () => {
  fc.assert(
    fc.property(nameArb, (files) => {
      const { present, manifest } = buildCase(files, 'ticket-id-row');
      const { out } = runInventory(present, manifest);
      assert.ok(
        out.includes('first column is not a test file name: "BL-780"'),
        `malformed row not named as malformed:\n${out}`
      );
      assert.ok(
        !out.includes('in the manifest but not in the tree: BL-780'),
        `malformed row misreported as a missing file, sending the reader hunting:\n${out}`
      );
    }),
    { numRuns: 15 }
  );
});
