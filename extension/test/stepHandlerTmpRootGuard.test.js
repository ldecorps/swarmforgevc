const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findStepHandlerTmpRootOffenders } = require('./helpers/stepHandlerTmpRootFinder');

// BL-1636: the standing unit-lane guard - the file in the lane every parcel
// runs (required_wiring anchor). A NEW offender (a handler that mkdtemps
// without registering for reaping, not already in the committed census)
// fails this test; a stale census entry (a file the census still names but
// that no longer offends - it was migrated) also fails, so the census
// ratchets down and never silently regrows.

const REPO_ROOT = path.join(__dirname, '..', '..');
// specs/pipeline/steps - the acceptance step-handler tree this guard scans.
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
const CENSUS_PATH = path.join(__dirname, 'step-handler-tmp-root-census.txt');

function readCensus() {
  return new Set(
    fs.readFileSync(CENSUS_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
}

test('the real handler tree names no offender outside the committed census', () => {
  const census = readCensus();
  const offenders = new Set(findStepHandlerTmpRootOffenders(STEPS_DIR));
  const newOffenders = [...offenders].filter((f) => !census.has(f));
  assert.deepEqual(newOffenders, [], `new offender(s) not in the census: ${JSON.stringify(newOffenders)}`);
});

test('every committed census entry still offends - a migrated handler must be removed from the census', () => {
  const census = readCensus();
  const offenders = new Set(findStepHandlerTmpRootOffenders(STEPS_DIR));
  const stale = [...census].filter((f) => !offenders.has(f));
  assert.deepEqual(stale, [], `stale census entr(y/ies) that no longer offend - remove from the census: ${JSON.stringify(stale)}`);
});

test('the census pins its population at at least 400 handlers', () => {
  const census = readCensus();
  assert.ok(census.size >= 400, `expected at least 400 census entries, got ${census.size}`);
});

test('the five handlers fixed this session (BL-831) do not appear in the census', () => {
  const census = readCensus();
  const fixedThisSession = [
    'bl1624StandingShellTestNeverDiffsAgainstMainSteps.js',
    'bl1626PromotionFixturesCarryTheClosureSteps.js',
    'bl1632Bl1071ProbeCountsOnlyItsOwnFixturesHangsSteps.js',
    'bl693DocsDuplicateParagraphGuardSteps.js',
    'bl831BubblePipelineBoardPageSteps.js',
  ];
  for (const name of fixedThisSession) {
    assert.equal(census.has(name), false, `${name} was fixed this session and must not be in the census`);
  }
});
