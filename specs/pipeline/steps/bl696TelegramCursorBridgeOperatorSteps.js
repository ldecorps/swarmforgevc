'use strict';

// BL-696: acceptance steps for Telegram Cursor Remote operator commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach } = require('node:test');

const { summarizeSdkProgressLine } = require('../../../extension/out/bridge/cursorBridgeProgress');
const { endActiveRun } = require('../../../extension/out/bridge/cursorBridgeRunTracker');
const { createMockCursorBridgeAgentSession } = require('../../../extension/out/bridge/cursorBridgeAgentSession');
const { decideInboundAction, gateBusy } = require('../../../extension/out/tools/telegramCursorBridgeCore');
const { handleInboundDecision, postChunks } = require('../../../extension/out/tools/telegramCursorBridgeLive');
const { isActiveRunInFlight, beginActiveRun } = require('../../../extension/out/bridge/cursorBridgeRunTracker');
const expediteModule = require('../../../extension/out/tools/telegramCursorBridgeExpedite');
const redeployModule = require('../../../extension/out/tools/telegramCursorBridgeRedeploy');

const FEATURE = 'Telegram Cursor Remote operator commands';
const CHAT_ID = '-100';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;

let pendingPromptRelease;
let restoreExpediteSpawn;
let restoreReexpediteSpawn;
let restoreRedeploySpawn;

afterEach(() => {
  pendingPromptRelease?.();
  pendingPromptRelease = undefined;
  endActiveRun();
});

after(() => {
  pendingPromptRelease?.();
  pendingPromptRelease = undefined;
  endActiveRun();
  if (restoreExpediteSpawn) {
    expediteModule.startExpediteRun = restoreExpediteSpawn;
    restoreExpediteSpawn = undefined;
  }
  if (restoreReexpediteSpawn) {
    expediteModule.startReexpediteRun = restoreReexpediteSpawn;
    restoreReexpediteSpawn = undefined;
  }
  if (restoreRedeploySpawn) {
    redeployModule.startRedeployRun = restoreRedeploySpawn;
    restoreRedeploySpawn = undefined;
  }
});

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl696-tg-op-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function inbound(text) {
  return { fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text };
}

function mkCtx(ctx) {
  const root = ctx.root ?? mkRoot();
  ctx.root = root;
  ctx.posts = ctx.posts ?? [];
  ctx.replyTargets = ctx.replyTargets ?? [];
  ctx.session = ctx.session ?? createMockCursorBridgeAgentSession(root);
  if (!ctx.releasePrompt) {
    ctx.session.promptAgent = (prompt) =>
      new Promise((resolve) => {
        ctx.capturedPilotPrompt = typeof prompt === 'string' ? prompt : prompt?.text;
        pendingPromptRelease = () => resolve({ replyText: 'done', agentId: ctx.session.readAgentId() });
        ctx.releasePrompt = pendingPromptRelease;
      });
  }
  return {
    repoRoot: root,
    botToken: 'tok',
    chatId: CHAT_ID,
    state: { updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID },
    busy: ctx.busy ?? false,
    agentSession: ctx.session,
    opDir: path.join(root, '.swarmforge', 'operator'),
    post: async (_t, _c, _topic, text, replyTo) => {
      ctx.posts.push(text);
      ctx.replyTargets.push(replyTo);
    },
    persistState: () => {},
    syncAgentIdFromSession: () => {},
  };
}

