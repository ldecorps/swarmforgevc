'use strict';

// BL-584: step handlers for stale Approvals-topic ask → email escalation.
// Drives the REAL pure helpers + sweep (no network; injected sendEmail).

const assert = require('node:assert/strict');
const { APPROVAL_ASK_LOCATOR } = require('../../../extension/out/concierge/topicRouter');
const {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_STALE_AFTER_MS,
  resetStaleApprovalMissingKeyWarningForTests,
  sweepStaleApprovalAsks,
} = require('../../../extension/out/notify/staleApprovalEscalation');

const FEATURE =
  'An unanswered approval ask escalates to email with a link into the Approvals topic';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-08-24T18:00:00Z');

function parseAge(label) {
  const hours = label.match(/^(\d+)\s+hours?$/);
  if (hours) {
    return Number(hours[1]) * HOUR;
  }
  const minutes = label.match(/^(\d+)\s+minutes?$/);
  if (minutes) {
    return Number(minutes[1]) * 60 * 1000;
  }
  throw new Error(`unknown age label: ${label}`);
}

function askMessage(id, ts) {
  return {
    seq: 1,
    ts,
    author: 'swarm',
    type: 'outbound',
    text: `${id} ${APPROVAL_ASK_LOCATOR} before it can proceed.`,
  };
}

function ensureWorld(ctx) {
  if (!ctx.bl584) {
    ctx.bl584 = {
      approvalsTopicId: 1785,
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      to: 'human@example.com',
      from: 'onboarding@resend.dev',
      apiKey: 're_test',
      chatId: '-1004415865297',
      lastSentMs: null,
      tickets: new Map(),
      sent: [],
      warnings: [],
      nowMs: NOW,
    };
  }
  return ctx.bl584;
}

function upsertTicket(ctx, id, patch) {
  const world = ensureWorld(ctx);
  const prev = world.tickets.get(id) || {
    id,
    state: 'pending',
    askPostedAtMs: world.nowMs - 3 * HOUR,
    messages: null,
    askMessageId: 6719,
    askTopicId: world.approvalsTopicId,
    topicMissing: false,
    noAskInTopic: false,
  };
  const next = { ...prev, ...patch, id };
  world.tickets.set(id, next);
  return next;
}

function candidateFromTicket(ticket, world) {
  if (ticket.topicMissing) {
    return {
      id: ticket.id,
      state: ticket.state,
      topicRecord: undefined,
      askMessageId: ticket.askMessageId,
      askTopicId: ticket.askTopicId,
    };
  }
  let messages = ticket.messages;
  if (!messages) {
    messages = ticket.noAskInTopic
      ? [{ seq: 1, ts: ticket.askPostedAtMs, author: 'swarm', type: 'outbound', text: 'unrelated' }]
      : [askMessage(ticket.id, ticket.askPostedAtMs)];
  }
  return {
    id: ticket.id,
    state: ticket.state,
    topicRecord: { id: ticket.id, messages },
    askMessageId: ticket.askMessageId,
    askTopicId: ticket.askTopicId,
  };
}

