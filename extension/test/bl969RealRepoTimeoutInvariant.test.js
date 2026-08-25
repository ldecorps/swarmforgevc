'use strict';

// BL-969 declared invariant, encoded EXHAUSTIVELY (BL-654; the quantified
// domain is the finite set of test() call sites in ONE file, so reading
// all of them every run is strictly stronger than sampling): no test in
// renderBriefingBurndownCli.test.js that derives history from the REAL
// repo runs on the suite-default timeout. Data source is read from each
// call site's own source slice - a test is fixture-driven iff its slice
// contains a code-level fixture marker (a writeFixtureSnapshot( call or
// the quoted --snapshot flag); everything else takes the real-repo
// derive+render path and must carry an explicit timeout argument. This is
// the structural trap for the exact miss that produced BL-969: BL-914's
// hand inventory said "the other three are fixture-fast" while one of
// them was a full real-repo run on the 20000ms default.
//
// Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
// parcel commit): the no-flags test's 60000 argument removed -> this test
// RED naming it; restored, green.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTestTimeouts } = require('../../specs/pipeline/steps/lib/testTimeoutParser');

const TARGET = path.join(__dirname, 'renderBriefingBurndownCli.test.js');
const FIXTURE_MARKERS = ['writeFixtureSnapshot(', "'--snapshot'"];

test('BL-969 invariant: every real-repo-deriving test in renderBriefingBurndownCli.test.js carries its own timeout', () => {
  const source = fs.readFileSync(TARGET, 'utf8');
  const calls = parseTestTimeouts(source);
  assert.ok(calls.length >= 5, `expected the file's five test call sites, parsed ${calls.length}`);

  // Slice the source per call site (name-anchored, in order) so each
  // test's data-source markers are read from ITS body, not a neighbor's.
  const anchored = calls.map((c) => ({ ...c, at: source.indexOf(`'${c.name.replace(/'/g, "\\'")}'`) }));
  for (const c of anchored) {
    assert.ok(c.at >= 0, `could not anchor test '${c.name}' in the source`);
  }
  anchored.sort((a, b) => a.at - b.at);

  const classified = anchored.map((c, i) => {
    const end = i + 1 < anchored.length ? anchored[i + 1].at : source.length;
    const slice = source.slice(c.at, end);
    const fixture = FIXTURE_MARKERS.some((m) => slice.includes(m));
    return { name: c.name, timeoutMs: c.timeoutMs, fixture };
  });

  const realRepo = classified.filter((c) => !c.fixture);
  const fixtures = classified.filter((c) => c.fixture);
  // Shape floor: a refactor that changes the split must surface here, not
  // silently reclassify.
  assert.equal(realRepo.length, 3, `expected exactly 3 real-repo tests, classified: ${JSON.stringify(classified)}`);
  assert.equal(fixtures.length, 2, `expected exactly 2 fixture tests, classified: ${JSON.stringify(classified)}`);

  for (const c of realRepo) {
    assert.ok(
      typeof c.timeoutMs === 'number',
      `real-repo test '${c.name}' runs on the suite-default timeout - it must carry its own (BL-969)`
    );
  }
});
