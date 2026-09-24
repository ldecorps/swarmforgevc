'use strict';

// BL-1687's one declared invariant (coder first authorship - BL-654):
//
// "Requiring any step handler under specs/pipeline/steps alone in a
// fresh process never loads extension/out/bridge/bridgeServer: the
// bridge graph loads only inside a step that starts a bridge, whatever
// syntax the require uses."
//
// "whatever syntax the require uses" is this ticket's whole point: a
// literal require('.../bridgeServer') is not the only shape that loads
// the module - sixteen of the seventeen this ticket fixed built the path
// with path.join() at module scope, and one required it inside a
// module-scope destructuring of an object literal, neither visible to a
// text grep for the literal string. Encoded against the real, impure
// loader-probe census (censusOneHandler / censusAllHandlers,
// extension/test/helpers/stepHandlerRequireCensus.js's own instrumented
// fresh-child require) - never a reimplementation of the detection.
//
// Generator reach: property one draws a shuffled full permutation of the
// seventeen REAL handlers this ticket fixed per run (BL-1445's own pin;
// BL-1062's by-construction remedy - a single fc.constantFrom pick per run
// left a real, observed chance of never landing on one of the seventeen).
// Property two is the non-vacuity/generality proof the invariant's own
// "whatever syntax" clause demands: a shuffled full permutation of the six
// cells crossing THREE distinct require syntaxes (literal string,
// path.join-built, object-literal-embedded) with eager-vs-lazy placement
// proves the loader probe's verdict tracks actual loading, never the syntax
// used to reach it - every cell touched every run, by construction.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');
const { censusOneHandler, censusAllHandlers } = require('./helpers/stepHandlerRequireCensus');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const BRIDGE_SERVER_PATTERN = /bridge\/bridgeServer/;

// The seventeen the ticket's own feature Examples table names (BL-1445
// census pin - named, not derived); mirrors
// specs/pipeline/steps/bl1687BridgeServerLoadersRequireItInsideTheStepSteps.js's
// own copy exactly - both must make the same true claim about the same
// real tree.
const SEVENTEEN_NAMED_HANDLERS = [
  'bl1634RejectedManifestOffersNoPageFromItSteps.js',
  'bl551LlmCostLedgerSteps.js',
  'bl565CostLedgerSyntheticPricingSteps.js',
  'bl709BubbleItsOwnTelegramTopicSteps.js',
  'bl788BubblePairingClientLogsAdoptSteps.js',
  'bl829BubbleRemotePagePagerSteps.js',
  'bl851SideloadApkPreauthSteps.js',
  'bl866CompanionManifestPackageCatalogSteps.js',
  'burnRateSteps.js',
  'deviceRegistrySteps.js',
  'gateAnswerSteps.js',
  'gatesListSteps.js',
  'noInboundMessageIsEverLostSteps.js',
  'operatorProactiveNotifySteps.js',
  'replyRelayAtLeastOnceSteps.js',
  'standingOperatorTopicSteps.js',
  'telegramTopicThreadsSteps.js',
];

function bridgeServerLoaded(row) {
  return (row.requestedModules || []).some((request) => BRIDGE_SERVER_PATTERN.test(request));
}

test(
  'property (BL-1687 invariant): none of the seventeen named handlers loads the bridge graph when required alone, over repeated independent draws',
  () => {
    // BL-1062: a single fc.constantFrom pick per run leaves full coverage
    // to chance (17 items over 80 draws still misses one about 12% of the
    // time - this property caught exactly that on a re-run). A full
    // shuffled permutation per run touches every named handler by
    // construction, so the reach floor below can never be a coin flip.
    const RUNS = runsPerCell(3 * SEVENTEEN_NAMED_HANDLERS.length, SEVENTEEN_NAMED_HANDLERS.length);
    const reach = Object.fromEntries(SEVENTEEN_NAMED_HANDLERS.map((h) => [h, 0]));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(SEVENTEEN_NAMED_HANDLERS, {
          minLength: SEVENTEEN_NAMED_HANDLERS.length,
          maxLength: SEVENTEEN_NAMED_HANDLERS.length,
        }),
        (order) => {
          for (const handler of order) {
            reach[handler] += 1;
            const row = censusOneHandler(handler);
            assert.equal(row.error, null, `${handler}: expected no require error, got: ${row.error}`);
            assert.equal(
              bridgeServerLoaded(row),
              false,
              `${handler}: expected bridge/bridgeServer NOT among requestedModules, got: ${JSON.stringify(row.requestedModules)}`
            );
          }
        }
      ),
      { numRuns: RUNS }
    );
    assertReachFloor(reach, SEVENTEEN_NAMED_HANDLERS, RUNS, 'BL-1687 named handler');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

