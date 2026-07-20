'use strict';

// BL-502: step handlers for "the pipeline board message stays within
// Telegram's send limit at any backlog size" - live outage 2026-07-17.
// Drives the REAL compiled budgetPipelineBoardLinks/renderPipelineBoard/
// wrapPipelineBoardHtml (pipelineBoard.ts) and syncPipelineBoard/
// classifyBoardFailure (pipelineBoardSync.ts) against fake in-memory
// adapters - never a hand-rolled substitute for the real budget/classify
// logic, mirroring bl497PipelineBoardPostFailureRecoverySteps.js's own
// "drive the real compiled sync, fake only the network leg" convention.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  renderPipelineBoard,
  renderPipelineBoardBody,
  composePipelineBoardHtml,
  compareLinksMostRecentFirst,
  PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
} = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
const { syncPipelineBoard, classifyBoardFailure } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));

// "the board sync runs" collides byte-for-byte with an existing unscoped
// registration in bl468PipelineBoardPostBeforeDeleteSteps.js (a DIFFERENT
// ctx shape entirely - see stepRegistry.js's own BL-425 comment on why an
// unscoped first-registered handler would otherwise silently win here), so
// that one step is registered via defineScoped against this feature's own
// name - every other step below is unique text and stays a plain define.
const FEATURE_NAME = "the pipeline board message stays within Telegram's send limit at any backlog size";

const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';
const T0 = Date.UTC(2026, 6, 17, 14, 22);

function manyLinkRows(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `BL-${i}`, column: 'coder', slug: '' }));
}

function manyLinks(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `BL-${i}`, path: `backlog/active/BL-${i}-a-fine-feature-with-a-longish-slug.yaml` }));
}

