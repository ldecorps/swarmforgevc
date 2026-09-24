'use strict';

// BL-1687: step handlers for "The seventeen remaining bridgeServer
// loaders require it inside the step". Drives the REAL census helper
// (extension/test/helpers/stepHandlerRequireCensus.js) against the REAL
// specs/pipeline/steps tree - never a reimplementation of the
// require-timing or the loader-intercept instrumentation - same shape
// BL-1658's and BL-1685's own handlers established.
//
// Scenario 01 requires each of the seventeen NAMED handlers alone in a
// fresh child; scenario 02 is the loader-probe census itself (never a
// text grep - the whole point of this ticket, since sixteen of the
// seventeen build the require path with path.join and one requires it
// inside a module-scope object literal, both invisible to BL-1685's
// ^const grep): every handler whose source mentions bridge/bridgeServer
// at all is required alone and checked for whether the loader actually
// pulled the module in.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { censusOneHandler } = require('../../../extension/test/helpers/stepHandlerRequireCensus');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_GLOB = 'specs/pipeline/steps/*Steps.js';

const FEATURE = 'BL-1687 The seventeen remaining bridgeServer loaders require it inside the step';

// 2026-09-21: same value the guard test and BL-1658/BL-1630/BL-1685's own
// step handlers use - this file must apply the SAME budget to make the
// same true claim about the same real tree.
const PER_HANDLER_BUDGET_MS = 400;

const BRIDGE_SERVER_PATTERN = /bridge\/bridgeServer/;

// Best-of-3 (mirrors the guard test's own confirmAloneMs and BL-1658/
// BL-1630/BL-1685's own step handlers exactly - a single fresh-child
// reading can land on a sibling agent's scheduling spike on this shared,
// continuously-running swarm host).
function confirmAloneMs(file) {
  const samples = [censusOneHandler(file).ms, censusOneHandler(file).ms, censusOneHandler(file).ms];
  return Math.min(...samples);
}

// The seventeen the ticket's own feature Examples table names (BL-1445
// census pin - named, not derived).
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

// Every handler whose source MENTIONS bridge/bridgeServer at all - the
// population scenario 02 censuses is the loader itself, never a text
// pattern, so this listing only needs to find CANDIDATES (a floor over a
// growing directory, BL-1685's own amendment lesson), not classify them.
function candidateHandlers() {
  // BL-1687's own text: `git grep -l bridgeServer` - the bare word, never
  // BL-1685's narrower `bridge/bridgeServer` (which requires a literal
  // slash-joined path and misses six of these seventeen handlers'
  // path.join-built requires entirely, even in their pre-fix eager form -
  // caught by this ticket's own acceptance run undercounting at 36
  // instead of the ticket's documented 53-54).
  const out = execFileSync('git', ['grep', '-l', 'bridgeServer', '--', STEPS_GLOB], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((relPath) => path.basename(relPath))
    .sort();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^(\S+) is required alone in a fresh child process with the loader intercept$/, (ctx, handler) => {
    assert.ok(SEVENTEEN_NAMED_HANDLERS.includes(handler), `unknown <handler> example value: ${handler}`);
    ctx.bl1687Row = censusOneHandler(handler);
  });

  scoped(/^extension\/out\/bridge\/bridgeServer is not loaded by that require$/, (ctx) => {
    const row = ctx.bl1687Row;
    assert.ok(row, 'no handler was censused yet');
    assert.equal(row.error, null, `expected no require error, got: ${row.error}`);
    assert.equal(
      bridgeServerLoaded(row),
      false,
      `${row.file}: expected no ${BRIDGE_SERVER_PATTERN} request among: ${JSON.stringify(row.requestedModules)}`
    );
  });

  scoped(/^the cost is under the per-handler budget$/, (ctx) => {
    assert.ok(ctx.bl1687Row, 'no handler was censused yet');
    const ms = confirmAloneMs(ctx.bl1687Row.file);
    assert.ok(
      ms < PER_HANDLER_BUDGET_MS,
      `${ctx.bl1687Row.file} cost ${ms.toFixed(1)}ms, expected under ${PER_HANDLER_BUDGET_MS}ms`
    );
  });

  scoped(
    /^every handler under specs\/pipeline\/steps whose source mentions bridgeServer is required alone in a fresh child process with the loader intercept$/,
    (ctx) => {
      const candidates = candidateHandlers();
      ctx.bl1687Rows = candidates.map((file) => censusOneHandler(file));
    }
  );

  scoped(/^none of them loads extension\/out\/bridge\/bridgeServer$/, (ctx) => {
    const loaders = ctx.bl1687Rows.filter((row) => row.error === null && bridgeServerLoaded(row)).map((row) => row.file);
    assert.deepEqual(
      loaders,
      [],
      `expected no handler to load bridge/bridgeServer when required alone, got: ${JSON.stringify(loaders)}`
    );
  });

  scoped(/^at least fifty handlers were examined$/, (ctx) => {
    assert.ok(
      ctx.bl1687Rows.length >= 50,
      `expected at least 50 handlers examined, got ${ctx.bl1687Rows.length}`
    );
  });
}

module.exports = { registerSteps };
