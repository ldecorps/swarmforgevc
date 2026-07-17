'use strict';

// BL-494: step handlers for "One-time reconcile that closes the legacy
// per-ticket Telegram topics, rate-limit safe and idempotent". Drives the
// REAL compiled closeLegacyTicketTopics (close-legacy-ticket-topics.ts)
// against a real backlog-topic-map.json fixture on disk and a fake
// Telegram postFn - never a hand-rolled reimplementation of the selection/
// retry/idempotency rules, mirroring this codebase's own step-file
// convention for one-time migration tools.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { closeLegacyTicketTopics } = require(path.join(EXT_DIR, 'out', 'tools', 'close-legacy-ticket-topics'));
const { readBacklogTopicMap } = require(path.join(EXT_DIR, 'out', 'concierge', 'backlogTopicMapStore'));

const TOKEN = '123:test-token';
const CHAT_ID = '999';
const PER_TICKET_TOPICS = { 'BL-1': 101, 'BL-2': 102 };
const STANDING_TOPICS = { 'topic-consolidation': 500, BACKLOG: 600 };

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl494-'));
}

function writeTopicMap(targetPath, map) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog-topic-map.json'), JSON.stringify(map));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a topic map holding a mix of per-ticket, epic, and Backlog topic ids$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeTopicMap(ctx.targetPath, { ...PER_TICKET_TOPICS, ...STANDING_TOPICS });
    ctx.closedIds = [];
    ctx.waits = [];
    ctx.rateLimitOnce = undefined;
    ctx.ranOk = undefined;
  });

  registry.define(/^the reconcile tool is run$/, async (ctx) => {
    const postFn = async (url, body) => {
      const threadId = JSON.parse(body).message_thread_id;
      if (ctx.rateLimitOnce === threadId) {
        ctx.rateLimitOnce = undefined;
        return { ok: false, status: 429, json: { ok: false, description: 'retry after 26', parameters: { retry_after: 26 } } };
      }
      ctx.closedIds.push(threadId);
      return { ok: true, status: 200, json: { ok: true, result: true } };
    };
    ctx.outcomes = await closeLegacyTicketTopics(ctx.targetPath, TOKEN, CHAT_ID, async (ms) => ctx.waits.push(ms), postFn);
    ctx.ranOk = true;
  });

  // ── close-legacy-topics-01 ───────────────────────────────────────────
  registry.define(/^the map records several per-ticket topics$/, () => {
    // Documented by the Background fixture itself (BL-1, BL-2) - nothing
    // further to arrange.
  });

  registry.define(/^each legacy per-ticket topic is closed$/, (ctx) => {
    const expected = Object.values(PER_TICKET_TOPICS).sort();
    if (JSON.stringify(ctx.closedIds.slice().sort()) !== JSON.stringify(expected)) {
      throw new Error(`expected every per-ticket topic id closed, got: ${JSON.stringify(ctx.closedIds)}`);
    }
  });

  registry.define(/^each closed per-ticket topic's key is dropped from the map$/, (ctx) => {
    const remaining = readBacklogTopicMap(ctx.targetPath);
    for (const backlogId of Object.keys(PER_TICKET_TOPICS)) {
      if (backlogId in remaining) {
        throw new Error(`expected ${backlogId} dropped from the map, got: ${JSON.stringify(remaining)}`);
      }
    }
  });

  // ── close-legacy-topics-02 ───────────────────────────────────────────
  registry.define(/^closing a per-ticket topic returns a rate-limit response with a retry_after delay$/, (ctx) => {
    ctx.rateLimitOnce = PER_TICKET_TOPICS['BL-1'];
  });

  registry.define(/^the tool waits the retry_after delay before continuing$/, (ctx) => {
    if (!ctx.waits.includes(26000)) {
      throw new Error(`expected a 26000ms wait (retry_after=26s), got: ${JSON.stringify(ctx.waits)}`);
    }
  });

  registry.define(/^it then closes the remaining per-ticket topics without dropping any$/, (ctx) => {
    if (!ctx.outcomes.every((o) => o.closed)) {
      throw new Error(`expected every per-ticket topic to end up closed despite the mid-run 429, got: ${JSON.stringify(ctx.outcomes)}`);
    }
    const remaining = readBacklogTopicMap(ctx.targetPath);
    for (const backlogId of Object.keys(PER_TICKET_TOPICS)) {
      if (backlogId in remaining) {
        throw new Error(`expected ${backlogId} dropped despite the 429, got: ${JSON.stringify(remaining)}`);
      }
    }
  });

  // ── close-legacy-topics-03 ───────────────────────────────────────────
  registry.define(/^the map records epic topic ids and the reserved Backlog topic id$/, () => {
    // Documented by the Background fixture itself (topic-consolidation,
    // BACKLOG) - nothing further to arrange.
  });

  registry.define(/^no epic topic is closed$/, (ctx) => {
    if (ctx.closedIds.includes(STANDING_TOPICS['topic-consolidation'])) {
      throw new Error(`expected the epic topic never closed, got closedIds: ${JSON.stringify(ctx.closedIds)}`);
    }
  });

  registry.define(/^the Backlog topic and other standing topics are not closed$/, (ctx) => {
    if (ctx.closedIds.includes(STANDING_TOPICS.BACKLOG)) {
      throw new Error(`expected the Backlog topic never closed, got closedIds: ${JSON.stringify(ctx.closedIds)}`);
    }
    const remaining = readBacklogTopicMap(ctx.targetPath);
    if (!('topic-consolidation' in remaining) || !('BACKLOG' in remaining)) {
      throw new Error(`expected the epic/Backlog keys still in the map, got: ${JSON.stringify(remaining)}`);
    }
  });

  // ── close-legacy-topics-04 ───────────────────────────────────────────
  registry.define(/^a prior run already closed and dropped every per-ticket topic$/, (ctx) => {
    writeTopicMap(ctx.targetPath, { ...STANDING_TOPICS });
  });

  registry.define(/^no topic is closed a second time$/, (ctx) => {
    if (ctx.closedIds.length !== 0) {
      throw new Error(`expected no topic closed on a re-run with nothing left to close, got: ${JSON.stringify(ctx.closedIds)}`);
    }
  });

  registry.define(/^the tool completes without error$/, (ctx) => {
    if (ctx.ranOk !== true) {
      throw new Error('expected the reconcile tool to complete without throwing');
    }
  });
}

module.exports = { registerSteps };
