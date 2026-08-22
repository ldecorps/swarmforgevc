const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-643 invariant 1 (property authorship rests with the coder, first pass -
// BL-654): "Every path in the reference table - launcher, stop path, role
// prompt, log - resolves in the repo at the commit that ships the table. A
// path in this document is checked, never recalled; a wrong stop path here
// is the BL-637 defect in a new place."
//
// This is a genuine property, not one hardcoded row: it holds the SAME
// checker function (checkPathColumn / checkLogGrounding, exported from the
// real step-handler module - the one the acceptance suite's scenario 03
// also drives) against every (row, column) pair the live reference table
// actually contains, so a future row added with a bad path fails this test
// without anyone updating a parallel hardcoded list here.
//
// Generator reach: the table's rows x checked columns is this invariant's
// own finite domain (no wider space exists to sample from - there is one
// real reference table). numRuns is a large multiple of the domain size so
// fast-check's constantFrom covers every entry with overwhelming
// probability, the same reachability-floor reasoning as BL-684's own
// evidence-file property test.
const {
  parseReferenceTable,
  checkPathColumn,
  checkLogGrounding,
} = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');

const PATH_COLUMNS = ['Launcher', 'Stop path', 'Role prompt'];

function buildDomain() {
  const { rows } = parseReferenceTable();
  const domain = [];
  for (const row of rows) {
    for (const column of PATH_COLUMNS) {
      domain.push({ kind: 'path', row, column });
    }
    domain.push({ kind: 'log', row });
  }
  return domain;
}

test('property: every non-pipeline-agent row path (launcher, stop path, role prompt, log) resolves in the repo', () => {
  const domain = buildDomain();
  assert.ok(domain.length > 0, 'fixture assumption broken: expected the reference table to have at least one row');
  fc.assert(
    fc.property(fc.constantFrom(...domain), (entry) => {
      if (entry.kind === 'path') {
        checkPathColumn(entry.row, entry.column); // throws on a missing/uncheckable path
      } else {
        checkLogGrounding(entry.row); // throws when a log literal isn't grounded in its source
      }
    }),
    { numRuns: domain.length * 10 }
  );
});

test('property: the checker is non-vacuous - it fails against a deliberately broken row, and the real table has no such row', () => {
  const brokenPathRow = {
    Agent: 'Fixture Broken Agent',
    Launcher: '[`swarmforge/scripts/this_file_does_not_exist.sh`](../../swarmforge/scripts/this_file_does_not_exist.sh)',
    'Stop path': '— none —',
    'Role prompt': '— none —',
    'Log location': '`.swarmforge/operator/fixture-broken.log`',
  };
  assert.throws(
    () => checkPathColumn(brokenPathRow, 'Launcher'),
    /path\(s\) named in the table do not exist/,
    'checker did not catch a fabricated nonexistent launcher path - the property test would be vacuously true'
  );

  const tmpScript = mkTmpDir('bl643-log-fixture-');
  const scriptPath = path.join(tmpScript, 'fake_launcher.sh');
  fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho no-log-path-here\n');
  const brokenLogRow = {
    Agent: 'Fixture Broken Agent',
    Launcher: `[\`fake_launcher.sh\`](${scriptPath})`,
    'Stop path': '— none —',
    'Role prompt': '— none —',
    'Log location': '`.swarmforge/operator/a-log-path-not-in-the-script.log`',
  };
  assert.throws(
    () => checkLogGrounding(brokenLogRow),
    /log literal\(s\) not found \(by basename\) in its verification source/,
    'checker did not catch a log literal absent from its claimed source - the property test would be vacuously true'
  );

  // And now the positive control: the real table, run through the exact
  // same checker, raises nothing - this is the property test above,
  // restated as a single assertion so a reader sees both halves together.
  const { rows } = parseReferenceTable();
  for (const row of rows) {
    for (const column of PATH_COLUMNS) {
      assert.doesNotThrow(() => checkPathColumn(row, column), `real table row "${row.Agent}" column "${column}" unexpectedly failed`);
    }
    assert.doesNotThrow(() => checkLogGrounding(row), `real table row "${row.Agent}" log grounding unexpectedly failed`);
  }
});
