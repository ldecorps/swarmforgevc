'use strict';

// BL-425 slice 1: step handlers for per-agent Telegram steering topics -
// REDIRECT mode only (provisioning + the interrupting pane inject). Drives
// the REAL pure/adapter-injected core (pollAndForward/decideSteeringAction
// via telegramFrontDeskBotCore.ts, ensureRoleTopics/readRoleTopicMap via
// telegram-front-desk-bot.ts + roleTopicMapStore.ts, real fs against a tmp
// target root) - fakes only the Telegram/network boundary (postFn) and the
// tmux pane-inject boundary (redirectToRole), the same "drive the real
// core, fake only the Telegram/network boundary" posture as
// bl410ApprovalInlineKeyboardButtonsSteps.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { ensureRoleTopics } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const { ALL_SWARM_ROLES, readRoleTopicMap, writeRoleTopicMap } = require(path.join(EXT_DIR, 'out', 'concierge', 'roleTopicMapStore'));
const { readBacklogTopicMap, writeBacklogTopicMap } = require(path.join(EXT_DIR, 'out', 'concierge', 'backlogTopicMapStore'));
const { readTopicMap } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));

const PRINCIPAL_ID = 111;
const CHAT_ID = '1';
// This ticket's own step text "the message is handled" is a generic phrase
// ALREADY owned by serialiseBlTopicContentSteps.js (BL-329), for completely
// unrelated behavior (routeEvent/postOperatorContext, not this ticket's
// pollAndForward role-steering decision) - a real collision hit while
// building this file (stepRegistry.js's resolve() matches by literal text
// across the WHOLE suite, regardless of origin file). Registered via
// defineScoped, pinned to this exact Feature: title, so it is only ever
// preferred when THIS feature is running; BL-329's own scenarios are
// completely unaffected (see stepRegistry.js/runtime.js's BL-425 changes).
const FEATURE_NAME = "a redirect message in a role's Telegram topic interrupts that role with a verified nudge";

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl425-'));
}

function telegramTopicMapPath(targetPath) {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

// telegramFrontDeskBotCore.ts's own {topicId: subjectId} map has no
// exported writer (telegram-front-desk-bot.ts's writeTopicMap is file-
// local) - written directly here, the same "write the fixture file
// directly" pattern telegramFrontDeskBotCli.test.js's own
// writeTopicMapFixture helper already uses for this exact file.
function writeTelegramTopicMapFixture(targetPath, map) {
  fs.mkdirSync(path.dirname(telegramTopicMapPath(targetPath)), { recursive: true });
  fs.writeFileSync(telegramTopicMapPath(targetPath), JSON.stringify(map));
}

function fakeCreateSequential(startId) {
  const calls = [];
  let nextId = startId;
  const postFn = async (_url, body) => {
    calls.push({ body });
    const id = nextId;
    nextId += 1;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: id, name: JSON.parse(body).name } } };
  };
  return { postFn, calls };
}

function mkUpdate(fromId, topicId, text) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// Guard-scenario adapters: every non-steering path throws if reached, since
// these scenarios assert a role-topic message NEVER falls through to the
// pre-BL-425 routing.
function guardAdapters(ctx) {
  return {
    chatId: CHAT_ID,
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a role-topic message');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a role-topic message');
    },
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    readRoleTopicMap: () => readRoleTopicMap(ctx.targetPath),
    redirectToRole: async (role, text) => {
      ctx.injected.push({ role, text });
    },
  };
}

