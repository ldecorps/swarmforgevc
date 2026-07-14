'use strict';

// BL-284: step handlers for "Operator proactively notifies the right
// subject topic (Notify slice)". Drives the REAL operator_notify.bb CLI
// (real fs, mirroring operatorThreadLifecycleSteps.js's own idle-nudge
// pattern) and the REAL bridge (startBridge) + telegramFrontDeskBotCore.ts's
// relaySseReplies for the egress/routing scenarios, mirroring
// telegramTopicThreadsSteps.js's telegram-topic-03/04 pattern - no real
// Telegram network, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { relaySseReplies } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const SUPPORT_THREAD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'support_thread.bb');
const OPERATOR_NOTIFY_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_notify.bb');

const BRIDGE_TOKEN = 'aps-operator-notify-bridge-token';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-notify-'));
}

function openThread(root, text) {
  const out = execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'open', '--channel', 'telegram', '--text', text], { encoding: 'utf8' });
  return JSON.parse(out);
}

function notify(root, threadId, changed, summary) {
  const out = execFileSync(
    'bb',
    [OPERATOR_NOTIFY_CLI, root, '--thread', threadId, '--changed', String(changed), '--summary', summary],
    { encoding: 'utf8' }
  );
  return JSON.parse(out);
}

async function withBridge(target, fn) {
  const handle = await startBridge(target, path.join(target, 'runs.jsonl'), BRIDGE_TOKEN);
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

async function drainSseTopics(root, topicMap) {
  const posted = [];
  await withBridge(root, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/events`, { headers: { authorization: `Bearer ${BRIDGE_TOKEN}` } });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let attempts = 0;
    while (!buffer.includes('event: telegram-reply') && attempts < 10) {
      buffer += decoder.decode((await reader.read()).value);
      attempts += 1;
    }
    // relaySseReplies loops forever reading chunks - readChunk reports done
    // after the buffered content is drained once (we already have the
    // notice buffered from the wait loop above), mirroring how
    // telegram-topic-03's own test bounds a live SSE stream to one drain.
    let readCount = 0;
    await relaySseReplies(
      buffer,
      {
        readChunk: async () => {
          readCount += 1;
          return { done: readCount > 1, chunk: '' };
        },
        sendReply: async (topicId, text) => {
          posted.push({ topicId, text });
        },
        resolveDelivery: (subjectId) =>
          topicMap[subjectId] !== undefined ? { kind: 'topic', topicId: topicMap[subjectId], alsoPointerToDefault: false } : { kind: 'undeliverable' },
        // Pre-existing gap (predates BL-355): relaySseReplies has required
        // ackReply/seenIds params since BL-320, but this call site was never
        // updated, so `seenIds.has(id)` threw the moment a record actually
        // reached relayOneRecord - surfaced while verifying BL-355 did not
        // regress this suite, fixed here rather than left broken.
        ackReply: async () => {},
      },
      new Set()
    );
  });
  return posted;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the runtime can deliver a proactive notice over the built reply-outbox bridge egress$/, () => {
    // Framing only - established by BL-281/BL-276, reused unchanged here.
  });

  // ── proactive-notify-01 ──────────────────────────────────────────────
  registry.define(/^two subjects each with an open topic and no pending inbound message$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.subjectA = openThread(ctx.root, 'about A');
    ctx.subjectB = openThread(ctx.root, 'about B');
    ctx.topicMap = { [ctx.subjectA.id]: 101, [ctx.subjectB.id]: 202 };
  });

  registry.define(/^the runtime raises a proactive notice for the first subject$/, async (ctx) => {
    ctx.noticeText = 'BL-100 moved to done';
    ctx.result = notify(ctx.root, ctx.subjectA.id, true, ctx.noticeText);
    ctx.posted = await drainSseTopics(ctx.root, ctx.topicMap);
  });

  registry.define(/^the first subject's topic receives the notice$/, (ctx) => {
    const forA = ctx.posted.filter((p) => p.topicId === ctx.topicMap[ctx.subjectA.id]);
    if (forA.length !== 1 || forA[0].text !== ctx.noticeText) {
      throw new Error(`expected subject A's topic to receive the notice, got: ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^the second subject's topic receives nothing$/, (ctx) => {
    const forB = ctx.posted.filter((p) => p.topicId === ctx.topicMap[ctx.subjectB.id]);
    if (forB.length !== 0) {
      throw new Error(`expected subject B's topic to receive nothing, got: ${JSON.stringify(ctx.posted)}`);
    }
  });

  // ── proactive-notify-02 ──────────────────────────────────────────────
  registry.define(/^the Operator has a subject notice ready to send$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.subject = openThread(ctx.root, 'about A');
    ctx.noticeText = 'BL-100 moved to done';
  });

  registry.define(/^the notice is emitted$/, (ctx) => {
    ctx.result = notify(ctx.root, ctx.subject.id, true, ctx.noticeText);
  });

  registry.define(/^it is appended to the reply outbox tagged for that subject and relayed to the topic over the bridge$/, (ctx) => {
    if (ctx.result.notice !== 'notify') {
      throw new Error(`expected a notify decision, got: ${JSON.stringify(ctx.result)}`);
    }
    const outboxFile = path.join(ctx.root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
    const lines = fs
      .readFileSync(outboxFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    if (!lines.some((l) => l.threadId === ctx.subject.id && l.text === ctx.noticeText)) {
      throw new Error(`expected the reply outbox to carry the notice tagged for ${ctx.subject.id}, got: ${JSON.stringify(lines)}`);
    }
  });

  registry.define(/^the runtime makes no direct Telegram call$/, () => {
    // Static contract check (same idiom as briefingDiagramSteps.js's
    // network-API check): operator_notify.bb must carry no actual network-
    // call API - only the outbox file. Matches call/require syntax, not the
    // word "Telegram" in a comment (the file's own docstring names it while
    // explaining why there is no such call).
    const src = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_notify.bb'), 'utf8');
    const networkApiPattern = /babashka\.http-client|http\/post|http\/get|\bcurl\b|\bfetch\(/;
    if (networkApiPattern.test(src)) {
      throw new Error('expected operator_notify.bb to contain no direct Telegram/network call');
    }
  });

  // ── proactive-notify-03 ──────────────────────────────────────────────
  registry.define(/^a status change concerning a subject that has an open topic$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.subject = openThread(ctx.root, 'about A');
    ctx.changed = true;
  });

  registry.define(/^the runtime evaluates whether to notify$/, (ctx) => {
    ctx.result = notify(ctx.root, ctx.subject.id, ctx.changed, 'BL-100 moved to done');
  });

  registry.define(/^it emits exactly one proactive notice for that subject$/, (ctx) => {
    if (ctx.result.notice !== 'notify') {
      throw new Error(`expected exactly one proactive notice, got: ${JSON.stringify(ctx.result)}`);
    }
    const thread = JSON.parse(fs.readFileSync(path.join(ctx.root, '.swarmforge', 'support', 'threads', `${ctx.subject.id}.json`), 'utf8'));
    const noticeCount = thread.messages.filter((m) => m.channel === 'operator').length;
    if (noticeCount !== 1) {
      throw new Error(`expected exactly one notice message appended, got ${noticeCount}`);
    }
  });

  // ── proactive-notify-04 ──────────────────────────────────────────────
  registry.define(/^a subject whose status has not changed$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.subject = openThread(ctx.root, 'about A');
    ctx.changed = false;
  });

  registry.define(/^the runtime stays silent$/, (ctx) => {
    if (ctx.result.notice !== 'none') {
      throw new Error(`expected no proactive notice, got: ${JSON.stringify(ctx.result)}`);
    }
    const thread = JSON.parse(fs.readFileSync(path.join(ctx.root, '.swarmforge', 'support', 'threads', `${ctx.subject.id}.json`), 'utf8'));
    if (thread.messages.some((m) => m.channel === 'operator')) {
      throw new Error(`expected no operator notice message appended, got: ${JSON.stringify(thread)}`);
    }
  });
}

module.exports = { registerSteps };