async function sendCommand(ctx, text) {
  const rawDecision = decideInboundAction(inbound(text), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
  ctx.lastDecision = gateBusy(rawDecision, ctx.busy || isActiveRunInFlight());
  ctx.lastBusy = await handleInboundDecision(ctx.lastDecision, mkCtx(ctx), ctx.replyToMessageId, async () => {});
}

const GRID_REPLY = [
  'Vacances armées. Swarm arrêtée jusqu’à jeudi matin.',
  '',
  '| | |',
  '|--|--|',
  '| Off | maintenant → **jeu. 30/07 09:00** |',
  '| Prochain quart | **day shift** 09:00–17:00 |',
].join('\n');

const WIDE_GRID_REPLY = [
  '| Gate | Result | Detail |',
  '|--|--|--|',
  '| Coverage | PASS | ninety nine point one percent of statements covered |',
  '| Mutation | PASS | zero survivors on the pilot module after the rewrite |',
].join('\n');

function recordingSendMessage(ctx) {
  return async (_token, _chat, text, _replyTo, _postFn, _topic, _buttons, parseMode) => {
    ctx.sent.push({ text, parseMode });
    if (ctx.rejectHtml && parseMode === 'HTML') {
      return { success: false, error: "Telegram API 400: Bad Request: can't parse entities" };
    }
    return { success: true, messageId: ctx.sent.length };
  };
}

async function postReply(ctx, markdown) {
  ctx.sent = [];
  await postChunks('tok', CHAT_ID, CURSOR_TOPIC_ID, markdown, undefined, recordingSendMessage(ctx));
}

function sentText(ctx) {
  return ctx.sent.map((s) => s.text).join('\n');
}

function monospaceBlockLines(rendered) {
  const block = rendered.match(/<pre>([\s\S]*?)<\/pre>/);
  assert.ok(block, `no monospace block in: ${rendered}`);
  return block[1].split('\n');
}

function writeExpediteScript(root) {
  const script = path.join(root, 'swarmforge', 'scripts', 'expedite_with_progress.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  return script;
}

function writeRedeployScript(root) {
  const script = path.join(root, 'swarmforge', 'scripts', 'redeploy_cursor_bridge.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  return script;
}

function registerSteps(registry) {
  registry.defineScoped(/^the Cursor Remote Telegram topic is bound for the principal$/, (ctx) => {
    ctx.root = mkRoot();
    ctx.posts = [];
    ctx.replyTargets = [];
  }, FEATURE);

  registry.defineScoped(/^the cursor bridge handler context is ready$/, (ctx) => {
    writeExpediteScript(ctx.root);
    writeRedeployScript(ctx.root);
    const reexpedite = path.join(ctx.root, 'swarmforge', 'scripts', 'reexpedite_from_wip.sh');
    fs.mkdirSync(path.dirname(reexpedite), { recursive: true });
    fs.writeFileSync(reexpedite, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    fs.chmodSync(reexpedite, 0o755);
    if (!restoreExpediteSpawn) {
      restoreExpediteSpawn = expediteModule.startExpediteRun;
      restoreReexpediteSpawn = expediteModule.startReexpediteRun;
      restoreRedeploySpawn = redeployModule.startRedeployRun;
      const mockSpawn = () => ({ pid: process.pid, unref: () => {} });
      expediteModule.startExpediteRun = (root, ticket, spawnFn = mockSpawn) =>
        restoreExpediteSpawn(root, ticket, spawnFn);
      expediteModule.startReexpediteRun = (root, ticket, spawnFn = mockSpawn) =>
        restoreReexpediteSpawn(root, ticket, spawnFn);
      redeployModule.startRedeployRun = (root, spawnFn = mockSpawn) => restoreRedeploySpawn(root, spawnFn);
    }
  }, FEATURE);

  registry.define(/^the principal sends "([^"]+)" on the Cursor Remote topic$/, async (ctx, command) => {
    await sendCommand(ctx, command);
  });

  registry.define(/^the principal sends "\/status" on the Cursor Remote topic while busy$/, async (ctx, command) => {
    ctx.busy = true;
    await sendCommand(ctx, '/status');
    ctx.postsAfterStatus = [...ctx.posts];
  });

  registry.define(/^the principal sends "\/update" on the Cursor Remote topic while busy$/, async (ctx, command) => {
    ctx.busy = true;
    const before = ctx.posts.length;
    await sendCommand(ctx, '/update');
    ctx.posts = ctx.posts.slice(before);
  });

  registry.define(/^the bridge decision is to start expedite for ticket "([^"]+)"$/, (ctx, ticket) => {
    assert.deepEqual(ctx.lastDecision, { action: 'expedite', ticket });
  });

  registry.define(/^the bridge decision is to start pilot for ticket "([^"]+)"$/, (ctx, ticket) => {
    assert.deepEqual(ctx.lastDecision, { action: 'pilot', ticket });
  });

  registry.define(/^the bridge posts a pilot started confirmation$/, (ctx) => {
    assert.ok(ctx.posts.some((p) => /Pilot BL-\d+ started/i.test(p)));
  });

  registry.define(/^the Cursor agent is prompted as the offline expeditor for "([^"]+)"$/, async (ctx, ticket) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(
      typeof ctx.capturedPilotPrompt === 'string' && ctx.capturedPilotPrompt.includes(ticket),
      `expected pilot prompt mentioning ${ticket}`
    );
    assert.match(ctx.capturedPilotPrompt, /Do NOT spawn/);
  });

  registry.define(/^the bridge decision is to start reexpedite for ticket "([^"]+)"$/, (ctx, ticket) => {
    assert.deepEqual(ctx.lastDecision, { action: 'reexpedite', ticket });
  });

  registry.define(/^the bridge decision is to redeploy$/, (ctx) => {
    assert.deepEqual(ctx.lastDecision, { action: 'redeploy' });
  });

  registry.define(/^the bridge posts an expedite started confirmation$/, (ctx) => {
    assert.ok(ctx.posts.some((p) => /Expedite BL-696 started/i.test(p)));
  });

  registry.define(/^the bridge posts a reexpedite started confirmation$/, (ctx) => {
    assert.ok(ctx.posts.some((p) => /WIP checkpoint and restart for BL-696/i.test(p)));
  });

  registry.define(/^the bridge posts a redeploy started confirmation$/, (ctx) => {
    assert.ok(ctx.posts.some((p) => /Redeploy started/i.test(p)));
  });

  registry.define(/^an expedite operator log exists for ticket "([^"]+)"$/, (ctx, ticket) => {
    const logPath = path.join(ctx.root, '.swarmforge', 'operator', `expedite-${ticket}.log`);
    fs.writeFileSync(logPath, 'line one\nline two\n', 'utf8');
  });

  registry.define(/^the bridge posts the expedite log tail$/, (ctx) => {
    assert.ok(ctx.posts.some((p) => p.includes('line two')));
  });

  registry.define(/^expedite progress is running for ticket "([^"]+)"$/, (ctx, ticket) => {
    const progressDir = path.join(ctx.root, '.swarmforge', 'expedite', ticket);
    fs.mkdirSync(progressDir, { recursive: true });
    fs.writeFileSync(
      path.join(progressDir, 'progress.json'),
      JSON.stringify({
        ticket,
        stage: 'specifier',
        status: 'running',
        detail: 'stage 1/7',
        line: `[${ticket}] 📝 specifier — running\nstage 1/7`,
        'updated-at-ms': Date.now(),
      }),
      'utf8'
    );
    const lockPath = path.join(ctx.root, '.swarmforge', 'operator', 'expedite-bridge.lock');
    fs.writeFileSync(lockPath, `${JSON.stringify({ ticket, pid: process.pid })}\n`, 'utf8');
  });

  registry.define(/^ticket "([^"]+)" is in backlog active with role "([^"]+)"$/, (ctx, ticket, role) => {
    const dir = path.join(ctx.root, 'backlog', 'active');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ticket}-test.yaml`), `id: ${ticket}\ntitle: "Lets Talk"\nassigned_to: ${role}\n`, 'utf8');
  });

  registry.define(/^the bridge posts an update mentioning "([^"]+)"$/, (ctx, needle) => {
    assert.ok(ctx.posts.some((p) => p.includes(needle)), `expected post containing ${needle}, got: ${ctx.posts.join(' | ')}`);
  });

  registry.define(/^the bridge posts log content mentioning "([^"]+)"$/, (ctx, needle) => {
    assert.ok(ctx.posts.some((p) => p.includes(needle)));
  });

  registry.define(/^a long-running Cursor agent prompt is in flight$/, async (ctx) => {
    ctx.replyToMessageId = 99;
    ctx.busy = false;
    beginActiveRun('long task');
    const busy = await handleInboundDecision(
      { action: 'prompt', text: 'long task' },
      mkCtx(ctx),
      ctx.replyToMessageId,
      async () => {}
    );
    assert.equal(busy, true);
    ctx.posts = [];
    ctx.replyTargets = [];
    ctx.busy = true;
  });

  registry.define(/^the bridge remains busy until the agent run completes$/, async (ctx) => {
    assert.equal(ctx.lastBusy, true);
    ctx.releasePrompt?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    endActiveRun();
  });

  registry.define(/^the agent emits a tool progress line$/, async (ctx) => {
    ctx.posts = [];
    ctx.replyTargets = [];
    const { createThrottledProgressReporter } = require('../../../extension/out/bridge/cursorBridgeProgress');
    const report = createThrottledProgressReporter(
      0,
      (line) => {
        ctx.posts.push(line);
        ctx.replyTargets.push(undefined);
      },
      () => 0
    );
    await report('🔧 grep');
  });

  registry.define(/^the principal sends a Cursor agent prompt on the Cursor Remote topic$/, async (ctx) => {
    ctx.replyToMessageId = 77;
    ctx.posts = [];
    ctx.replyTargets = [];
    ctx.busy = false;
    await handleInboundDecision(
      { action: 'prompt', text: 'remember ZETA' },
      mkCtx(ctx),
      ctx.replyToMessageId,
      async () => {}
    );
  });

  registry.define(/^the progress post does not reply to the original prompt message$/, (ctx) => {
    const progressTargets = ctx.replyTargets.filter((id) => id === undefined);
    assert.ok(progressTargets.length >= 1);
    assert.equal(ctx.replyTargets.includes(77), false);
  });

  registry.define(/^an assistant stream chunk "\)\." is summarized for Telegram progress$/, (ctx) => {
    ctx.progressLine = summarizeSdkProgressLine({
      type: 'assistant',
      message: { content: [{ type: 'text', text: ').' }] },
      agent_id: 'a',
      run_id: 'r',
    });
  });

  registry.define(/^no progress line is produced$/, (ctx) => {
    assert.equal(ctx.progressLine, undefined);
  });

  registry.define(/^the principal sends another agent prompt on the Cursor Remote topic while busy$/, async (ctx) => {
    ctx.posts = [];
    await sendCommand(ctx, 'second prompt while busy');
  });

  registry.define(/^the bridge posts a busy refusal$/, (ctx) => {
    assert.ok(ctx.posts.some((p) => /Busy/i.test(p)));
    pendingPromptRelease?.();
    pendingPromptRelease = undefined;
    endActiveRun();
  });

  registry.define(/^the bridge posts a status mentioning "([^"]+)"$/, (ctx, needle) => {
    assert.ok(ctx.posts.some((p) => p.toLowerCase().includes(needle.toLowerCase())));
  });

  registry.define(/^the principal sends a photo with caption "([^"]+)" on the Cursor Remote topic$/, async (ctx, caption) => {
    mkCtx(ctx);
    ctx.releasePrompt = () => {};
    const session = ctx.session;
    session.promptAgent = async (prompt) => {
      ctx.capturedPrompt = prompt;
      return { replyText: 'photo ok', agentId: session.readAgentId() };
    };
    const media = require('../../../extension/out/bridge/cursorBridgeTelegramMedia');
    const originalDownload = media.downloadTelegramPhotoAsSdkImage;
    media.downloadTelegramPhotoAsSdkImage = async () => ({
      data: Buffer.from('jpeg-bytes').toString('base64'),
      mimeType: 'image/jpeg',
    });
    ctx.restorePhotoDownload = () => {
      media.downloadTelegramPhotoAsSdkImage = originalDownload;
    };
    ctx.posts = [];
    await handleInboundDecision(
      { action: 'prompt', text: caption, photoFileIds: ['photo-1'] },
      mkCtx(ctx),
      ctx.replyToMessageId,
      async () => {}
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  // BL-696 amendment: rendering is exercised at the real send seam
  // (postChunks + a recording sendMessage), not at the handler's post hook —
  // the handler hands markdown down, postChunks decides what Telegram gets.
  registry.define(/^Telegram rejects HTML formatted posts$/, (ctx) => {
    ctx.rejectHtml = true;
  });

  registry.define(
    /^the Cursor agent reply carrying a markdown grid is posted to Telegram$/,
    async (ctx) => {
      await postReply(ctx, GRID_REPLY);
    }
  );

  registry.define(
    /^the Cursor agent reply carrying a grid too wide for a phone is posted to Telegram$/,
    async (ctx) => {
      await postReply(ctx, WIDE_GRID_REPLY);
    }
  );

  registry.define(
    /^the Cursor agent reply carrying bold text and inline code is posted to Telegram$/,
    async (ctx) => {
      await postReply(ctx, 'Ran **compile** with `npm run compile` — green.');
    }
  );

  registry.define(/^the Telegram post renders the grid inside a monospace block$/, (ctx) => {
    const rendered = sentText(ctx);
    assert.match(rendered, /<pre>[\s\S]*Prochain quart \| day shift 09:00–17:00<\/pre>/);
    assert.match(rendered, /<pre>Off\s+\| maintenant → jeu\. 30\/07 09:00/);
    const columns = [...new Set(monospaceBlockLines(rendered).map((line) => line.indexOf('|')))];
    assert.deepEqual(columns.length, 1, `grid columns are not aligned: ${rendered}`);
  });

  registry.define(/^no Telegram post carries a raw markdown separator row$/, (ctx) => {
    assert.equal(/\|\s*:?-+:?\s*\|/.test(sentText(ctx)), false, `separator row survived: ${sentText(ctx)}`);
  });

  registry.define(/^every Telegram post is sent with HTML parse mode$/, (ctx) => {
    assert.ok(ctx.sent.length >= 1);
    assert.deepEqual([...new Set(ctx.sent.map((s) => s.parseMode))], ['HTML']);
  });

  registry.define(/^each grid row is posted as its own labelled block$/, (ctx) => {
    const rendered = sentText(ctx);
    assert.match(rendered, /<b>Coverage<\/b>\nResult: PASS\nDetail: ninety nine/);
    assert.match(rendered, /<b>Mutation<\/b>\nResult: PASS\nDetail: zero survivors/);
    assert.equal(rendered.includes('<pre>'), false);
  });

  registry.define(/^the Telegram post renders bold and inline code as HTML$/, (ctx) => {
    assert.match(sentText(ctx), /Ran <b>compile<\/b> with <code>npm run compile<\/code> — green\./);
  });

  registry.define(/^no Telegram post carries a raw emphasis marker$/, (ctx) => {
    assert.equal(/[*`]/.test(sentText(ctx)), false, `marker survived: ${sentText(ctx)}`);
  });

  registry.define(/^the reply is retried as plain text with no parse mode$/, (ctx) => {
    assert.deepEqual(
      ctx.sent.map((s) => s.parseMode),
      ['HTML', undefined]
    );
  });

  registry.define(/^the plain text retry keeps the reply content$/, (ctx) => {
    const plain = ctx.sent[ctx.sent.length - 1].text;
    assert.ok(plain.includes('Prochain quart'), `plain retry lost the grid: ${plain}`);
    assert.equal(plain.includes('<pre>'), false);
    assert.equal(plain.includes('|--|'), false);
  });

  registry.define(/^the bridge forwards the photo to the Cursor agent$/, (ctx) => {
    try {
      assert.deepEqual(ctx.capturedPrompt, {
        text: 'what is this?',
        images: [{ data: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' }],
      });
      assert.ok(ctx.posts.some((p) => /started with photo/i.test(p)));
    } finally {
      ctx.restorePhotoDownload?.();
    }
  });
}

module.exports = { registerSteps };
