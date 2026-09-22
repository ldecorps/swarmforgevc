'use strict';

// BL-1685: step handlers for "Every eager bridgeServer requirer loads the
// bridge graph inside its step".
//
// Drives the REAL census helper (extension/test/helpers/stepHandlerRequireCensus.js)
// against the REAL specs/pipeline/steps tree - never a reimplementation of
// the require-timing or the loader-intercept instrumentation (same
// approach as BL-1658's own handler, which this reuses). Scenario 01
// requires each of the fourteen NAMED handlers in its own fresh child
// process (censusOneHandler) and checks BOTH the ms budget and that
// extension/out/bridge/bridgeServer does not appear among the require
// requests that census observed; scenario 02 drives the byte-safe grep
// census the ticket's own text pins (BL-1445) over the real
// specs/pipeline/steps tree and asserts the eager (module-scope) require
// count is zero across every file the substring census names.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { censusOneHandler } = require('../../../extension/test/helpers/stepHandlerRequireCensus');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FEATURE = 'BL-1685 Every eager bridgeServer requirer loads the bridge graph inside its step';

// 2026-09-21: the same value the guard test and BL-1658/BL-1630's own step
// handlers use - this file must apply the SAME budget to make the same
// true claim about the same real tree.
const PER_HANDLER_BUDGET_MS = 400;

// Best-of-3 (mirrors the guard test's own confirmAloneMs and BL-1658's
// copy exactly - a single fresh-child reading can land on a sibling
// agent's scheduling spike on this shared, continuously-running swarm
// host).
function confirmAloneMs(file) {
  const samples = [censusOneHandler(file).ms, censusOneHandler(file).ms, censusOneHandler(file).ms];
  return Math.min(...samples);
}

// The fourteen the ticket's own feature scenario 01 Examples table names
// (BL-1445 census pin - named, not derived).
const FOURTEEN_NAMED_HANDLERS = [
  'bl1412SpecTreeTextFilterSteps.js',
  'bl538ConsolePausedTicketPagerSteps.js',
  'bl572EpicReorderConsoleSteps.js',
  'bl591EpicEtaSteps.js',
  'bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js',
  'bl665ContextTelemetryProducerWiringSteps.js',
  'bl672EpicMakeTopPrioritySteps.js',
  'bl673TopicMakeTopPrioritySteps.js',
  'bl674EpicDrilldownUiSteps.js',
  'bl686EpicDrilldownSlugMatchSteps.js',
  'bl687EpicReorderIncludesActiveChildrenSteps.js',
  'bl766MiniAppLetsTalkRetiredSteps.js',
  'bl905HideChildlessEpicsReorderSteps.js',
  'gh23ContextBudgetDashboardSteps.js',
];

const BRIDGE_SERVER_REQUEST_PATTERN = /bridge[\\/]bridgeServer(?:\.js)?$/;
const EAGER_REQUIRE_PATTERN = /^const .*require\(.*bridge\/bridgeServer/m;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^(\S+) is required alone in a fresh child process with the loader intercept$/, (ctx, handler) => {
    assert.ok(FOURTEEN_NAMED_HANDLERS.includes(handler), `unknown <handler> example value: ${handler}`);
    ctx.bl1685Row = censusOneHandler(handler);
  });

  scoped(/^extension\/out\/bridge\/bridgeServer is not loaded by that require$/, (ctx) => {
    const row = ctx.bl1685Row;
    assert.equal(row.error, null, `expected no require error, got: ${row.error}`);
    const stillLoaded = (row.requestedModules || []).some((request) => BRIDGE_SERVER_REQUEST_PATTERN.test(request));
    assert.equal(
      stillLoaded,
      false,
      `${row.file}: expected no ${BRIDGE_SERVER_REQUEST_PATTERN} request among: ${JSON.stringify(row.requestedModules)}`
    );
  });

  scoped(/^the cost is under the per-handler budget$/, (ctx) => {
    assert.ok(ctx.bl1685Row, 'no handler was censused yet');
    const ms = confirmAloneMs(ctx.bl1685Row.file);
    assert.ok(
      ms < PER_HANDLER_BUDGET_MS,
      `${ctx.bl1685Row.file} cost ${ms.toFixed(1)}ms, expected under ${PER_HANDLER_BUDGET_MS}ms`
    );
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^the byte-safe census greps specs\/pipeline\/steps for bridge\/bridgeServer$/, (ctx) => {
    const output = execFileSync(
      'git',
      ['grep', '-l', 'bridge/bridgeServer', '--', 'specs/pipeline/steps/*Steps.js'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    ctx.bl1685CensusFiles = output.split('\n').filter(Boolean).sort();
  });

  // Amended 2026-09-21 (specifier, on the coder's spec-gap note 000053):
  // the total is a FLOOR, not a pin - the steps directory grows with
  // every ticket whose handler mentions the path in step text (32 at
  // mint, 33/34 within the day). The floor only proves the scan reached
  // the directory; the pin that matters is scenario 01's named eager set
  // being empty.
  scoped(/^it names at least thirty-two handlers$/, (ctx) => {
    assert.ok(
      ctx.bl1685CensusFiles.length >= 32,
      `expected at least thirty-two handlers, got ${ctx.bl1685CensusFiles.length}: ${JSON.stringify(ctx.bl1685CensusFiles)}`
    );
  });

  scoped(/^none of them requires bridge\/bridgeServer at module scope$/, (ctx) => {
    const eager = ctx.bl1685CensusFiles.filter((relPath) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      return EAGER_REQUIRE_PATTERN.test(text);
    });
    assert.deepEqual(
      eager,
      [],
      `expected no handler to require bridge/bridgeServer at module scope, got: ${JSON.stringify(eager)}`
    );
  });
}

module.exports = { registerSteps };
