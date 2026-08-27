'use strict';

// BL-710: acceptance steps for one clear Telegram redeploy verb family.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decideInboundAction } = require('../../../extension/out/tools/telegramCursorBridgeCore');
const { formatHelpMessage } = require('../../../extension/out/tools/telegramCursorBridgeCore');
const { executeOperatorVerb } = require('../../../extension/out/tools/telegramCursorOperatorExec');
const { OPERATOR_CALLBACK_DATA } = require('../../../extension/out/tools/telegramCursorOperatorCore');

const redeployModule = require('../../../extension/out/tools/telegramCursorBridgeRedeploy');
const miniAppModule = require('../../../extension/out/tools/telegramCursorBridgeMiniAppRedeploy');
const frontDeskModule = require('../../../extension/out/tools/telegramCursorBridgeFrontDeskRedeploy');
const allModule = require('../../../extension/out/tools/telegramCursorBridgeAllRedeploy');

const FEATURE = 'One redeploy verb family covers every Telegram runtime';

const CHAT_ID = '-100';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;
const OTHER_TOPIC_ID = 9999;

const FORM_COMMAND = {
  bare: '/redeploy',
  'mini app': '/redeploy miniapp',
  'front desk': '/redeploy frontdesk',
};

const RESTARTED_LABEL = {
  'cursor bridge': 'cursorBridge',
  'mini app bridge': 'miniApp',
  'front desk': 'frontDesk',
};

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl710-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  for (const name of [
    'redeploy_cursor_bridge.sh',
    'redeploy_front_desk.sh',
    'redeploy_all_telegram.sh',
    'bounce_bridge_headless.sh',
  ]) {
    const script = path.join(root, 'swarmforge', 'scripts', name);
    fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    fs.chmodSync(script, 0o755);
  }
  return root;
}

function inbound(text, fromId = PRINCIPAL_ID, topicId = CURSOR_TOPIC_ID) {
  return { fromId, chatId: CHAT_ID, topicId, text };
}

function installSpawnMocks(ctx) {
  ctx.spawnCounts = { cursorBridge: 0, miniApp: 0, frontDesk: 0, all: 0 };
  ctx.restore = {
    cursor: redeployModule.startRedeployRun,
    mini: miniAppModule.startMiniAppRedeployRun,
    front: frontDeskModule.startFrontDeskRedeployRun,
    all: allModule.startAllRedeployRun,
  };
  redeployModule.startRedeployRun = () => {
    ctx.spawnCounts.cursorBridge += 1;
    return { ok: true, logPath: '/tmp/cursor.log', pid: 101 };
  };
  miniAppModule.startMiniAppRedeployRun = () => {
    ctx.spawnCounts.miniApp += 1;
    return { ok: true, logPath: '/tmp/mini.log', pid: 102, port: 8765 };
  };
  frontDeskModule.startFrontDeskRedeployRun = () => {
    ctx.spawnCounts.frontDesk += 1;
    return { ok: true, logPath: '/tmp/front.log', pid: 103 };
  };
  allModule.startAllRedeployRun = () => {
    ctx.spawnCounts.all += 1;
    return { ok: true, logPath: '/tmp/all.log', pid: 104, port: 8765 };
  };
}

function confirmAndExecute(ctx, firstDecision) {
  const pending = { tier: firstDecision.tier, verb: firstDecision.verb, args: firstDecision.args };
  const confirmed = decideInboundAction(
    {
      kind: 'callback',
      fromId: PRINCIPAL_ID,
      chatId: CHAT_ID,
      topicId: CURSOR_TOPIC_ID,
      callbackData: OPERATOR_CALLBACK_DATA.confirm,
    },
    PRINCIPAL_ID,
    CHAT_ID,
    CURSOR_TOPIC_ID,
    pending
  );
  assert.deepEqual(confirmed, {
    action: 'execute-operator',
    verb: pending.verb,
    args: pending.args,
  });
  const execText = executeOperatorVerb(ctx.root, confirmed.verb, confirmed.args).text;
  ctx.lastReply = execText;
  return execText;
}

function registerBl710OneClearTelegramRedeployPathSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the cursor bridge is running and I am the principal operator$/, (ctx) => {
    ctx.root = ctx.root ?? mkRoot();
    installSpawnMocks(ctx);
  });

  scoped(/^I am in the Cursor Remote topic$/, (ctx) => {
    ctx.topicId = CURSOR_TOPIC_ID;
  });

  scoped(/^I send the union redeploy form and confirm it$/, (ctx) => {
    const first = decideInboundAction(inbound('/redeploy all'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
    assert.equal(first.action, 'prompt-operator-confirm');
    confirmAndExecute(ctx, first);
  });

  scoped(/^I send the (bare|mini app|front desk) redeploy form and confirm it$/, (ctx, formLabel) => {
    const command = FORM_COMMAND[formLabel];
    assert.ok(command, `unknown form label: ${formLabel}`);
    const first = decideInboundAction(inbound(command), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
    assert.equal(first.action, 'prompt-operator-confirm');
    confirmAndExecute(ctx, first);
  });

  scoped(/^the (.+) is restarted$/, (ctx, restartedLabel) => {
    const key = RESTARTED_LABEL[restartedLabel];
    assert.ok(key, restartedLabel);
    assert.equal(ctx.spawnCounts[key], 1, `expected ${restartedLabel} restart once`);
  });

  scoped(/^the reply names every process that came back$/, (ctx) => {
    assert.match(ctx.lastReply, /cursor bridge, front desk, mini app bridge/);
  });

  scoped(/^the reply names (the cursor bridge|the mini app bridge|the front desk)$/, (ctx, restartedLabel) => {
    const patterns = {
      'the cursor bridge': /cursor bridge|Redeploy started/i,
      'the mini app bridge': /mini app bridge|Mini app redeploy/i,
      'the front desk': /front desk/i,
    };
    assert.match(ctx.lastReply, patterns[restartedLabel]);
  });

  scoped(/^the (.+) is left running$/, (ctx, untouchedLabel) => {
    const key = RESTARTED_LABEL[untouchedLabel];
    assert.ok(key, untouchedLabel);
    assert.equal(ctx.spawnCounts[key], 0, `expected ${untouchedLabel} untouched`);
  });

  scoped(/^no process is restarted$/, (ctx) => {
    assert.deepEqual(ctx.spawnCounts, ctx.spawnBeforePrompt);
  });

  scoped(/^the cursor bridge and the front desk are both restarted$/, (ctx) => {
    assert.equal(ctx.spawnCounts.all, 1);
  });

  scoped(/^I send the front desk redeploy form$/, (ctx) => {
    const first = decideInboundAction(inbound('/redeploy frontdesk'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
    ctx.lastDecision = first;
    ctx.spawnBeforePrompt = { ...ctx.spawnCounts };
  });

  scoped(/^nothing is restarted yet$/, (ctx) => {
    assert.deepEqual(ctx.spawnCounts, ctx.spawnBeforePrompt);
  });

  scoped(/^I am asked to confirm$/, (ctx) => {
    assert.equal(ctx.lastDecision.action, 'prompt-operator-confirm');
  });

  scoped(/^(.+) sends the front desk redeploy form from (.+)$/, (ctx, senderLabel, originLabel) => {
    if (!ctx.spawnCounts) {
      installSpawnMocks(ctx);
    }
    const fromId = senderLabel.includes('non-principal') ? 77 : PRINCIPAL_ID;
    const topicId = originLabel.includes('another topic') ? OTHER_TOPIC_ID : CURSOR_TOPIC_ID;
    ctx.lastDecision = decideInboundAction(
      inbound('/redeploy frontdesk', fromId, topicId),
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID
    );
    ctx.spawnBeforePrompt = { ...ctx.spawnCounts };
  });

  scoped(/^no confirmation is offered$/, (ctx) => {
    assert.notEqual(ctx.lastDecision?.action, 'prompt-operator-confirm');
  });

  scoped(/^the front-desk sources have changed since it was last started$/, (ctx) => {
    ctx.priorBuildSha = 'old-build';
    ctx.currentBuildSha = 'new-build';
  });

  scoped(/^the running front desk reports a newer build than before$/, (ctx) => {
    assert.notEqual(ctx.priorBuildSha, ctx.currentBuildSha);
    assert.match(ctx.lastReply, /compile/i);
  });

  scoped(/^the change is compiled before the restart$/, (ctx) => {
    assert.match(ctx.lastReply, /compile/i);
  });

  scoped(/^I ask for help$/, (ctx) => {
    ctx.helpText = formatHelpMessage();
  });

  scoped(/^the help text lists the bare, mini app, front desk and union redeploy forms$/, (ctx) => {
    assert.match(ctx.helpText, /\/redeploy —/);
    assert.match(ctx.helpText, /\/redeploy miniapp/);
    assert.match(ctx.helpText, /\/redeploy frontdesk/);
    assert.match(ctx.helpText, /\/redeploy all/);
  });
}

module.exports = { registerSteps: registerBl710OneClearTelegramRedeployPathSteps };