async function runSweep(ctx) {
  const world = ensureWorld(ctx);
  resetStaleApprovalMissingKeyWarningForTests();
  let lastSent = world.lastSentMs;
  world.lastOutcome = await sweepStaleApprovalAsks(
    {
      to: world.to,
      from: world.from,
      chatId: world.chatId,
      staleAfterMs: world.staleAfterMs,
      cooldownMs: world.cooldownMs,
    },
    {
      nowMs: () => world.nowMs,
      listCandidates: () => [...world.tickets.values()].map((t) => candidateFromTicket(t, world)),
      sendEmail: async (message) => {
        world.sent.push(message);
        return { success: true };
      },
      readLastSentMs: () => lastSent,
      writeLastSentMs: (ms) => {
        lastSent = ms;
        world.lastSentMs = ms;
      },
      readApiKey: () => world.apiKey,
      warnMissingApiKey: () => {
        world.warnings.push('cannot send');
      },
    }
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the standing Approvals topic is (\d+)$/, (ctx, topicId) => {
    ensureWorld(ctx).approvalsTopicId = Number(topicId);
  });

  scoped(
    /^the approval-ask stale threshold is (\d+) hours? and the escalation cooldown is (\d+) hours?$/,
    (ctx, staleHours, cooldownHours) => {
      const world = ensureWorld(ctx);
      world.staleAfterMs = Number(staleHours) * HOUR;
      world.cooldownMs = Number(cooldownHours) * HOUR;
    }
  );

  scoped(/^escalation email is configured with a recipient and an API key$/, (ctx) => {
    const world = ensureWorld(ctx);
    world.to = 'human@example.com';
    world.apiKey = 're_test';
  });

  scoped(/^BL-(\d+) is awaiting approval and its ask was posted (.+) ago$/, (ctx, num, age) => {
    const id = `BL-${num}`;
    upsertTicket(ctx, id, {
      state: 'pending',
      askPostedAtMs: ensureWorld(ctx).nowMs - parseAge(age),
      askTopicId: ensureWorld(ctx).approvalsTopicId,
    });
  });

  scoped(/^BL-(\d+) has human_approval (\S+) and its ask was posted (.+) ago$/, (ctx, num, state, age) => {
    assert.ok(
      state === 'pending' ||
        state === 'amending' ||
        state === 'approved' ||
        state === 'rejected' ||
        state === 'absent',
      `unknown human_approval example: ${state}`
    );
    const id = `BL-${num}`;
    upsertTicket(ctx, id, {
      state: state === 'absent' ? 'absent' : state,
      askPostedAtMs: ensureWorld(ctx).nowMs - parseAge(age),
      askTopicId: ensureWorld(ctx).approvalsTopicId,
    });
  });

  scoped(/^the newest (inbound|outbound) message in its topic record is (.+) old$/, (ctx, direction, age) => {
    const world = ensureWorld(ctx);
    const ticket = world.tickets.get('BL-100');
    assert.ok(ticket, 'expected BL-100 to exist');
    const askTs = ticket.askPostedAtMs;
    const recentTs = world.nowMs - parseAge(age);
    ticket.messages = [
      askMessage('BL-100', askTs),
      {
        seq: 2,
        ts: recentTs,
        author: direction === 'inbound' ? 'human' : 'swarm',
        type: direction,
        text: direction === 'inbound' ? 'human reply' : 'swarm status',
      },
    ];
  });

  scoped(/^the Telegram chat id is (\S+)$/, (ctx, chatId) => {
    assert.ok(
      chatId === '-1004415865297' || chatId === '4415865297' || chatId === 'not-a-number',
      `unknown chat_id example: ${chatId}`
    );
    ensureWorld(ctx).chatId = chatId;
  });

  scoped(
    /^BL-(\d+) is awaiting approval for (.+) with recorded ask message id (\S+)$/,
    (ctx, num, age, messageId) => {
      assert.ok(
        messageId === 'absent' || /^\d+$/.test(messageId),
        `unknown message_id example: ${messageId}`
      );
      const world = ensureWorld(ctx);
      const id = `BL-${num}`;
      upsertTicket(ctx, id, {
        state: 'pending',
        askPostedAtMs: world.nowMs - parseAge(age),
        askTopicId: world.approvalsTopicId,
        askMessageId: messageId === 'absent' ? undefined : Number(messageId),
      });
    }
  );

  scoped(/^the previous escalation email was sent (.+) ago$/, (ctx, age) => {
    const world = ensureWorld(ctx);
    world.lastSentMs = world.nowMs - parseAge(age);
  });

  scoped(/^BL-(\d+) is awaiting approval and (.+)$/, (ctx, num, condition) => {
    const world = ensureWorld(ctx);
    const id = `BL-${num}`;
    const base = {
      state: 'pending',
      askPostedAtMs: world.nowMs - 3 * HOUR,
      askTopicId: world.approvalsTopicId,
    };
    if (condition === 'its topic record holds no approval-ask message') {
      upsertTicket(ctx, id, { ...base, noAskInTopic: true });
    } else if (condition === 'its topic record is missing entirely') {
      upsertTicket(ctx, id, { ...base, topicMissing: true });
    } else if (condition === 'the escalation recipient is unset') {
      upsertTicket(ctx, id, base);
      world.to = undefined;
    } else {
      throw new Error(`unknown fail-closed condition: ${condition}`);
    }
  });

  scoped(/^the Resend API key is absent from the environment$/, (ctx) => {
    ensureWorld(ctx).apiKey = undefined;
  });

  scoped(/^the stale-approval sweep runs$/, async (ctx) => {
    await runSweep(ctx);
  });

  scoped(/^an escalation email is (.+)$/, (ctx, outcome) => {
    assert.ok(
      outcome === 'sent' || outcome === 'not sent',
      `unknown escalation outcome example: ${outcome}`
    );
    const world = ensureWorld(ctx);
    if (outcome === 'sent') {
      assert.equal(world.lastOutcome, 'sent');
      assert.equal(world.sent.length, 1);
    } else {
      assert.notEqual(world.lastOutcome, 'sent');
      assert.equal(world.sent.length, 0);
    }
  });

  scoped(/^exactly one escalation email is sent$/, (ctx) => {
    const world = ensureWorld(ctx);
    assert.equal(world.lastOutcome, 'sent');
    assert.equal(world.sent.length, 1);
  });

  scoped(/^its body lists BL-(\d+) before BL-(\d+)$/, (ctx, first, second) => {
    const text = ensureWorld(ctx).sent[0].text;
    assert.ok(text.indexOf(`BL-${first}`) < text.indexOf(`BL-${second}`));
  });

  scoped(/^the email body links BL-(\d+) to "([^"]+)"$/, (ctx, num, link) => {
    const text = ensureWorld(ctx).sent[0].text;
    const id = `BL-${num}`;
    if (link === '(no link)') {
      assert.doesNotMatch(text, new RegExp(`${id} \\([^)]+\\) https://`));
      assert.match(text, new RegExp(`${id} \\(`));
    } else {
      assert.match(text, new RegExp(`${id} \\([^)]+\\) ${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  });

  scoped(/^the sweep completes without error$/, (ctx) => {
    assert.ok(ensureWorld(ctx).lastOutcome === 'sent' || ensureWorld(ctx).lastOutcome === 'not-sent' || ensureWorld(ctx).lastOutcome === 'warned');
  });

  scoped(/^the sweep warns that escalation email cannot send$/, (ctx) => {
    const world = ensureWorld(ctx);
    assert.equal(world.lastOutcome, 'warned');
    assert.ok(world.warnings.length >= 1);
  });
}

module.exports = { registerSteps };
