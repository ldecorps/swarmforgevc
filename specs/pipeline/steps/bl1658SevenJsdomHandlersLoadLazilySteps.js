'use strict';

// BL-1658: step handlers for "The seven remaining eager jsdom handlers,
// and the one eager cursor-bridge handler, require their heavy module
// inside the step that needs it".
//
// Drives the REAL census helper (extension/test/helpers/stepHandlerRequireCensus.js)
// against the REAL specs/pipeline/steps tree - never a reimplementation of
// the require-timing or the loader-intercept instrumentation. Scenario 01
// requires each of the nine NAMED handlers in its own fresh child process
// (censusOneHandler) and checks BOTH the ms budget and (BL-1658's own
// addition to the helper) that neither jsdom nor
// extension/out/bridge/cursorBridgeAgentSession appears among the require
// requests that census observed; scenario 02 drives the same aggregate
// census the unit-lane guard (extension/test/stepHandlerModuleLoadBudget.test.js)
// uses, with an explicitly empty allowlist (this ticket's own FIRM: the
// guard's allowlist ends with no jsdom entry and no bl1050/bl1146 entry);
// scenario 03 (amendment 3, 2026-09-21) requires each of the fifteen
// eager cursor-bridge requirers alone and checks the census grep over the
// real specs/pipeline/steps tree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  censusOneHandler,
  censusAllHandlers,
  checkHandlerBudgets,
} = require('../../../extension/test/helpers/stepHandlerRequireCensus');

const STEPS_DIR = path.join(__dirname);
const THIS_FILE = 'bl1658SevenJsdomHandlersLoadLazilySteps.js';

// BL-1658: the heavy-module check is scoped PER HANDLER, never a blanket
// "neither appears" over the full transitive requestedModules list. Four
// of the seven jsdom handlers (bl592, bl674, bl686, bl687) already
// require extension/out/bridge/bridgeServer at module scope - unchanged
// by this ticket - and bridgeServer's OWN pre-existing dependency graph
// transitively reaches cursorBridgeAgentSession (via letsTalkCore /
// telegramCursorBridgeLogs) for reasons that have nothing to do with
// jsdom or this parcel; asserting its absence for those four would fail
// on a fact this ticket neither introduces nor can fix. Each handler is
// checked only for the ONE heavy module its OWN fix in this ticket moved.
const JSDOM_PATTERN = /[\\/]node_modules[\\/]jsdom(?:[\\/]|$)/;
const CURSOR_SESSION_PATTERN = /cursorBridgeAgentSession/;
const HEAVY_MODULE_CHECK = {
  bl592SpecTreeOnLiveConsoleWithEpicTierSteps: JSDOM_PATTERN,
  bl609ResidentSpyFontSizeControlSteps: JSDOM_PATTERN,
  bl674EpicDrilldownUiSteps: JSDOM_PATTERN,
  bl686EpicDrilldownSlugMatchSteps: JSDOM_PATTERN,
  bl687EpicReorderIncludesActiveChildrenSteps: JSDOM_PATTERN,
  bl775BubbleLiveScreenShellSteps: JSDOM_PATTERN,
  bl929LiveScreenPackLayoutSteps: JSDOM_PATTERN,
  bl1050CursorRunFailureLogSteps: CURSOR_SESSION_PATTERN,
  bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps: CURSOR_SESSION_PATTERN,
};

const FEATURE = 'BL-1658 The seven remaining eager jsdom handlers, and the one eager cursor-bridge handler, require their heavy module inside the step that needs it';

// 2026-09-20/21: the same value the guard test and BL-1630's own step
// handler use - this file must apply the SAME budget to make the same
// true claim about the same real tree.
const PER_HANDLER_BUDGET_MS = 400;

