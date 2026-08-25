'use strict';

// BL-320: step handlers for "Telegram reply egress is at-least-once with
// ack-driven cursor". Drives the REAL compiled bridge (extension/out/
// bridge/bridgeServer's startBridge) over a real loopback socket and the
// REAL bot-core relay function (extension/out/tools/
// telegramFrontDeskBotCore's relaySseReplies) with a fake sendReply -
// mirroring bridgeServer.test.js's own "real startBridge, real fetch"
// pattern, which is the only way to exercise the actual defect this
// ticket fixes (per the ticket's own words: "the bug is that the live
// failure never reaches the code a mock exercises - acceptance must test
// against real dropped sockets"). No live Telegram API is ever called -
// sendReply is a fake counter, same boundary telegram-front-desk-bot.ts
// itself draws around the untested network call.
//
// "Delivered but not yet acked" construction: relayOneRecord
// (telegramFrontDeskBotCore.ts) awaits ackReply IMMEDIATELY after
// sendReply resolves, within the same tick - on a real loopback
// connection that ack round-trip completes in low single-digit
// milliseconds, far faster than any external poll-and-then-abort a test
// could reliably race against. Rather than chase that timing, the "drop
// before ack" precondition scenarios below give the FIRST connection an
// ackReply adapter that deterministically fails (simulating exactly the
// ticket's own root-cause: "a transient drop between 'sent' and 'acked'"
// - the observable effect of a genuinely dropped socket and of a failed
// ack request are identical: the cursor never advances) - this is
// deterministic and fast, not a race.
//
// Every scenario stores its live bridge on ctx.handle and stops it in its
// OWN final step - steps run strictly sequentially (runScenario awaits
// each one before the next), so state that must span Given/When/Then
// lives on ctx directly, never inside a callback one step blocks waiting
// on another step to release (that shape deadlocks: the later step can
// never run until the earlier one returns).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { startBridge } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'bridge', 'bridgeServer'));
const { relaySseReplies } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegramFrontDeskBotCore'));

const TOKEN = 'bl320-acceptance-token';
const SUBJECT = 'SUP-1';
const TOPIC_ID = 1;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl320-acceptance-'));
}

function writeOutboxEntries(targetPath, entries) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-reply-outbox.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''));
}

function cursorFile(targetPath) {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-reply-relay-cursor.json');
}

function readCursor(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(cursorFile(targetPath), 'utf8'));
  } catch {
    return { ackedIndex: 0 };
  }
}

async function startRealBridge(ctx) {
  ctx.target = mkTmp();
  ctx.handle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, { pollIntervalMs: 20 });
}