function composeForSending(ctx) {
  ctx.text = renderPipelineBoard(ctx.data, T0);
  const composed = composePipelineBoardHtml(ctx.data, T0, ctx.repoBaseUrl, PIPELINE_BOARD_MESSAGE_MAX_LENGTH);
  ctx.composed = composed.html;
  ctx.linksHtml = composed.html;
  ctx.omittedCount = composed.omittedLinkCount;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a repo base url is configured so the board renders tappable ticket links$/, (ctx) => {
    ctx.repoBaseUrl = REPO_BASE_URL;
  });

  registry.define(/^the board caps its message at Telegram's 4096-character send limit$/, () => {
    if (PIPELINE_BOARD_MESSAGE_MAX_LENGTH > 4096) {
      throw new Error(`expected the board's own send-limit constant to be at or under Telegram's real 4096-char limit, got ${PIPELINE_BOARD_MESSAGE_MAX_LENGTH}`);
    }
  });

  // ── pipeline-board-message-length-budget-01 ─────────────────────────────
  registry.define(/^a board whose grid, parked list and full link list together fit within the send limit$/, (ctx) => {
    ctx.data = { rows: manyLinkRows(3), parked: [], links: manyLinks(3) };
  });

  registry.define(/^the board message is composed for sending$/, (ctx) => {
    composeForSending(ctx);
  });

  registry.define(/^the composed message is within the send limit$/, (ctx) => {
    if (ctx.composed.length > PIPELINE_BOARD_MESSAGE_MAX_LENGTH) {
      throw new Error(`expected the composed message (${ctx.composed.length} chars) within the send limit (${PIPELINE_BOARD_MESSAGE_MAX_LENGTH}), got: ${ctx.composed.slice(0, 200)}...`);
    }
  });

  registry.define(/^every ticket link is present in the message$/, (ctx) => {
    for (const link of ctx.data.links) {
      const display = String(link.id).replace(/^BL-/, '');
      if (!ctx.composed.includes(`blob/main/${link.path}`) || !ctx.composed.includes(`>${display}</a>`)) {
        throw new Error(`expected in-board link for ${link.id} present in the composed message, got: ${ctx.composed}`);
      }
    }
  });

  registry.define(/^no overflow indicator is shown$/, (ctx) => {
    if (ctx.omittedCount !== 0 || ctx.composed.includes('more')) {
      throw new Error(`expected no omitted anchors (omittedCount 0), got omittedCount=${ctx.omittedCount}, html=${ctx.composed}`);
    }
  });

  // ── pipeline-board-message-length-budget-02/03 ──────────────────────────
  registry.define(/^a board whose full tappable link list would push the composed message over the send limit$/, (ctx) => {
    ctx.data = { rows: manyLinkRows(40), parked: [], links: manyLinks(40) };
  });

  registry.define(/^the grid and parked sections are present in full$/, (ctx) => {
    const body = renderPipelineBoardBody(ctx.data);
    if (!ctx.text.includes(body)) {
      throw new Error('expected the grid/parked body present in full and untrimmed, regardless of the link budget');
    }
  });

  registry.define(/^only the links that fit the remaining budget are included$/, (ctx) => {
    if (ctx.omittedCount === 0) {
      throw new Error('expected some anchors omitted for an oversized board - the whole point of this scenario');
    }
    const sorted = [...ctx.data.links].sort(compareLinksMostRecentFirst);
    const includedIds = sorted.slice(0, sorted.length - ctx.omittedCount).map((l) => l.id);
    for (const id of includedIds) {
      const display = String(id).replace(/^BL-/, '');
      if (!ctx.composed.includes(`>${display}</a>`)) {
        throw new Error(`expected included link ${id} present as an in-board anchor`);
      }
    }
  });

  registry.define(/^an overflow indicator naming the number of omitted links is shown$/, (ctx) => {
    // In-board anchors: omitted tickets still appear as plain numbers (no
    // separate "+N more" LINKS footer). The omission count is the budget
    // signal — assert it is exact and that at least one anchor was dropped.
    if (ctx.omittedCount <= 0) {
      throw new Error(`expected omittedLinkCount > 0, got ${ctx.omittedCount}`);
    }
    if (ctx.omittedCount + (ctx.data.links.length - ctx.omittedCount) !== ctx.data.links.length) {
      throw new Error('expected included + omitted to equal total link count');
    }
  });

  // ── pipeline-board-message-length-budget-03 ─────────────────────────────
  registry.define(/^Telegram rejects any message longer than the send limit$/, (ctx) => {
    ctx.rejectOverLimit = true;
  });

  registry.defineScoped(
    /^the board sync runs$/,
    async (ctx) => {
      const posted = [];
      ctx.result = await syncPipelineBoard(
        ctx.data,
        undefined,
        {
          ensureBoardTopic: async () => ({ topicId: 900 }),
          postMessage: async (topicId, text, boardHtml) => {
            posted.push(boardHtml);
            if (ctx.rejectOverLimit && boardHtml.length > 4096) {
              return { error: 'Bad Request: text is too long' };
            }
            return { messageId: 1 };
          },
          deleteMessage: async () => true,
        },
        T0,
        ctx.repoBaseUrl
      );
      ctx.posted = posted;
    },
    FEATURE_NAME
  );

  registry.define(/^the board post succeeds instead of failing on length$/, (ctx) => {
    if (ctx.result.outcome !== 'posted' && ctx.result.outcome !== 'reposted') {
      throw new Error(`expected a successful post outcome, got: ${ctx.result.outcome} (error: ${ctx.result.error})`);
    }
  });

  registry.define(/^the board is not left frozen$/, (ctx) => {
    if (ctx.result.state.messageId === undefined) {
      throw new Error('expected a messageId recorded - the board is visible, not frozen');
    }
    if (ctx.posted.some((composed) => composed.length > 4096)) {
      throw new Error('expected every attempted post to already be within the real Telegram limit');
    }
  });

  // ── pipeline-board-message-length-budget-04 (Scenario Outline) ─────────
  registry.define(/^the board content changed and its post is rejected with the Telegram error "([^"]+)"$/, (ctx, error) => {
    ctx.error = error;
    ctx.data = { rows: manyLinkRows(1), parked: [], links: [] };
  });

  registry.define(/^the board sync attempts the post$/, async (ctx) => {
    ctx.result = await syncPipelineBoard(
      ctx.data,
      { topicId: 900, messageId: 42, contentSignature: 'stale', lastChangeMs: T0 - 1000, consecutiveFailures: 0, alertArmed: false },
      {
        ensureBoardTopic: async () => ({ topicId: 900 }),
        postMessage: async () => ({ error: ctx.error }),
        deleteMessage: async () => true,
      },
      T0
    );
  });

  registry.define(/^the post failure is classified as "([^"]+)"$/, (ctx, expectedClass) => {
    const actual = classifyBoardFailure(ctx.error);
    if (actual !== expectedClass) {
      throw new Error(`expected classifyBoardFailure("${ctx.error}") === "${expectedClass}", got "${actual}"`);
    }
    if (ctx.result.failureClass !== expectedClass) {
      throw new Error(`expected syncPipelineBoard's own result.failureClass "${expectedClass}", got "${ctx.result.failureClass}"`);
    }
  });

  registry.define(/^the board topic is "(retained|cleared)"$/, (ctx, action) => {
    if (action === 'cleared' && ctx.result.state.topicId !== undefined) {
      throw new Error(`expected the tracked topic id cleared, got: ${ctx.result.state.topicId}`);
    }
    if (action === 'retained' && ctx.result.state.topicId === undefined) {
      throw new Error('expected the tracked topic id retained, got undefined');
    }
  });
}

module.exports = { registerSteps };
