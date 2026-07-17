'use strict';

// BL-492: step handlers for "A standing Backlog catch-all topic is ensured
// once at boot for epic-less tickets". Drives the REAL compiled
// ensureBacklogTopic (telegram-front-desk-bot.ts) against a real fs
// fixture and a fake Telegram postFn - never a hand-rolled reimplementation
// of the reuse-or-create decision, mirroring the sibling ensure*Topic
// acceptance conventions (e.g. bl450RecertStandingTopicSteps.js) for this
// codebase's standing-topic machinery.

const fs = require('node:fs');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { mkTmpDir } = require(path.join(EXT_DIR, 'test', 'helpers', 'tmpDir'));
const { ensureBacklogTopic } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));

const OTHER_STANDING_TOPICS = {
  '10': 'OPERATOR',
  '11': 'APPROVALS',
  '12': 'RECERT',
  '13': 'AGENT_QUESTIONS',
  '14': 'CONTROL',
  '15': 'STEERING:coder',
  '16': 'STEERING:cleaner',
};

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function readTopicMap(root) {
  try {
    return JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
  } catch {
    return {};
  }
}

function writeTopicMap(root, map) {
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify(map));
}

function registerSteps(registry) {
  // ── Background / When (SAME literal text, two distinct roles) ─────────
  // As Background (ctx.root not yet set), this ONLY establishes the fixture
  // skeleton - no real ensureBacklogTopic call yet, since the scenario's
  // own Given below (which always runs AFTER this Background step but
  // BEFORE the scenario's textually-identical When) is what arranges the
  // concrete precondition (no topic yet / already recorded / other standing
  // topics present) this handler's REAL invocation, on the scenario's own
  // When, needs to observe.
  registry.define(/^the front desk ensures its standing topics at boot$/, async (ctx) => {
    if (!ctx.root) {
      ctx.root = mkTmpDir('sfvc-bl492-');
      ctx.calls = [];
      return;
    }
    const postFn = async (url, body) => {
      ctx.calls.push({ url, body });
      ctx.nextThreadId = (ctx.nextThreadId || 900) + 1;
      return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: ctx.nextThreadId, name: 'Backlog' } } };
    };
    ctx.lastEnsuredTopicId = await ensureBacklogTopic(ctx.root, 'fake-token', 'fake-chat', postFn);
  });

  // ── backlog-standing-topic-01 ────────────────────────────────────────
  registry.define(/^no topic is yet recorded for the reserved Backlog subject$/, (ctx) => {
    // The Background step above already left ctx.root with an empty
    // topic map - true by construction, nothing further to arrange.
    if (Object.values(readTopicMap(ctx.root)).includes('BACKLOG')) {
      throw new Error('fixture bug: expected no BACKLOG binding yet');
    }
  });

  registry.define(/^a Backlog topic is created$/, (ctx) => {
    if (ctx.calls.length !== 1) {
      throw new Error(`expected exactly one createForumTopic call, got: ${JSON.stringify(ctx.calls)}`);
    }
    if (!/"name":"Backlog"/.test(ctx.calls[0].body)) {
      throw new Error(`expected the create call to name the topic "Backlog", got: ${ctx.calls[0].body}`);
    }
  });

  registry.define(/^its id is recorded under the reserved Backlog subject$/, (ctx) => {
    const map = readTopicMap(ctx.root);
    if (map[String(ctx.lastEnsuredTopicId)] !== 'BACKLOG') {
      throw new Error(`expected topic id ${ctx.lastEnsuredTopicId} bound to BACKLOG, got: ${JSON.stringify(map)}`);
    }
  });

  // ── backlog-standing-topic-02 ────────────────────────────────────────
  registry.define(/^a topic id is already recorded for the reserved Backlog subject$/, (ctx) => {
    ctx.existingTopicId = 42;
    writeTopicMap(ctx.root, { [String(ctx.existingTopicId)]: 'BACKLOG' });
    ctx.calls = []; // measure only the upcoming (scenario's own) invocation
  });

  registry.define(/^the recorded Backlog topic id is reused$/, (ctx) => {
    if (ctx.lastEnsuredTopicId !== ctx.existingTopicId) {
      throw new Error(`expected the existing topic id ${ctx.existingTopicId} reused, got: ${ctx.lastEnsuredTopicId}`);
    }
  });

  registry.define(/^no new Backlog topic is created$/, (ctx) => {
    if (ctx.calls.length !== 0) {
      throw new Error(`expected no createForumTopic call, got: ${JSON.stringify(ctx.calls)}`);
    }
  });

  // ── backlog-standing-topic-03 ────────────────────────────────────────
  registry.define(/^the per-role STEERING topics and other standing topics already exist$/, (ctx) => {
    writeTopicMap(ctx.root, { ...OTHER_STANDING_TOPICS });
    ctx.calls = [];
  });

  registry.define(/^the existing STEERING and other standing topics are unchanged$/, (ctx) => {
    const map = readTopicMap(ctx.root);
    for (const [topicId, subjectId] of Object.entries(OTHER_STANDING_TOPICS)) {
      if (map[topicId] !== subjectId) {
        throw new Error(`expected ${topicId} still bound to ${subjectId}, got: ${JSON.stringify(map)}`);
      }
    }
  });
}

module.exports = { registerSteps };
