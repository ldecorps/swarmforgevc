'use strict';

// BL-496: step handlers for "A decided approval ask closes itself even when
// Telegram rate-limits the edit". Drives the REAL compiled
// recordApprovalDecisionAndClose (telegramFrontDeskBotCore.ts) against fake
// PollAdapters whose editApprovalAskMessage/waitForAskCloseRetry record
// every call - never a hand-rolled reimplementation of the bounded
// retry_after-honouring retry, mirroring bl484DecidedAskClosesItselfSteps.js's
// own drive-the-real-routine convention for this exact module.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { recordApprovalDecisionAndClose } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));

async function withCapturedStderr(fn) {
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = originalErrorWrite;
  }
  return errors;
}

function registerSteps(registry) {
  registry.define(/^the ask-close retry budget is (\d+) attempts$/, (ctx, n) => {
    ctx.retryBudget = Number(n);
  });

  // ── ask-close-rate-limit-01 ────────────────────────────────────────────
  registry.define(/^a decided approval ask whose persisted message edit Telegram rejects with "([^"]+)" and no retry-after$/, (ctx, error) => {
    ctx.ticketId = 'BL-496';
    ctx.attempts = 0;
    ctx.waits = [];
    ctx.editCalls = [];
    ctx.adapters = {
      recordApprovalReply: async () => true,
      recordRejectionReply: async () => true,
      readApprovalAskMessage: async () => ({ topicId: 800, messageId: 42, text: `${ctx.ticketId} needs your approval...` }),
      askCloseRetryBudget: ctx.retryBudget,
      editApprovalAskMessage: async () => {
        ctx.attempts += 1;
        return { success: false, error };
      },
      waitForAskCloseRetry: async (ms) => {
        ctx.waits.push(ms);
      },
    };
  });

  // ── ask-close-rate-limit-02 ────────────────────────────────────────────
  registry.define(
    /^a decided approval ask whose persisted message edit is rate-limited with a retry-after of (\d+) seconds for (\d+) attempts? then succeeds$/,
    (ctx, retryAfterText, failCountText) => {
      ctx.ticketId = 'BL-496';
      ctx.attempts = 0;
      ctx.waits = [];
      ctx.editCalls = [];
      const retryAfterSeconds = Number(retryAfterText);
      const failuresBeforeSuccess = Number(failCountText);
      ctx.adapters = {
        recordApprovalReply: async () => true,
        recordRejectionReply: async () => true,
        readApprovalAskMessage: async () => ({ topicId: 800, messageId: 42, text: `${ctx.ticketId} needs your approval...` }),
        askCloseRetryBudget: ctx.retryBudget,
        editApprovalAskMessage: async (topicId, messageId, text) => {
          ctx.attempts += 1;
          if (ctx.attempts <= failuresBeforeSuccess) {
            return { success: false, retryAfterSeconds };
          }
          ctx.editCalls.push({ topicId, messageId, text });
          return { success: true };
        },
        waitForAskCloseRetry: async (ms) => {
          ctx.waits.push(ms);
        },
      };
    }
  );

  // ── ask-close-rate-limit-03 ────────────────────────────────────────────
  registry.define(
    /^a decided approval ask whose persisted message edit is rate-limited with a retry-after of (\d+) seconds on every attempt$/,
    (ctx, retryAfterText) => {
      ctx.ticketId = 'BL-496';
      ctx.attempts = 0;
      ctx.waits = [];
      ctx.editCalls = [];
      const retryAfterSeconds = Number(retryAfterText);
      ctx.adapters = {
        recordApprovalReply: async () => true,
        recordRejectionReply: async () => true,
        readApprovalAskMessage: async () => ({ topicId: 800, messageId: 42, text: `${ctx.ticketId} needs your approval...` }),
        askCloseRetryBudget: ctx.retryBudget,
        editApprovalAskMessage: async () => {
          ctx.attempts += 1;
          return { success: false, retryAfterSeconds };
        },
        waitForAskCloseRetry: async (ms) => {
          ctx.waits.push(ms);
        },
      };
    }
  );

  registry.define(/^the approval decision is recorded and the ask is closed$/, async (ctx) => {
    ctx.errors = await withCapturedStderr(async () => {
      ctx.changed = await recordApprovalDecisionAndClose(ctx.adapters, ctx.ticketId, { kind: 'approved' }, 0);
    });
  });

  registry.define(/^the ask-close edit is attempted exactly once$/, (ctx) => {
    if (ctx.attempts !== 1) {
      throw new Error(`expected exactly 1 edit attempt, got ${ctx.attempts}`);
    }
  });

  registry.define(/^the ask-close edit is attempted (\d+) times$/, (ctx, n) => {
    if (ctx.attempts !== Number(n)) {
      throw new Error(`expected ${n} edit attempts, got ${ctx.attempts}`);
    }
  });

  registry.define(/^the logged close failure for the ticket includes the rejection reason "([^"]+)"$/, (ctx, reason) => {
    if (!ctx.errors.some((e) => e.includes(ctx.ticketId) && e.includes(reason))) {
      throw new Error(`expected a logged failure naming ${ctx.ticketId} with reason "${reason}", got: ${JSON.stringify(ctx.errors)}`);
    }
  });

  registry.define(/^the ticket's approval decision remains recorded$/, (ctx) => {
    if (ctx.changed !== true) {
      throw new Error(`expected the decision recording to succeed, got: ${ctx.changed}`);
    }
  });

  registry.define(/^the closing routine requests a wait of (\d+) seconds before each retry$/, (ctx, secondsText) => {
    const expectedMs = Number(secondsText) * 1000;
    if (ctx.waits.length === 0 || !ctx.waits.every((w) => w === expectedMs)) {
      throw new Error(`expected every requested wait to be ${expectedMs}ms, got: ${JSON.stringify(ctx.waits)}`);
    }
  });

  registry.define(/^the persisted ask message is finally edited to strip its buttons and append the verdict$/, (ctx) => {
    if (ctx.editCalls.length !== 1) {
      throw new Error(`expected exactly one final successful edit, got: ${JSON.stringify(ctx.editCalls)}`);
    }
    // editApprovalAskMessage's real wiring (telegram-front-desk-bot.ts)
    // always passes buttons: null to editMessageText - the wire-level
    // stripping is telegramClient.test.js's own proof; this step confirms
    // the closing routine actually reached a SUCCESSFUL edit carrying the
    // appended verdict line, composeDecidedAskText's own (separately
    // unit-tested) contract.
    if (!ctx.editCalls[0].text.includes('-- Approved')) {
      throw new Error(`expected the verdict appended to the edited text, got: ${ctx.editCalls[0].text}`);
    }
  });

  registry.define(/^the logged close failure for the ticket reports the rate limit and that the close was not delivered$/, (ctx) => {
    if (!ctx.errors.some((e) => e.includes(ctx.ticketId) && /rate.?limit/i.test(e))) {
      throw new Error(`expected a logged rate-limit/undelivered warning naming ${ctx.ticketId}, got: ${JSON.stringify(ctx.errors)}`);
    }
  });

  registry.define(/^the bot loop survives the exhausted retries without crashing$/, (ctx) => {
    // Reaching this step at all already proves recordApprovalDecisionAndClose
    // returned normally rather than throwing; ctx.changed's own truthiness
    // is checked by the sibling "remains recorded" step.
    if (ctx.changed === undefined) {
      throw new Error('expected the closing routine to have run and returned normally');
    }
  });

  // ── ask-close-rate-limit-04 (burst of three) ───────────────────────────
  registry.define(
    /^three decided approval asks whose persisted message edits are each rate-limited with a retry-after of (\d+) seconds for one attempt then succeed$/,
    (ctx, retryAfterText) => {
      const retryAfterSeconds = Number(retryAfterText);
      ctx.ticketIds = ['BL-491', 'BL-492', 'BL-493'];
      ctx.editCallsByTicket = {};
      ctx.adaptersByTicket = {};
      for (const ticketId of ctx.ticketIds) {
        let attempts = 0;
        const editCalls = [];
        ctx.editCallsByTicket[ticketId] = editCalls;
        ctx.adaptersByTicket[ticketId] = {
          recordApprovalReply: async () => true,
          recordRejectionReply: async () => true,
          readApprovalAskMessage: async () => ({ topicId: 800, messageId: 42, text: `${ticketId} needs your approval...` }),
          askCloseRetryBudget: ctx.retryBudget,
          editApprovalAskMessage: async (topicId, messageId, text) => {
            attempts += 1;
            if (attempts === 1) {
              return { success: false, retryAfterSeconds };
            }
            editCalls.push({ topicId, messageId, text });
            return { success: true };
          },
          waitForAskCloseRetry: async () => {},
        };
      }
    }
  );

  registry.define(/^all three approvals are recorded and each ask is closed in one burst$/, async (ctx) => {
    await Promise.all(ctx.ticketIds.map((id) => recordApprovalDecisionAndClose(ctx.adaptersByTicket[id], id, { kind: 'approved' }, 0)));
  });

  registry.define(/^every one of the three persisted ask messages is finally edited to strip its buttons and append the verdict$/, (ctx) => {
    for (const ticketId of ctx.ticketIds) {
      const calls = ctx.editCallsByTicket[ticketId];
      if (calls.length !== 1 || !calls[0].text.includes('-- Approved')) {
        throw new Error(`expected ${ticketId} finally edited with a verdict, got: ${JSON.stringify(calls)}`);
      }
    }
  });

  registry.define(/^no ask is left showing its live buttons$/, (ctx) => {
    // Already proven by the sibling "finally edited" step above (a
    // successful edit is exactly what strips the buttons on the wire) -
    // nothing further to check for this scenario's own three tickets.
    for (const ticketId of ctx.ticketIds) {
      if (ctx.editCallsByTicket[ticketId].length === 0) {
        throw new Error(`expected ${ticketId} to have been edited (buttons stripped), got none`);
      }
    }
  });
}

module.exports = { registerSteps };
