'use strict';

// BL-725: step handlers for "The standing host-agent Telegram topic is
// named Host". Drives the REAL extension/out/tools code - never a
// reimplementation of the rename or the ensure/reuse logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out', 'tools');
const core = require(path.join(EXT_OUT, 'telegramCursorBridgeCore.js'));
const live = require(path.join(EXT_OUT, 'telegramCursorBridgeLive.js'));
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'The standing host-agent Telegram topic is named Host';

const FIELD_GETTERS = {
  'topic name': () => core.CURSOR_BRIDGE_TOPIC_NAME,
  'subject id': () => core.CURSOR_BRIDGE_SUBJECT_ID,
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the cursor bridge topic constants are loaded$/, (ctx) => {
    ctx.root = ctx.root || mkSocketFixtureRoot('bl725-');
  });

  scoped(/^the standing host-agent (topic name|subject id) is read$/, (ctx, field) => {
    ctx.fieldValue = FIELD_GETTERS[field]();
  });

  scoped(/^its value is (?!not )(.+)$/, (ctx, expected) => {
    assert.equal(ctx.fieldValue, expected);
  });

  scoped(/^its value is not Cursor Remote$/, (ctx) => {
    assert.notEqual(ctx.fieldValue, 'Cursor Remote');
  });

  scoped(/^a Telegram group with no bound host-agent topic$/, (ctx) => {
    ctx.root = ctx.root || mkSocketFixtureRoot('bl725-');
    ctx.topicMapPath = path.join(ctx.root, 'topic-map.json');
    fs.writeFileSync(ctx.topicMapPath, '{}', 'utf8');
  });

  scoped(/^a Telegram group whose topic map binds thread (\d+) to subject CURSOR_REMOTE$/, (ctx, threadId) => {
    ctx.root = ctx.root || mkSocketFixtureRoot('bl725-');
    ctx.topicMapPath = path.join(ctx.root, 'topic-map.json');
    fs.writeFileSync(ctx.topicMapPath, JSON.stringify({ [threadId]: 'CURSOR_REMOTE' }), 'utf8');
    ctx.boundThreadId = Number(threadId);
  });

  scoped(/^the bridge ensures its host-agent topic$/, async (ctx) => {
    ctx.createCalls = [];
    const stubCreateTopic = async (_token, _chatId, name) => {
      ctx.createCalls.push({ name });
      return { success: true, messageThreadId: 999 };
    };
    ctx.resultState = await live.ensureCursorTopic('fake-token', 'fake-chat', ctx.topicMapPath, { updateOffset: 0 }, stubCreateTopic);
  });

  scoped(/^it creates one forum topic titled Host$/, (ctx) => {
    assert.equal(ctx.createCalls.length, 1, `expected exactly one create call, got ${JSON.stringify(ctx.createCalls)}`);
    assert.equal(ctx.createCalls[0].name, 'Host');
  });

  scoped(/^it reuses thread (\d+)$/, (ctx, threadId) => {
    assert.equal(ctx.resultState.cursorTopicId, Number(threadId));
  });

  scoped(/^it creates no forum topic$/, (ctx) => {
    assert.deepEqual(ctx.createCalls, []);
  });

  // Each source read directly off the live artifact the operator-facing
  // string literal actually ships in - the same three verified sites the
  // ticket names, and the same string this ticket's own coder pass edited.
  // never/positive checks scoped to the LITERAL that site emits, so this
  // step cannot pass by accident on some OTHER unrelated "Host"/"Cursor
  // Remote" substring elsewhere in a large source file.
  const OPERATOR_TEXT_SOURCES = {
    'the pilot status prompt': {
      file: 'telegramCursorBridgePilot.ts',
      positive: /mandatory on Host|poll on the Host topic|kill the Host bridge/,
      negative: /mandatory on Cursor Remote|poll on the Cursor Remote topic|kill the host Cursor Remote/,
    },
    'the unknown-verb reply': {
      file: 'telegramCursorOperatorExec.ts',
      positive: /no Host execute handler yet/,
      negative: /no Cursor Remote execute handler/,
    },
    'the topic-ownership error': {
      file: 'telegram-front-desk-bot.ts',
      positive: /Host topic is owned by/,
      negative: /Cursor Remote topic is owned by/,
    },
  };

  scoped(/^the operator-facing text (.+) is read$/, (ctx, source) => {
    const spec = OPERATOR_TEXT_SOURCES[source];
    assert.ok(spec, `unknown <source> example value: ${source}`);
    ctx.textSpec = spec;
    ctx.text = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'src', 'tools', spec.file), 'utf8');
  });

  scoped(/^it names the topic Host$/, (ctx) => {
    assert.match(ctx.text, ctx.textSpec.positive);
  });

  scoped(/^it does not name the topic Cursor Remote$/, (ctx) => {
    assert.doesNotMatch(ctx.text, ctx.textSpec.negative);
  });

  scoped(/^the host-agent flow diagram is read$/, (ctx) => {
    ctx.text = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'diagrams', 'cursor-remote-flow.mmd'), 'utf8');
    ctx.textSpec = { positive: /Host/ };
  });
}

module.exports = { registerSteps };