async function deliverRedirect(ctx, fromId, topicId, text) {
  return pollAndForward(0, String(PRINCIPAL_ID), {
    ...guardAdapters(ctx),
    getUpdates: async () => ({ success: true, updates: [mkUpdate(fromId, topicId, text)] }),
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a running swarm with a Telegram forum and the authorised human$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.injected = [];
    ctx.topicIdForRole = {};
    ctx.nextTopicId = 1000;
  });

  // ── provision-role-topics-01 ─────────────────────────────────────────

  registry.define(/^the eight swarm roles$/, (ctx) => {
    ctx.roles = ALL_SWARM_ROLES;
  });

  registry.define(/^the per-agent topics are ensured$/, async (ctx) => {
    const { postFn, calls } = fakeCreateSequential(ctx.nextTopicId);
    ctx.provisionCalls = calls;
    await ensureRoleTopics(ctx.targetPath, 'fake-token', CHAT_ID, ctx.roles, postFn);
  });

  registry.define(/^each role has its own forum topic named for that role and its topic id is recorded$/, (ctx) => {
    const map = readRoleTopicMap(ctx.targetPath);
    for (const role of ctx.roles) {
      if (typeof map[role] !== 'number') {
        throw new Error(`expected role "${role}" to have a recorded numeric topic id, got ${JSON.stringify(map[role])}`);
      }
    }
    const createdNames = ctx.provisionCalls.map((c) => JSON.parse(c.body).name).sort();
    const expectedNames = [...ctx.roles].sort();
    if (JSON.stringify(createdNames) !== JSON.stringify(expectedNames)) {
      throw new Error(`expected one topic created per role, named for the role; got ${JSON.stringify(createdNames)}`);
    }
  });

  // ── redirect-interrupts-addressed-pane-02 / guard-unauthorised-sender-04 ──
  // "Given the topic for the "<role>" role exists" is IDENTICAL step text
  // shared by the Scenario Outline (redirect-interrupts-addressed-pane-02)
  // and the fixed-role scenario (guard-unauthorised-sender-04) - registered
  // once, reused by both (the same shared-Background convention documented
  // in engineering.prompt's Gherkin-step-registry note).
  registry.define(/^the topic for the "([^"]*)" role exists$/, (ctx, role) => {
    if (!ALL_SWARM_ROLES.includes(role)) {
      throw new Error(`unrecognized role fixture: ${role}`);
    }
    const topicId = ctx.nextTopicId++;
    ctx.topicIdForRole[role] = topicId;
    ctx.lastRole = role;
    const map = readRoleTopicMap(ctx.targetPath);
    map[role] = topicId;
    writeRoleTopicMap(ctx.targetPath, map);
  });

  registry.define(/^the authorised human posts a redirect message in that topic$/, async (ctx) => {
    ctx.redirectText = 'focus on the edge case first';
    ctx.deliverResult = await deliverRedirect(ctx, PRINCIPAL_ID, ctx.topicIdForRole[ctx.lastRole], ctx.redirectText);
  });

  registry.define(/^the message is injected as an interrupting verified nudge into the "([^"]*)" role's live pane$/, (ctx, role) => {
    const match = ctx.injected.find((entry) => entry.role === role && entry.text === ctx.redirectText);
    if (!match) {
      throw new Error(`expected a redirect injected into "${role}"'s pane; got ${JSON.stringify(ctx.injected)}`);
    }
  });

  // ── redirect-routing-is-exact-03 ─────────────────────────────────────

  registry.define(/^the topics for the "([^"]*)" and "([^"]*)" roles exist$/, (ctx, roleA, roleB) => {
    const map = readRoleTopicMap(ctx.targetPath);
    for (const role of [roleA, roleB]) {
      const topicId = ctx.nextTopicId++;
      ctx.topicIdForRole[role] = topicId;
      map[role] = topicId;
    }
    writeRoleTopicMap(ctx.targetPath, map);
  });

  registry.define(/^the authorised human posts a redirect message in the "([^"]*)" topic$/, async (ctx, role) => {
    ctx.redirectText = `nudge for ${role}`;
    ctx.deliverResult = await deliverRedirect(ctx, PRINCIPAL_ID, ctx.topicIdForRole[role], ctx.redirectText);
  });

  registry.define(
    /^the nudge is injected into the "([^"]*)" role's pane and the "([^"]*)" role's pane is left untouched$/,
    (ctx, targetRole, untouchedRole) => {
      const targeted = ctx.injected.filter((entry) => entry.role === targetRole);
      if (targeted.length !== 1) {
        throw new Error(`expected exactly one redirect into "${targetRole}"'s pane; got ${JSON.stringify(ctx.injected)}`);
      }
      if (ctx.injected.some((entry) => entry.role === untouchedRole)) {
        throw new Error(`expected "${untouchedRole}"'s pane to receive nothing; got ${JSON.stringify(ctx.injected)}`);
      }
    }
  );

  // ── guard-unauthorised-sender-04 ─────────────────────────────────────

  registry.define(/^an unauthorised sender posts a message in that topic$/, async (ctx) => {
    ctx.deliverResult = await deliverRedirect(ctx, 999, ctx.topicIdForRole[ctx.lastRole], 'let me steer this');
  });

  registry.define(/^no nudge is injected into any pane$/, (ctx) => {
    if (ctx.injected.length !== 0) {
      throw new Error(`expected no redirects at all; got ${JSON.stringify(ctx.injected)}`);
    }
  });

  // ── guard-non-role-topic-05 ──────────────────────────────────────────

  registry.define(/^the authorised human posts a message in an ordinary "([^"]*)" topic$/, (ctx, topicKind) => {
    ctx.topicKind = topicKind;
    ctx.nonRoleTopicId = ctx.nextTopicId++;
    ctx.nonRoleText = 'an ordinary reply';
    if (topicKind === 'BL-ticket') {
      const map = readBacklogTopicMap(ctx.targetPath);
      map['BL-999'] = ctx.nonRoleTopicId;
      writeBacklogTopicMap(ctx.targetPath, map);
    } else if (topicKind === 'Operator') {
      writeTelegramTopicMapFixture(ctx.targetPath, { [String(ctx.nonRoleTopicId)]: 'OPERATOR' });
    } else {
      throw new Error(`unrecognized topic-kind fixture: ${topicKind}`);
    }
  });

  registry.defineScoped(
    /^the message is handled$/,
    async (ctx) => {
      ctx.posted = [];
      ctx.contexts = [];
      ctx.deliverResult = await pollAndForward(0, String(PRINCIPAL_ID), {
        chatId: CHAT_ID,
        getUpdates: async () => ({ success: true, updates: [mkUpdate(PRINCIPAL_ID, ctx.nonRoleTopicId, ctx.nonRoleText)] }),
        postToBridge: async (subjectId, text) => {
          ctx.posted.push({ subjectId, text });
          return true;
        },
        openSubjectAndRecord: async () => {
          throw new Error('openSubjectAndRecord should not be called - this topic is already mapped');
        },
        subjectForTopic: (topicId) => readTopicMap(ctx.targetPath)[String(topicId)] ?? undefined,
        backlogForTopic: (topicId) => {
          const map = readBacklogTopicMap(ctx.targetPath);
          const found = Object.entries(map).find(([, tid]) => tid === topicId);
          return found ? found[0] : undefined;
        },
        postOperatorContext: async (backlogId, text) => {
          ctx.contexts.push({ backlogId, text });
          return true;
        },
        readRoleTopicMap: () => readRoleTopicMap(ctx.targetPath),
        redirectToRole: async (role, text) => {
          ctx.injected.push({ role, text });
        },
      });
    },
    FEATURE_NAME
  );

  registry.define(/^no nudge is injected into any pane and that topic keeps its existing behavior$/, (ctx) => {
    if (ctx.injected.length !== 0) {
      throw new Error(`expected no redirects at all for a non-role topic; got ${JSON.stringify(ctx.injected)}`);
    }
    if (ctx.topicKind === 'BL-ticket') {
      if (!ctx.contexts.some((c) => c.backlogId === 'BL-999' && c.text === ctx.nonRoleText)) {
        throw new Error(`expected the BL-ticket topic's existing operator-context routing to still fire; got ${JSON.stringify(ctx.contexts)}`);
      }
    } else if (ctx.topicKind === 'Operator') {
      if (!ctx.posted.some((p) => p.subjectId === 'OPERATOR' && p.text === ctx.nonRoleText)) {
        throw new Error(`expected the Operator topic's existing postToBridge routing to still fire; got ${JSON.stringify(ctx.posted)}`);
      }
    } else {
      throw new Error(`unrecognized topic-kind fixture: ${ctx.topicKind}`);
    }
  });
}

module.exports = { registerSteps };