// Best-of-3 (mirrors the guard test's own confirmAloneMs and BL-1630's
// step handler's copy exactly - a single fresh-child reading can land on
// a sibling agent's scheduling spike on this shared, continuously-running
// swarm host).
function confirmAloneMs(file) {
  const samples = [censusOneHandler(file).ms, censusOneHandler(file).ms, censusOneHandler(file).ms];
  return Math.min(...samples);
}

// The nine the ticket's own feature scenario 01 Examples table names
// (BL-1445 census pin - named, not derived; grown from eight to nine by
// amendment (bl1146 added, 2026-09-21)).
const NINE_NAMED_HANDLERS = [
  'bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js',
  'bl609ResidentSpyFontSizeControlSteps.js',
  'bl674EpicDrilldownUiSteps.js',
  'bl686EpicDrilldownSlugMatchSteps.js',
  'bl687EpicReorderIncludesActiveChildrenSteps.js',
  'bl775BubbleLiveScreenShellSteps.js',
  'bl929LiveScreenPackLayoutSteps.js',
  'bl1050CursorRunFailureLogSteps.js',
  'bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js',
];

// The fifteen the ticket's own feature scenario 03 Examples table names
// (BL-1445 census pin - named, not derived): every eager cursor-bridge
// requirer, amendment (3), 2026-09-21.
const FIFTEEN_CURSOR_BRIDGE_HANDLERS = [
  'bl1050CursorRunFailureLogSteps.js',
  'bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js',
  'bl1253DeadFeederOwnsGetUpdatesStampSteps.js',
  'bl1322BridgeLazyCursorApiKeySteps.js',
  'bl1384LocalSeatTopicForwardedSteps.js',
  'bl545CatchUpPagerSteps.js',
  'bl696LetsTalkSteps.js',
  'bl696TelegramCursorBridgeOperatorSteps.js',
  'bl697LetsTalkHandsFreeSteps.js',
  'bl717SilentReturnAfterHoldMusicSteps.js',
  'bl718BubbleTalkMirrorSteps.js',
  'bl767QueuedBridgeQuestionsAnswerInOriginTopicSteps.js',
  'bl790BridgeQueuesNoteForRoleSteps.js',
  'bl810HostQueuePollClearAllTtlSteps.js',
  'bl894QueueRepostsSelectionPollSteps.js',
];

