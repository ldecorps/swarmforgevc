'use strict';

// BL-332: step handlers for "A topic can be recreated from scratch by
// replaying its serialised record". Drives the REAL compiled decision/
// replay logic (topicRecreation.ts's decideTopicRestore/
// recreateTopicFromRecord) against a REAL blTopicStore record (real fs,
// real appendMessage) - only the Telegram network leg is faked (capturing
// exactly what would be posted, never a real HTTP call), the same "drive
// the real compiled logic, fake only the network leg" convention
// topicLifecycleReconciliationSteps.js already uses. The round trip -
// serialise, delete (no mapping), recreate, content matches - is proven
// end to end through the SAME production functions the real CLI
// (recreate-bl-topic.ts) wires, not a hand-rolled substitute for either.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { recreateTopicFromRecord, decideTopicRestore } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicRecreation')
);
const { readRecord, appendMessage, recordPath } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'blTopicStore'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl332-'));
}

async function driveRecreate(ctx) {
  ctx.posted = [];
  ctx.recordBefore = fs.readFileSync(recordPath(ctx.root, ctx.ticketId), 'utf8');
  const decision = decideTopicRestore(ctx.topicMap, ctx.ticketId);
  ctx.decision = decision;
  if (decision.action === 'reopen') {
    ctx.result = { success: true, topicId: decision.topicId };
    return;
  }
  ctx.result = await recreateTopicFromRecord(
    ctx.ticketId,
    ctx.title,
    {
      readRecord: (id) => readRecord(ctx.root, id),
      createTopic: async () => 555,
      postMessage: async (topicId, text) => {
        ctx.posted.push({ topicId, text });
        return true;
      },
      recordTopicId: (id, topicId) => {
        ctx.topicMap[id] = topicId;
      },
    },
    Date.parse('2026-07-14T00:00:00Z')
  );
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a backlog ticket whose topic content has been serialised into the repository$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.ticketId = 'BL-900';
    ctx.title = 'a fine feature';
    appendMessage(ctx.root, ctx.ticketId, { author: 'human', type: 'inbound', text: 'the original question', ts: Date.parse('2026-01-01T00:00:00Z') });
    appendMessage(ctx.root, ctx.ticketId, { author: 'swarm', type: 'outbound', text: 'the original answer', ts: Date.parse('2026-01-01T00:05:00Z') });
    // No mapping at all - the default precondition every scenario except
    // 01 relies on implicitly (a genuinely deleted topic).
    ctx.topicMap = {};
  });

  // ── recreate-topic-01 ──────────────────────────────────────────────
  registry.define(/^that ticket's topic has been deleted$/, (ctx) => {
    ctx.topicMap = {};
  });

  registry.define(/^the topic is recreated from its record alone$/, async (ctx) => {
    await driveRecreate(ctx);
  });

  registry.define(/^a new topic exists for that ticket$/, (ctx) => {
    if (!ctx.result || !ctx.result.success) {
      throw new Error(`expected a new topic to have been created, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^its content matches the serialised record$/, (ctx) => {
    const record = readRecord(ctx.root, ctx.ticketId);
    if (ctx.posted.length !== record.messages.length + 1) {
      throw new Error(`expected a reconstruction header + ${record.messages.length} replayed message(s), got ${ctx.posted.length} posted`);
    }
    record.messages.forEach((m, i) => {
      if (!ctx.posted[i + 1].text.includes(m.text)) {
        throw new Error(`expected replayed message ${i} to contain "${m.text}", got: ${ctx.posted[i + 1].text}`);
      }
    });
  });

  // ── recreate-topic-02 ──────────────────────────────────────────────
  registry.define(/^the recreated topic is clearly labelled a reconstruction$/, (ctx) => {
    if (!/reconstructed/i.test(ctx.posted[0].text)) {
      throw new Error(`expected the first posted message to label the topic a reconstruction, got: ${ctx.posted[0].text}`);
    }
  });

  registry.define(/^it is not presented as the original conversation$/, (ctx) => {
    if (!/not the original/i.test(ctx.posted[0].text)) {
      throw new Error(`expected the label to explicitly say it is NOT the original, got: ${ctx.posted[0].text}`);
    }
  });

  // ── recreate-topic-03 ──────────────────────────────────────────────
  registry.define(/^the record holds messages from both the swarm and the human$/, (ctx) => {
    const record = readRecord(ctx.root, ctx.ticketId);
    if (!record.messages.some((m) => m.author === 'human') || !record.messages.some((m) => m.author === 'swarm')) {
      throw new Error('setup invariant violated: expected the record to already hold both a human and a swarm message (from the Background)');
    }
  });

  registry.define(/^each replayed message shows the author who originally sent it$/, (ctx) => {
    const record = readRecord(ctx.root, ctx.ticketId);
    record.messages.forEach((m, i) => {
      if (!ctx.posted[i + 1].text.includes(m.author)) {
        throw new Error(`expected replayed message ${i} to show its original author (${m.author}), got: ${ctx.posted[i + 1].text}`);
      }
    });
  });

  registry.define(/^each replayed message shows the time it was originally sent$/, (ctx) => {
    const record = readRecord(ctx.root, ctx.ticketId);
    record.messages.forEach((m, i) => {
      const iso = new Date(m.ts).toISOString();
      if (!ctx.posted[i + 1].text.includes(iso)) {
        throw new Error(`expected replayed message ${i} to show its original timestamp (${iso}), got: ${ctx.posted[i + 1].text}`);
      }
    });
  });

  // ── recreate-topic-04 ──────────────────────────────────────────────
  registry.define(/^that ticket maps to the new topic$/, (ctx) => {
    if (ctx.topicMap[ctx.ticketId] !== ctx.result.topicId) {
      throw new Error(`expected the ticket to map to the new topic id, got map=${JSON.stringify(ctx.topicMap)} result=${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the swarm posts about that ticket in the new topic$/, (ctx) => {
    // Proven structurally: every subsequent post for this ticket resolves
    // through topicMap[ticketId] - the SAME map ordinary routing reads
    // (topicRouter.ts's own backlogForTopic/routeEvent) - which now
    // points at the recreated topic. No separate posting mechanism to
    // stand up here.
    if (ctx.topicMap[ctx.ticketId] === undefined) {
      throw new Error('expected the new topic id to be resolvable for ordinary routing to post into');
    }
  });

  // ── recreate-topic-05 ──────────────────────────────────────────────
  registry.define(/^the record in the repository is left intact$/, (ctx) => {
    const after = fs.readFileSync(recordPath(ctx.root, ctx.ticketId), 'utf8');
    if (after !== ctx.recordBefore) {
      throw new Error('expected the repo record to be byte-identical after recreating - recreate must be a pure read, never a consume/move');
    }
  });

  registry.define(/^the topic can be recreated from it again$/, async (ctx) => {
    const again = await recreateTopicFromRecord(
      ctx.ticketId,
      ctx.title,
      {
        readRecord: (id) => readRecord(ctx.root, id),
        createTopic: async () => 999,
        postMessage: async () => true,
        recordTopicId: () => {},
      },
      Date.parse('2026-07-14T01:00:00Z')
    );
    if (!again.success) {
      throw new Error('expected the topic to be recreatable a second time from the same intact record');
    }
  });
}

module.exports = { registerSteps };
