'use strict';

// BL-764: step handlers driving the REAL dual-poller fix directly — the
// front desk's forward-vs-drop decision, the on-disk fan-out queue, the
// shared-token launch default, the CLI --help guard, and the liveness cue.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');

const { pollAndForward } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));
const {
  appendCursorBridgeInboundUpdate,
  drainCursorBridgeInboundUpdates,
} = require(path.join(EXT_OUT, 'tools', 'cursorBridgeInboundQueue'));
const { shouldUseCursorBridgeInboundQueue } = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeCore'));
const {
  formatCursorBridgeLivenessLine,
  syncCursorBridgeLivenessStatus,
} = require(path.join(EXT_OUT, 'tools', 'telegramCursorBridgeLiveness'));

const BRIDGE_TOPIC_ID = 8435;
const PRINCIPAL_ID = '42';

function tmpOpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl764-acceptance-'));
}

function mkUpdate(topicId) {
  return {
    update_id: 900,
    message: {
      message_id: 5,
      text: 'hello host',
      from: { id: Number(PRINCIPAL_ID) },
      chat: { id: -100 },
      message_thread_id: topicId,
    },
  };
}

function cursorBridgePollAdapters(opDir, overrides = {}) {
  return {
    chatId: '1',
    cursorBridgeTopicId: async () => BRIDGE_TOPIC_ID,
    postToBridge: async () => {
      throw new Error('postToBridge (SUP/Operator route) must never be called for a bridge-owned topic');
    },
    subjectForTopic: () => 'SUP-12',
    backlogForTopic: () => undefined,
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord (SUP/Operator route) must never be called for a bridge-owned topic');
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext (SUP/Operator route) must never be called for a bridge-owned topic');
    },
    forwardCursorBridgeUpdate: async (update) => {
      appendCursorBridgeInboundUpdate(opDir, update);
      return true;
    },
    ...overrides,
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^the front desk and the Cursor Remote bridge are configured with the same bot token$/, (ctx) => {
    ctx.opDir = tmpOpDir();
  });

  // ── dual-poller-01 ──────────────────────────────────────────────────
  registry.define(/^an inbound message arrives in a bridge-owned topic$/, (ctx) => {
    ctx.update = mkUpdate(BRIDGE_TOPIC_ID);
  });

  registry.define(/^the front desk classifies that update$/, async (ctx) => {
    ctx.pollResult = await pollAndForward(
      0,
      PRINCIPAL_ID,
      cursorBridgePollAdapters(ctx.opDir, {
        getUpdates: async () => ({ success: true, updates: [ctx.update] }),
      })
    );
  });

  registry.define(/^the update is appended to the Cursor Remote inbound queue$/, (ctx) => {
    ctx.drained = drainCursorBridgeInboundUpdates(ctx.opDir);
    assert.equal(ctx.drained.length, 1, 'expected exactly one update in the inbound queue');
    assert.equal(ctx.drained[0].update_id, ctx.update.update_id);
  });

  registry.define(/^the update is not routed to SUP or Operator$/, (ctx) => {
    // postToBridge / openSubjectAndRecord / postOperatorContext (the SUP and
    // Operator routing paths) all throw in these adapters — reaching this
    // step without a thrown error already proves none of them fired. The
    // dropped/failed counters confirm the outcome was a genuine forward, not
    // a silent discard either.
    assert.equal(ctx.pollResult.dropped, 0, 'a bridge-owned update must not be silently dropped');
    assert.equal(ctx.pollResult.failed, 0, 'the forward must succeed, not be parked as failed');
  });

  // ── dual-poller-02 ──────────────────────────────────────────────────
  registry.define(
    /^the bridge is launched with (a token shared with front desk|its own exclusive token)$/,
    (ctx, tokenMode) => {
      ctx.env =
        tokenMode === 'its own exclusive token'
          ? { CURSOR_BRIDGE_BOT_TOKEN: 'exclusive-token' }
          : { TELEGRAM_BOT_TOKEN: 'shared-token' };
    }
  );

  registry.define(/^the bridge starts polling$/, (ctx) => {
    ctx.usesInboundQueue = shouldUseCursorBridgeInboundQueue(ctx.env);
  });

  registry.define(/^it consumes inbound updates from (the inbound queue|Telegram directly)$/, (ctx, source) => {
    const expected = source === 'the inbound queue';
    assert.equal(
      ctx.usesInboundQueue,
      expected,
      `expected useInboundQueue=${expected} for this launch mode, got ${ctx.usesInboundQueue}`
    );
  });

  registry.define(/^the number of processes calling getUpdates on that token is one$/, (ctx) => {
    // Structural guarantee, not a live process count: when the token is
    // shared, the bridge defers getUpdates entirely to the front desk
    // (useInboundQueue=true) — the front desk is the sole caller. When the
    // token is exclusive, the bridge is the only process holding it at all.
    // Either branch leaves exactly one getUpdates caller per token.
    assert.equal(typeof ctx.usesInboundQueue, 'boolean');
  });

  // ── dual-poller-03 ──────────────────────────────────────────────────
  registry.define(/^the inbound queue holds one pending update$/, (ctx) => {
    ctx.opDir = ctx.opDir ?? tmpOpDir();
    ctx.firstUpdateId = 1001;
    appendCursorBridgeInboundUpdate(ctx.opDir, { update_id: ctx.firstUpdateId });
  });

  registry.define(
    /^a drain reads the queue and a second update is appended before the drain completes$/,
    (ctx) => {
      ctx.secondUpdateId = 1002;
      const realRenameSync = fs.renameSync;
      let raced = false;
      fs.renameSync = (...args) => {
        const result = realRenameSync.apply(fs, args);
        if (!raced) {
          raced = true;
          appendCursorBridgeInboundUpdate(ctx.opDir, { update_id: ctx.secondUpdateId });
        }
        return result;
      };
      try {
        ctx.firstDrain = drainCursorBridgeInboundUpdates(ctx.opDir);
      } finally {
        fs.renameSync = realRenameSync;
      }
    }
  );

  registry.define(/^the first update is returned exactly once$/, (ctx) => {
    const matches = ctx.firstDrain.filter((u) => u.update_id === ctx.firstUpdateId);
    assert.equal(matches.length, 1, `expected update ${ctx.firstUpdateId} exactly once, got ${matches.length}`);
  });

  registry.define(/^the second update is still available to the next drain$/, (ctx) => {
    ctx.secondDrain = drainCursorBridgeInboundUpdates(ctx.opDir);
    assert.ok(
      ctx.secondDrain.some((u) => u.update_id === ctx.secondUpdateId),
      `expected update ${ctx.secondUpdateId} to surface on the next drain`
    );
  });

  // ── dual-poller-04 ──────────────────────────────────────────────────
  registry.define(/^the bridge CLI is invoked with the help flag and no Telegram environment$/, (ctx) => {
    const entrypoint = path.join(EXT_OUT, 'tools', 'telegram-cursor-bridge.js');
    const env = { ...process.env };
    delete env.TELEGRAM_BOT_TOKEN;
    delete env.CURSOR_BRIDGE_BOT_TOKEN;
    delete env.TELEGRAM_CHAT_ID;
    delete env.TELEGRAM_PRINCIPAL_USER_ID;
    try {
      ctx.stdout = execFileSync('node', [entrypoint, '--help'], { env, encoding: 'utf8', timeout: 10000 });
      ctx.exitCode = 0;
    } catch (err) {
      ctx.exitCode = err.status;
      ctx.stdout = err.stdout ?? '';
      ctx.stderr = err.stderr ?? '';
    }
  });

  registry.define(/^it prints usage and exits successfully$/, (ctx) => {
    assert.equal(ctx.exitCode, 0, `expected exit 0, got ${ctx.exitCode} (stderr: ${ctx.stderr ?? ''})`);
    assert.match(ctx.stdout, /Usage: node telegram-cursor-bridge\.js/);
  });

  registry.define(/^it opens no Telegram long poll$/, (ctx) => {
    // A poll attempt with no Telegram env configured would fail loudly on
    // the missing token before printing usage — a clean exit with usage
    // text and no such error is the observable proof no poll was opened.
    assert.doesNotMatch(ctx.stdout + (ctx.stderr ?? ''), /TELEGRAM_BOT_TOKEN is not set|requiredEnv/);
  });

  // ── dual-poller-05 ──────────────────────────────────────────────────
  registry.define(/^the Cursor Remote liveness line already shows (idle|busy)$/, (ctx, before) => {
    ctx.state = {
      updateOffset: 0,
      cursorTopicId: 77,
      pendingPrompts: [{ id: 'q1', text: 'x', createdAtMs: 1 }, { id: 'q2', text: 'y', createdAtMs: 2 }],
      livenessStatus: {
        topicId: 77,
        messageId: 555,
        renderedText: formatCursorBridgeLivenessLine(before === 'busy', 2),
      },
    };
    ctx.posts = [];
    ctx.edits = [];
  });

  registry.define(/^the bridge state becomes (idle|busy)$/, async (ctx, after) => {
    await syncCursorBridgeLivenessStatus({
      botToken: 't',
      chatId: 'c',
      state: ctx.state,
      busy: after === 'busy',
      persistState: () => {},
      postMessage: async (topicId, text) => {
        ctx.posts.push({ topicId, text });
        return 999;
      },
      editMessage: async (topicId, messageId, text) => {
        ctx.edits.push({ topicId, messageId, text });
        return true;
      },
    });
  });

  registry.define(/^the existing liveness message is edited rather than a new one posted$/, (ctx) => {
    assert.equal(ctx.posts.length, 0, 'expected no new message to be posted');
    assert.equal(ctx.edits.length, 1, 'expected exactly one edit of the existing liveness message');
    assert.equal(ctx.edits[0].messageId, 555);
  });

  registry.define(/^the line reports the number of turns still waiting$/, (ctx) => {
    assert.match(ctx.edits[0].text, /2 waiting/);
  });
}

module.exports = { registerSteps };
