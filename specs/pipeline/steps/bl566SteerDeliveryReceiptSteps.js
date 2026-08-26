'use strict';

// BL-566: step handlers for the role-steering delivery receipt. Drives the
// REAL pure/adapter-injected core (pollAndForward -> decideSteeringAction ->
// processSteeringUpdate -> formatSteerReceipt via
// telegramFrontDeskBotCore.ts, real fs role-topic map via
// roleTopicMapStore.ts against a tmp target root) and fakes ONLY the two
// boundaries this slice is not about: the tmux pane inject (redirectToRole,
// whose RESULT is the input under test) and the Telegram send
// (notifyRoleTopic, whose ARGUMENTS are the output under test) - the same
// "drive the real core, fake only the network/pane boundary" posture
// bl425RoleSteeringTopicsSteps.js already uses for this feature area.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { ALL_SWARM_ROLES, readRoleTopicMap, writeRoleTopicMap } = require(path.join(EXT_DIR, 'out', 'concierge', 'roleTopicMapStore'));

const PRINCIPAL_ID = 111;
const CHAT_ID = '1';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl566-'));
}

function mkUpdate(fromId, topicId, text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// Binds role -> topic id in the REAL role-topic map on disk, so the step
// exercises readRoleTopicMap/roleForTopic rather than a hand-built map.
function bindRoleTopic(ctx, role) {
  if (!ALL_SWARM_ROLES.includes(role)) {
    throw new Error(`unrecognized role fixture: ${role}`);
  }
  const topicId = ctx.nextTopicId++;
  ctx.topicIdForRole[role] = topicId;
  const map = readRoleTopicMap(ctx.targetPath);
  map[role] = topicId;
  writeRoleTopicMap(ctx.targetPath, map);
  return topicId;
}

// Every non-steering path throws: these scenarios assert a role-topic
// message never falls through to the pre-BL-425 routing, exactly as
// bl425RoleSteeringTopicsSteps.js's own guardAdapters does.
function adaptersFor(ctx) {
  const adapters = {
    chatId: CHAT_ID,
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a role-topic steer');
    },
    openSubjectAndRecord: async (topicId, text) => {
      ctx.opened.push({ topicId, text });
      return 'SUP-999';
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    readRoleTopicMap: () => readRoleTopicMap(ctx.targetPath),
    redirectToRole: async (role, text) => {
      ctx.injected.push({ role, text });
      return ctx.steerOutcome;
    },
  };
  if (ctx.receiptsWired) {
    adapters.notifyRoleTopic = async (topicId, text) => {
      ctx.receipts.push({ topicId, text });
      return true;
    };
  }
  return adapters;
}

async function deliver(ctx, fromId, topicId, text) {
  return pollAndForward(0, String(PRINCIPAL_ID), {
    ...adaptersFor(ctx),
    getUpdates: async () => ({ success: true, updates: [mkUpdate(fromId, topicId, text)] }),
  });
}

function soleReceiptFor(ctx, role) {
  const topicId = ctx.topicIdForRole[role];
  if (ctx.receipts.length !== 1) {
    throw new Error(`expected exactly one receipt; got ${JSON.stringify(ctx.receipts)}`);
  }
  const receipt = ctx.receipts[0];
  if (receipt.topicId !== topicId) {
    throw new Error(`expected the receipt in the "${role}" topic (${topicId}); got topic ${receipt.topicId}`);
  }
  return receipt.text;
}

function registerSteps(registry) {
  registry.define(/^a live swarm whose role steering topics are already bound$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.injected = [];
    ctx.receipts = [];
    ctx.opened = [];
    ctx.topicIdForRole = {};
    ctx.nextTopicId = 1600;
    ctx.receiptsWired = true;
    ctx.steerOutcome = { kind: 'delivered' };
  });

  registry.define(/^the "([^"]*)" role has a live pane$/, (ctx, role) => {
    bindRoleTopic(ctx, role);
    ctx.steerOutcome = { kind: 'delivered' };
  });

  registry.define(/^the "([^"]*)" role has no live pane$/, (ctx, role) => {
    bindRoleTopic(ctx, role);
    ctx.steerOutcome = { kind: 'no-pane' };
  });

  registry.define(/^the "([^"]*)" role has a live pane that rejects the nudge with "([^"]*)"$/, (ctx, role, reason) => {
    bindRoleTopic(ctx, role);
    ctx.steerOutcome = { kind: 'undelivered', reason };
  });

  registry.define(/^the receipt channel is not wired$/, (ctx) => {
    ctx.receiptsWired = false;
  });

  registry.define(/^the authorised human steers "([^"]*)" with "([^"]*)"$/, async (ctx, role, text) => {
    ctx.steerText = text;
    ctx.steeredRole = role;
    await deliver(ctx, PRINCIPAL_ID, ctx.topicIdForRole[role], text);
  });

  registry.define(/^an unauthorised sender posts "([^"]*)" in the "([^"]*)" topic$/, async (ctx, text, role) => {
    await deliver(ctx, 999, ctx.topicIdForRole[role], text);
  });

  registry.define(/^the authorised human posts "([^"]*)" in a topic bound to no role$/, async (ctx, text) => {
    await deliver(ctx, PRINCIPAL_ID, 4242, text);
  });

  registry.define(/^the receipt posted into the "([^"]*)" topic confirms the steer was delivered$/, (ctx, role) => {
    const text = soleReceiptFor(ctx, role);
    if (!text.includes('steered') || !text.includes(role)) {
      throw new Error(`expected a delivered-steer confirmation naming "${role}"; got ${JSON.stringify(text)}`);
    }
    if (text.includes('not delivered')) {
      throw new Error(`a delivered steer must not report a failure; got ${JSON.stringify(text)}`);
    }
  });

  registry.define(/^the receipt posted into the "([^"]*)" topic says that role has no live pane$/, (ctx, role) => {
    const text = soleReceiptFor(ctx, role);
    if (!text.includes('no live pane') || !text.includes(role)) {
      throw new Error(`expected a no-live-pane receipt naming "${role}"; got ${JSON.stringify(text)}`);
    }
  });

  registry.define(/^the receipt posted into the "([^"]*)" topic reports the failure reason "([^"]*)"$/, (ctx, role, reason) => {
    const text = soleReceiptFor(ctx, role);
    if (!text.includes(reason) || !text.includes(role)) {
      throw new Error(`expected a failure receipt naming "${role}" and reason "${reason}"; got ${JSON.stringify(text)}`);
    }
    if (text.includes('no live pane')) {
      throw new Error(`a send failure must not be reported as a missing pane; got ${JSON.stringify(text)}`);
    }
  });

  registry.define(/^the receipt posted into the "([^"]*)" topic names the role "([^"]*)"$/, (ctx, topicRole, namedRole) => {
    const text = soleReceiptFor(ctx, topicRole);
    if (!text.includes(namedRole)) {
      throw new Error(`expected the receipt to name the role "${namedRole}"; got ${JSON.stringify(text)}`);
    }
  });

  registry.define(/^no steer is attempted and no receipt is posted anywhere$/, (ctx) => {
    if (ctx.injected.length !== 0) {
      throw new Error(`expected no steer at all; got ${JSON.stringify(ctx.injected)}`);
    }
    if (ctx.receipts.length !== 0) {
      throw new Error(`expected no receipt at all; got ${JSON.stringify(ctx.receipts)}`);
    }
  });

  registry.define(/^the steer still reaches the "([^"]*)" pane and no receipt is posted anywhere$/, (ctx, role) => {
    const match = ctx.injected.find((entry) => entry.role === role && entry.text === ctx.steerText);
    if (!match) {
      throw new Error(`expected the steer to still reach "${role}"; got ${JSON.stringify(ctx.injected)}`);
    }
    if (ctx.receipts.length !== 0) {
      throw new Error(`expected no receipt when the channel is unwired; got ${JSON.stringify(ctx.receipts)}`);
    }
  });
}

module.exports = { registerSteps };