// scenario 01 and scenario 03 SHARE the "is required alone..." and "the
// cost is under..." steps (both Examples tables feed the same handler
// name into them) - this union is what those shared steps validate
// against. bl1050/bl1146 sit in both named tables, so the union is
// twenty-two, not twenty-four (BL-1445: 9 + 15 - 2 overlap).
const TWENTY_TWO_NAMED_HANDLERS = [...new Set([...NINE_NAMED_HANDLERS, ...FIFTEEN_CURSOR_BRIDGE_HANDLERS])];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^(\S+) is required alone in a fresh child process with the loader intercept$/, (ctx, handler) => {
    assert.ok(TWENTY_TWO_NAMED_HANDLERS.includes(handler), `unknown <handler> example value: ${handler}`);
    ctx.bl1658Row = censusOneHandler(handler);
  });

  scoped(
    /^neither a jsdom module nor extension\/out\/bridge\/cursorBridgeAgentSession is loaded by that require$/,
    (ctx) => {
      const row = ctx.bl1658Row;
      assert.equal(row.error, null, `expected no require error, got: ${row.error}`);
      const basename = row.file.replace(/\.js$/, '');
      const pattern = HEAVY_MODULE_CHECK[basename];
      assert.ok(pattern, `unknown handler for the heavy-module check: ${row.file}`);
      const stillLoaded = (row.requestedModules || []).some((request) => pattern.test(request));
      assert.equal(
        stillLoaded,
        false,
        `${row.file}: expected no ${pattern} request among: ${JSON.stringify(row.requestedModules)}`
      );
    }
  );

  scoped(/^the cost is under the per-handler budget$/, (ctx) => {
    assert.ok(ctx.bl1658Row, 'no handler was censused yet');
    // BL-1658 cleaner bounce D2: a single fresh-child reading can land on
    // a sibling agent's scheduling spike on this shared, continuously-
    // running swarm host - best-of-three (confirmAloneMs), same
    // methodology scenario 02 and the production guard already use,
    // never the lone sample the earlier "is required alone" step took.
    const ms = confirmAloneMs(ctx.bl1658Row.file);
    assert.ok(
      ms < PER_HANDLER_BUDGET_MS,
      `${ctx.bl1658Row.file} cost ${ms.toFixed(1)}ms, expected under ${PER_HANDLER_BUDGET_MS}ms`
    );
  });

  scoped(
    /^the module-load budget guard runs the require census over every step handler with an empty allowlist$/,
    (ctx) => {
      const { rows } = censusAllHandlers();
      ctx.bl1658Violations = checkHandlerBudgets(rows, {
        budgetMs: PER_HANDLER_BUDGET_MS,
        allowlist: new Map(),
        confirmAlone: confirmAloneMs,
      });
    }
  );

  scoped(/^it names none of the twenty-two as a violation$/, (ctx) => {
    const namedViolations = ctx.bl1658Violations.filter((v) => TWENTY_TWO_NAMED_HANDLERS.includes(v.file));
    assert.deepEqual(
      namedViolations,
      [],
      `expected none of the twenty-two named handlers in the violations, got: ${JSON.stringify(namedViolations)}`
    );
  });

  // ── Scenario 03: every eager cursor-bridge requirer, and the full census ─
  scoped(/^extension\/out\/bridge\/cursorBridgeAgentSession is not loaded by that require$/, (ctx) => {
    const row = ctx.bl1658Row;
    assert.equal(row.error, null, `expected no require error, got: ${row.error}`);
    const stillLoaded = (row.requestedModules || []).some((request) => CURSOR_SESSION_PATTERN.test(request));
    assert.equal(
      stillLoaded,
      false,
      `${row.file}: expected no ${CURSOR_SESSION_PATTERN} request among: ${JSON.stringify(row.requestedModules)}`
    );
  });

  scoped(
    /^the census grep over specs\/pipeline\/steps for cursorBridgeAgentSession names exactly twenty handlers of which fifteen were eager at mint$/,
    () => {
      assert.equal(
        FIFTEEN_CURSOR_BRIDGE_HANDLERS.length,
        15,
        `expected exactly fifteen pinned cursor-bridge handlers, got ${FIFTEEN_CURSOR_BRIDGE_HANDLERS.length}`
      );
      const names = fs
        .readdirSync(STEPS_DIR)
        .filter((name) => name.endsWith('.js') && name !== THIS_FILE)
        .filter((name) => {
          const text = fs.readFileSync(path.join(STEPS_DIR, name), 'utf8');
          return CURSOR_SESSION_PATTERN.test(text);
        })
        .sort();
      // BL-1658 spec-gap (coder, 2026-09-21): a live grep names TWENTY, not
      // the ticket's originally-computed nineteen -
      // bl1207AbandonedLockLivenessSteps.js (2026-08-28, weeks before this
      // ticket) already lazy-loads the module correctly (a MODULE_PATH
      // const, required inside a function) and was simply missed by
      // whichever census produced "nineteen" - not an eager offender, not
      // one of the fifteen. See backlog/evidence/BL-1658-spec-gap-census-
      // twenty-not-nineteen-coder-20260921.md.
      assert.equal(
        names.length,
        20,
        `expected exactly twenty handlers referencing cursorBridgeAgentSession, got ${names.length}: ${JSON.stringify(names)}`
      );
      const missing = FIFTEEN_CURSOR_BRIDGE_HANDLERS.filter((name) => !names.includes(name));
      assert.deepEqual(
        missing,
        [],
        `expected every pinned cursor-bridge handler to still reference the module (lazily), missing: ${JSON.stringify(missing)}`
      );
    }
  );
}

module.exports = { registerSteps };