// The three require shapes the ticket's own description names: a literal
// string, a path.join()-built path (sixteen of the seventeen), and the
// same literal string but destructured from a module-scope object
// literal that spans multiple lines (bl709's own shape - invisible to a
// single-line ^const grep). Every shape is generated both EAGER (module
// scope) and LAZY (inside an uncalled function) so the property proves
// the loader probe's verdict is syntax-independent in both directions.
// pathJoinBuilt mirrors the REAL sixteen handlers' own shape exactly:
// `path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer')` - the absolute
// EXT_DIR prefix as ONE literal argument (never split into segments: an
// absolute path split on path.sep and filtered for truthiness silently
// drops the leading empty string from the leading slash, turning it into
// a relative path - the exact bug this property caught against itself
// on the first run, before this comment existed).
const REQUIRE_SYNTAXES = {
  literal: (extDir) => `require(${JSON.stringify(path.join(extDir, 'out', 'bridge', 'bridgeServer'))})`,
  pathJoinBuilt: (extDir) => `require(path.join(${JSON.stringify(extDir)}, 'out', 'bridge', 'bridgeServer'))`,
  objectLiteralDestructure: (extDir) =>
    `(() => {\n  const {\n    startBridge,\n  } = require(${JSON.stringify(path.join(extDir, 'out', 'bridge', 'bridgeServer'))});\n  return { startBridge };\n})()`,
};

function buildFixtureSource(syntaxKey, placement, extDir) {
  const requireExpr = REQUIRE_SYNTAXES[syntaxKey](extDir);
  const lines = ["'use strict';", "const path = require('node:path');"];
  if (placement === 'eager') {
    lines.push(`const _mod = ${requireExpr};`);
  } else {
    lines.push('function useIt() {');
    lines.push(`  return ${requireExpr};`);
    lines.push('}');
  }
  lines.push('function registerSteps() {}');
  lines.push('module.exports = { registerSteps };');
  return lines.join('\n');
}

// Cross product of the 3 syntaxes x 2 placements, as the population a
// shuffled-permutation-per-run generator draws over by construction (same
// BL-1062 remedy as the property above - two independent constantFrom picks
// over a 6-cell space left a small but real chance of never landing on one
// combination).
const SYNTAX_PLACEMENT_CELLS = Object.keys(REQUIRE_SYNTAXES).flatMap((syntaxKey) =>
  ['eager', 'lazy'].map((placement) => ({ syntaxKey, placement }))
);
const CELL_LABELS = SYNTAX_PLACEMENT_CELLS.map((c) => `${c.syntaxKey}:${c.placement}`);

test(
  'property (BL-1687 invariant) non-vacuity: the loader probe tracks whether bridgeServer actually loads, independent of which require SYNTAX reaches it',
  () => {
    const RUNS = runsPerCell(3 * SYNTAX_PLACEMENT_CELLS.length, SYNTAX_PLACEMENT_CELLS.length);
    const reach = Object.fromEntries(CELL_LABELS.map((label) => [label, 0]));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(SYNTAX_PLACEMENT_CELLS, {
          minLength: SYNTAX_PLACEMENT_CELLS.length,
          maxLength: SYNTAX_PLACEMENT_CELLS.length,
        }),
        (order) => {
          order.forEach(({ syntaxKey, placement }, index) => {
            reach[`${syntaxKey}:${placement}`] += 1;
            const fixtureDir = mkTmpDir('bl1687-invariant-prop-');
            const fileName = `zzzGenerated${syntaxKey}${placement}${index}Steps.js`;
            const extDir = path.join(__dirname, '..');
            fs.writeFileSync(path.join(fixtureDir, fileName), buildFixtureSource(syntaxKey, placement, extDir));

            const { rows } = censusAllHandlers(fixtureDir);
            assert.equal(rows.length, 1, `expected exactly one row, got: ${JSON.stringify(rows)}`);
            const row = rows[0];
            assert.equal(row.error, null, `${fileName}: expected no require error, got: ${row.error}`);

            const expectedLoaded = placement === 'eager';
            assert.equal(
              bridgeServerLoaded(row),
              expectedLoaded,
              `${fileName} (${syntaxKey}, ${placement}): expected loaded=${expectedLoaded}, got requestedModules: ${JSON.stringify(row.requestedModules)}`
            );
          });
        }
      ),
      { numRuns: RUNS }
    );
    assertReachFloor(reach, CELL_LABELS, RUNS, 'BL-1687 require-syntax x placement cell');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