async function realAck(port, id) {
  const res = await fetch(`http://127.0.0.1:${port}/reply-ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw new Error(`ack failed: ${res.status}`);
  }
}

// One real bot connection attempt: subscribes to the bridge's real /events
// stream and relays through the REAL relaySseReplies core, exactly the
// shape connectAndRelayReplies (telegram-front-desk-bot.ts) uses live.
// ackReply defaults to a real fetch POST to the bridge's own /reply-ack;
// a caller that needs to construct "delivered but never acked" (a lost
// ack, indistinguishable in its effect from a dropped connection) passes
// its own failing one instead. Returns a controller (to force a real
// socket teardown) and the in-flight relay promise (rejects on either a
// real drop or a failed ack).
async function connectBotOnce(port, seenIds, sentLog, ackReplyFn) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/events`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Deliberately does NOT pre-read/discard "the initial snapshot" chunk -
  // the bridge's own connect-time unacked-entry replay (bridgeServer.ts)
  // can coalesce into that SAME first TCP read alongside the bare
  // snapshot line, and relaySseReplies's own SSE-record parser already
  // correctly skips a record with no `event: telegram-reply` line. This
  // matches the REAL production connectAndRelayReplies
  // (telegram-front-desk-bot.ts) exactly, which also starts
  // relaySseReplies('', ...) with no throwaway read of its own.
  const relayPromise = relaySseReplies(
    '',
    {
      readChunk: async () => {
        const { done, value } = await reader.read();
        return { done, chunk: done ? '' : decoder.decode(value, { stream: true }) };
      },
      sendReply: async (topicId, text) => {
        sentLog.push({ topicId, text });
      },
      resolveDelivery: (subjectId) => (subjectId === SUBJECT ? { kind: 'topic', topicId: TOPIC_ID, alsoPointerToDefault: false } : { kind: 'undeliverable' }),
      ackReply: (id) => (ackReplyFn || ((ackId) => realAck(port, ackId)))(id),
    },
    seenIds
  );
  return { controller, relayPromise };
}

function failingAck() {
  return async () => {
    throw new Error('simulated: the ack never reached the bridge (lost between send and ack, same effect as a dropped socket)');
  };
}

// Waits until at least one record has been sent OR the relay promise has
// settled (rejected on a real drop or a failed ack) - whichever comes
// first, bounded so a bug that hangs the relay forever fails the
// scenario instead of the test run itself.
async function waitForSentOrSettled(sentLog, relayPromise, maxAttempts = 80) {
  let settled = false;
  relayPromise.catch(() => {}).then(() => (settled = true));
  for (let i = 0; i < maxAttempts && sentLog.length === 0 && !settled; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Connects, lets the relay run to completion for whatever is currently in
// the outbox (settling either because ackReplyFn threw, deterministically
// ending the attempt, or because nothing more arrives within the wait
// window), then forces a real socket teardown as cleanup.
async function connectRunAndDrop(port, seenIds, sentLog, ackReplyFn) {
  const { controller, relayPromise } = await connectBotOnce(port, seenIds, sentLog, ackReplyFn);
  await waitForSentOrSettled(sentLog, relayPromise);
  controller.abort();
  await relayPromise.catch(() => {});
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the reply path operator_reply\.bb.*Telegram$/, () => {
    // Narrative only - the real path is exercised end-to-end by the
    // scenarios below (a real bridge, a real outbox file, real HTTP).
  });

  registry.define(/^the bridgeServer currently advances its cursor on emit-to-socket, not on acknowledgement$/, () => {
    // Narrative description of the PRE-BL-320 defect this feature fixes -
    // no setup of its own; scenarios below assert the FIXED behavior.
  });

  // ── reply-relay-at-least-once-01 ────────────────────────────────────
  // This scenario is about the BRIDGE's own redelivery (does a fresh
  // connection get replayed the still-unacked entry at all) - deliberately
  // a FRESH seenIds Set per connection (unlike scenario 03 below, which
  // specifically tests the SAME bot process's cross-reconnect dedup), so a
  // pass here proves bridge-side redelivery independent of bot-side
  // idempotency.
  registry.define(/^the SSE connection drops mid-relay$/, async (ctx) => {
    await startRealBridge(ctx);
    ctx.sentFirst = [];
    writeOutboxEntries(ctx.target, [{ id: 'r1', threadId: SUBJECT, text: 'check the CI logs' }]);
    await connectRunAndDrop(ctx.handle.port, new Set(), ctx.sentFirst, failingAck());
    if (ctx.sentFirst.length !== 1) {
      throw new Error(`setup: expected the entry to be relayed to the bot before the drop, got ${JSON.stringify(ctx.sentFirst)}`);
    }
    if (readCursor(ctx.target).ackedIndex !== 0) {
      throw new Error(`setup: expected the entry to still be unacked, got cursor ${JSON.stringify(readCursor(ctx.target))}`);
    }
  });

  registry.define(/^the connection is re-established$/, async (ctx) => {
    ctx.secondSent = [];
    const { controller, relayPromise } = await connectBotOnce(ctx.handle.port, new Set(), ctx.secondSent);
    await waitForSentOrSettled(ctx.secondSent, relayPromise);
    ctx.secondController = controller;
    ctx.secondRelayPromise = relayPromise;
  });

  registry.define(/^all unacknowledged outbox entries should be redelivered$/, async (ctx) => {
    if (ctx.secondSent.length !== 1 || ctx.secondSent[0].text !== 'check the CI logs') {
      throw new Error(`expected the unacked entry to be redelivered on reconnect, got ${JSON.stringify(ctx.secondSent)}`);
    }
    ctx.secondController.abort();
    await ctx.secondRelayPromise.catch(() => {});
    ctx.handle.stop();
  });

  // ── reply-relay-at-least-once-02 ────────────────────────────────────
  registry.define(/^the bridge has unacked entries in the outbox$/, async (ctx) => {
    ctx.target = mkTmp();
    writeOutboxEntries(ctx.target, [
      { id: 'r1', threadId: SUBJECT, text: 'first' },
      { id: 'r2', threadId: SUBJECT, text: 'second' },
    ]);
    const firstHandle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, { pollIntervalMs: 20 });
    await realAck(firstHandle.port, 'r1');
    firstHandle.stop();
  });

  registry.define(/^the bridge restarts$/, async (ctx) => {
    ctx.cursorAfterAck = readCursor(ctx.target);
    ctx.handle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, { pollIntervalMs: 20 });
  });

  registry.define(/^it resumes from the last genuinely acknowledged cursor position$/, (ctx) => {
    if (ctx.cursorAfterAck.ackedIndex !== 1) {
      throw new Error(`setup: expected ackedIndex 1 after acking r1 before restart, got ${JSON.stringify(ctx.cursorAfterAck)}`);
    }
    if (readCursor(ctx.target).ackedIndex !== 1) {
      throw new Error(`expected the restarted bridge to still report ackedIndex 1, got ${JSON.stringify(readCursor(ctx.target))}`);
    }
  });

  registry.define(/^unacked entries are redelivered exactly once$/, async (ctx) => {
    const sent = [];
    const { controller, relayPromise } = await connectBotOnce(ctx.handle.port, new Set(), sent);
    await waitForSentOrSettled(sent, relayPromise);
    controller.abort();
    await relayPromise.catch(() => {});
    ctx.handle.stop();
    if (sent.length !== 1 || sent[0].text !== 'second') {
      throw new Error(`expected only the still-unacked entry ('second') redelivered once, got ${JSON.stringify(sent)}`);
    }
  });

  // ── reply-relay-at-least-once-03 ────────────────────────────────────
  registry.define(/^an outbox entry has been delivered but not yet acked$/, async (ctx) => {
    await startRealBridge(ctx);
    ctx.seenIds = new Set();
    ctx.sentFirst = [];
    writeOutboxEntries(ctx.target, [{ id: 'r1', threadId: SUBJECT, text: 'check the CI logs' }]);
    await connectRunAndDrop(ctx.handle.port, ctx.seenIds, ctx.sentFirst, failingAck());
    if (ctx.sentFirst.length !== 1) {
      throw new Error(`setup: expected the entry to be relayed once before the drop, got ${JSON.stringify(ctx.sentFirst)}`);
    }
  });

  registry.define(/^it is redelivered after a reconnect$/, async (ctx) => {
    ctx.secondSent = [];
    // The SAME seenIds set the first connection used - carried across
    // reconnects within one bot-process lifetime, exactly as
    // subscribeReplies (telegram-front-desk-bot.ts) does. The entry
    // itself is still sitting in the outbox from the Given step above,
    // still unacked (the ack never reached the bridge the first time).
    await connectRunAndDrop(ctx.handle.port, ctx.seenIds, ctx.secondSent);
  });

  registry.define(/^Telegram should receive it exactly once \(no duplicate\)$/, (ctx) => {
    if (ctx.secondSent.length !== 0) {
      throw new Error(`expected NO second sendReply call for the already-sent id, got ${JSON.stringify(ctx.secondSent)}`);
    }
    if (ctx.sentFirst.length !== 1) {
      throw new Error(`expected exactly one total sendReply call across both connections, got ${JSON.stringify(ctx.sentFirst)}`);
    }
    if (readCursor(ctx.target).ackedIndex !== 1) {
      throw new Error(`expected the redelivery's real ack to have finally advanced the cursor, got ${JSON.stringify(readCursor(ctx.target))}`);
    }
    ctx.handle.stop();
  });

  // ── reply-relay-at-least-once-04 ────────────────────────────────────
  registry.define(/^the bot receives a reply from the bridge$/, async (ctx) => {
    await startRealBridge(ctx);
    ctx.sent = [];
    const { controller, relayPromise } = await connectBotOnce(ctx.handle.port, new Set(), ctx.sent);
    writeOutboxEntries(ctx.target, [{ id: 'r1', threadId: SUBJECT, text: 'hi' }]);
    ctx.controller = controller;
    ctx.relayPromise = relayPromise;
  });

  registry.define(/^the bot successfully posts to Telegram$/, async (ctx) => {
    await waitForSentOrSettled(ctx.sent, ctx.relayPromise);
    if (ctx.sent.length !== 1) {
      throw new Error(`expected sendReply to have been called, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^the bot sends an acknowledgement to the bridge$/, async (ctx) => {
    // ackReply is awaited synchronously right after sendReply inside
    // relayOneRecord (telegramFrontDeskBotCore.ts) - by the time
    // sendReply's own effect is observable above, the real ack POST has
    // already completed too (proven directly by the earlier debug trace).
    // Poll briefly regardless, rather than assume, so this step's own
    // assertion is what actually observes it.
    for (let i = 0; i < 40 && readCursor(ctx.target).ackedIndex !== 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (readCursor(ctx.target).ackedIndex !== 1) {
      throw new Error(`expected the ack to have reached the bridge, got cursor ${JSON.stringify(readCursor(ctx.target))}`);
    }
  });

  registry.define(/^the bridge advances its delivered cursor$/, async (ctx) => {
    if (readCursor(ctx.target).ackedIndex !== 1) {
      throw new Error(`expected the persisted cursor to have advanced to 1, got ${JSON.stringify(readCursor(ctx.target))}`);
    }
    ctx.controller.abort();
    await ctx.relayPromise.catch(() => {});
    ctx.handle.stop();
  });

  // ── reply-relay-at-least-once-05 ────────────────────────────────────
  registry.define(/^the SSE connection terminates during relay$/, async (ctx) => {
    await startRealBridge(ctx);
    ctx.sent = [];
    writeOutboxEntries(ctx.target, [{ id: 'r1', threadId: SUBJECT, text: 'hi' }]);
    const { relayPromise } = await connectBotOnce(ctx.handle.port, new Set(), ctx.sent, failingAck());
    await waitForSentOrSettled(ctx.sent, relayPromise);
    ctx.relayPromise = relayPromise;
  });

  registry.define(/^the daemon detects the terminated state$/, async (ctx) => {
    let rejected = false;
    try {
      await ctx.relayPromise;
    } catch {
      rejected = true;
    }
    ctx.relayRejected = rejected;
    // Captured HERE, at the moment termination is detected and before any
    // reconnect - "should not count the entries as delivered" describes
    // the consequence of the termination itself, not a claim that stays
    // true forever (a SUBSEQUENT successful reconnect+ack legitimately
    // does advance the cursor - that is the whole point of at-least-once
    // delivery).
    ctx.cursorAtTermination = readCursor(ctx.target).ackedIndex;
  });

  registry.define(/^it should trigger reconnect and replay$/, async (ctx) => {
    if (!ctx.relayRejected) {
      throw new Error('expected the terminated connection to reject the relay promise, not resolve cleanly');
    }
    ctx.replaySent = [];
    const { controller, relayPromise } = await connectBotOnce(ctx.handle.port, new Set(), ctx.replaySent);
    await waitForSentOrSettled(ctx.replaySent, relayPromise);
    controller.abort();
    await relayPromise.catch(() => {});
    if (ctx.replaySent.length !== 1) {
      throw new Error(`expected the terminated entry to be replayed on the next connection, got ${JSON.stringify(ctx.replaySent)}`);
    }
  });

  registry.define(/^should not count the entries as delivered$/, (ctx) => {
    if (ctx.cursorAtTermination !== 0) {
      throw new Error(`expected the persisted cursor to still be 0 at the moment of termination (never acked before the drop), got ${ctx.cursorAtTermination}`);
    }
    ctx.handle.stop();
  });
}

module.exports = { registerSteps };
