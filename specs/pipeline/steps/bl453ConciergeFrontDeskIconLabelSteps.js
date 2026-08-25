'use strict';

// BL-453: step handlers for "The front-desk standing topic is rebranded
// Concierge with the bell icon". Drives the REAL compiled ensureOperatorTopic
// (telegram-front-desk-bot.ts, the title-rename half) and the REAL
// backfillStandingTopicIcons (the icon half - the same one-time maintenance
// pass BL-342/BL-418 already established) against real fs fixtures, no live
// Telegram/network - only postFn is faked, mirroring
// telegramFrontDeskBotCli.test.js's own convention exactly.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { ensureOperatorTopic, readTopicMap: readTopicMapReal } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const { backfillStandingTopicIcons } = require(path.join(EXT_DIR, 'out', 'tools', 'backfill-standing-topic-icons'));
const { readSwarmIconId } = require(path.join(EXT_DIR, 'out', 'concierge', 'blTopicStore'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-concierge-icon-'));
}

function writeTopicMap(root, map) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-topic-map.json'), JSON.stringify(map));
}

function readStandingTopicTitles(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json'), 'utf8'));
  } catch {
    return {};
  }
}

const STICKERS_JSON = {
  ok: true,
  result: [
    { emoji: '🎟', custom_emoji_id: 'id-ticket' },
    { emoji: '🛎', custom_emoji_id: 'id-bell' },
  ],
};

function fakePostFn(calls) {
  return async (url, body) => {
    calls.push({ url, body });
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: STICKERS_JSON };
    }
    if (url.endsWith('/createForumTopic')) {
      return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 701 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: {} } };
  };
}

function registerSteps(registry) {
  registry.define(/^the front-desk standing topic$/, (ctx) => {
    ctx.root = mkTmp();
  });

  registry.define(/^the front-desk standing topic is already bound$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.boundTopicId = 701;
    writeTopicMap(ctx.root, { [ctx.boundTopicId]: 'OPERATOR' });
  });

  // ── concierge-icon-01 ─────────────────────────────────────────────────
  registry.define(/^its standing-topic icon is synced$/, async (ctx) => {
    writeTopicMap(ctx.root, { 701: 'OPERATOR' });
    ctx.calls = [];
    ctx.iconOutcomes = await backfillStandingTopicIcons(ctx.root, 'fake-token', 'fake-chat', async () => {}, fakePostFn(ctx.calls));
  });

  registry.define(/^its icon is the bell$/, (ctx) => {
    if (readSwarmIconId(ctx.root, 'OPERATOR') !== 'id-bell') {
      throw new Error(`expected the Operator topic's icon recorded as the bell sticker, got: ${readSwarmIconId(ctx.root, 'OPERATOR')}`);
    }
    const edit = ctx.calls.find((c) => c.url.endsWith('/editForumTopic') && JSON.parse(c.body).icon_custom_emoji_id);
    if (!edit || JSON.parse(edit.body).icon_custom_emoji_id !== 'id-bell') {
      throw new Error(`expected an editForumTopic call setting the bell sticker, got: ${JSON.stringify(ctx.calls)}`);
    }
  });

  // ── concierge-icon-02 ─────────────────────────────────────────────────
  registry.define(/^its topic title is applied$/, async (ctx) => {
    ctx.calls = [];
    ctx.topicId = await ensureOperatorTopic(ctx.root, 'fake-token', 'fake-chat', fakePostFn(ctx.calls));
  });

  registry.define(/^its title is "([^"]+)"$/, (ctx, expectedTitle) => {
    const createCall = ctx.calls.find((c) => c.url.endsWith('/createForumTopic'));
    const renameCall = ctx.calls.find((c) => c.url.endsWith('/editForumTopic'));
    const appliedTitle = createCall ? JSON.parse(createCall.body).name : renameCall ? JSON.parse(renameCall.body).name : undefined;
    if (appliedTitle !== expectedTitle) {
      throw new Error(`expected the applied title to be "${expectedTitle}", got: ${appliedTitle} (calls: ${JSON.stringify(ctx.calls)})`);
    }
  });

  // ── concierge-icon-03 ─────────────────────────────────────────────────
  registry.define(/^its title and icon are updated to the Concierge rebrand$/, async (ctx) => {
    ctx.calls = [];
    ctx.topicId = await ensureOperatorTopic(ctx.root, 'fake-token', 'fake-chat', fakePostFn(ctx.calls));
    ctx.iconOutcomes = await backfillStandingTopicIcons(ctx.root, 'fake-token', 'fake-chat', async () => {}, fakePostFn(ctx.calls));
  });

  registry.define(/^the same topic is reused$/, (ctx) => {
    const createCall = ctx.calls.find((c) => c.url.endsWith('/createForumTopic'));
    if (createCall) {
      throw new Error(`expected the existing bound topic to be reused, never re-created, got a create call: ${JSON.stringify(createCall)}`);
    }
    if (ctx.topicId !== ctx.boundTopicId) {
      throw new Error(`expected the resolved topicId to be the pre-existing bound one (${ctx.boundTopicId}), got: ${ctx.topicId}`);
    }
  });

  registry.define(/^its durable binding id is unchanged$/, (ctx) => {
    const map = readTopicMapReal(ctx.root);
    if (map[String(ctx.boundTopicId)] !== 'OPERATOR') {
      throw new Error(`expected the durable OPERATOR binding to still be keyed to topic ${ctx.boundTopicId}, got: ${JSON.stringify(map)}`);
    }
    const titles = readStandingTopicTitles(ctx.root);
    if (titles.OPERATOR !== 'Concierge') {
      throw new Error(`expected the rename to have actually applied, got: ${JSON.stringify(titles)}`);
    }
  });
}

module.exports = { registerSteps };
