const assert = require('node:assert/strict');
const path = require('node:path');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { buildGradleEnv } = require('../../specs/pipeline/steps/lib/androidGradle');

// BL-1635's declared invariant: "The compiled form of a source string
// literal never depends on the locale of the process that compiled it:
// every JVM the Android build launches ... reads sources as UTF-8."
// BL-1635's own acceptance scenario 02 pins this at one fixed base
// environment ({PATH, HOME}); this generalizes over an arbitrary base
// environment - buildGradleEnv must ALWAYS add the UTF-8 locale/encoding
// overrides and must ALWAYS preserve every one of the caller's own keys
// that is not one of the three it sets, whatever that caller's
// environment happens to carry.
//
// BL-1584/BL-1589: the "extra key present / absent" cell is reached by
// CONSTRUCTION (i % CELLS.length over 30 draws), never sampled and hoped
// for.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const OVERRIDE_KEYS = ['LANG', 'LC_ALL', 'JAVA_TOOL_OPTIONS'];
const CELLS = ['withExtraKeys', 'baseOnly'];
const DRAWS = 30;
const CELL_FLOOR = runsPerCell(DRAWS, CELLS.length);

const rng = (() => {
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
const randInt = (n) => Math.floor(rng() * n);
const randWord = () => {
  let w = '';
  for (let i = 0, n = 3 + randInt(6); i < n; i += 1) w += String.fromCharCode(97 + randInt(26));
  return w;
};

test('property (BL-1635): buildGradleEnv always pins a UTF-8 locale/encoding and always preserves the caller\'s own keys', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS; i += 1) {
    const cell = CELLS[i % CELLS.length];
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;

    const baseEnv = { PATH: `/usr/bin-${randWord()}`, HOME: `/home/${randWord()}` };
    if (cell === 'withExtraKeys') {
      const extraCount = 1 + randInt(3);
      for (let k = 0; k < extraCount; k += 1) {
        baseEnv[`EXTRA_${randWord().toUpperCase()}_${k}`] = randWord();
      }
    }

    const built = buildGradleEnv(baseEnv);

    // Invariant, first half: every JVM the build launches is told UTF-8,
    // whatever the caller's own environment carried.
    for (const key of ['LANG', 'LC_ALL']) {
      assert.match(built[key] || '', /utf-?8/i, `expected ${key} to name a UTF-8 locale for base env ${JSON.stringify(baseEnv)}, got: ${built[key]}`);
    }
    assert.match(
      built.JAVA_TOOL_OPTIONS || '',
      /-Dfile\.encoding=UTF-8/,
      `expected JAVA_TOOL_OPTIONS to pin file.encoding=UTF-8 for base env ${JSON.stringify(baseEnv)}, got: ${built.JAVA_TOOL_OPTIONS}`
    );

    // Invariant, second half: the builder ADDS a locale, it never DROPS
    // the caller's own keys - every key in baseEnv not among the three
    // overrides survives unchanged.
    for (const key of Object.keys(baseEnv)) {
      if (OVERRIDE_KEYS.includes(key)) continue;
      assert.equal(built[key], baseEnv[key], `expected base env key "${key}" preserved, base env: ${JSON.stringify(baseEnv)}`);
    }
  }

  assertReachFloor(cellCoverage, CELLS, CELL_FLOOR, 'bl1635 cell');
});
