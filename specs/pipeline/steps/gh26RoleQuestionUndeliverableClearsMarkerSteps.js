'use strict';

// GH-26: step handlers for "an undeliverable role question never leaves the
// asking role wedged". Drives the REAL relay (relaySseReplies,
// telegramFrontDeskBotCore.ts), the REAL role-awaiting marker functions
// (roleTopicIdFor/markRoleQuestionUndeliverable/readRoleAwaitingAnswer/
// roleAwaitingAnswerPath, telegram-front-desk-bot.ts) against a real fs
// fixture, the REAL role_ask.bb CLI (mirrors bl773CoordinatorRoleAskSteps.js's
// own runRoleAsk), and the REAL operator_runtime.bb --tick-once for the
// status.json surfacing scenario (mirrors operatorAutoHibernateSteps.js's
// own tickOnce - operator_runtime.bb load-files its own sibling scripts by
// its own file location, never the fixture root, so no sandbox copy is
// needed here). Only the Telegram network boundary (sendReply) is faked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { relaySseReplies } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));
const {
  roleTopicIdFor,
  markRoleQuestionUndeliverable,
  readRoleAwaitingAnswer,
  roleAwaitingAnswerPath,
} = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));
const { writeRoleTopicMap, roleTopicMapPath } = require(path.join(EXT_OUT, 'concierge', 'roleTopicMapStore'));
const ROLE_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'role_ask.bb');
const OPERATOR_RUNTIME_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

const FEATURE_NAME = 'an undeliverable role question never leaves the asking role wedged';
const SPECIFIER_TOPIC_ID = 1595;

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE_NAME);
}

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-gh26-'));
}

function writeAwaitingMarker(root, role, contents) {
  const p = roleAwaitingAnswerPath(root, role);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(contents));
}

function mkSingleChunkReader(chunk) {
  let sent = false;
  return async () => {
    if (sent) {
      return { done: true, chunk: '' };
    }
    sent = true;
    return { done: false, chunk };
  };
}

function relayAdapters(ctx, chunk) {
  return {
    readChunk: mkSingleChunkReader(chunk),
    sendReply: async (topicId, text) => {
      ctx.sentReplies.push({ topicId, text });
    },
    roleTopicIdFor: async (role) => roleTopicIdFor(ctx.root, role),
    markRoleQuestionUndeliverable: async (role, question, options) => {
      markRoleQuestionUndeliverable(ctx.root, role, question, options);
      ctx.markedRoles.push(role);
    },
    resolveDelivery: () => {
      throw new Error('resolveDelivery should never be consulted for a roleQuestion record');
    },
    ackReply: async (id) => {
      ctx.acked.push(id);
    },
  };
}

async function relayRoleQuestionRecord(ctx) {
  const record = { id: 'r1', threadId: `role-ask-${ctx.role}`, text: ctx.question, roleQuestion: ctx.role };
  const chunk = `event: telegram-reply\ndata: ${JSON.stringify(record)}\n\n`;
  await relaySseReplies('', relayAdapters(ctx, chunk), new Set());
}

function runRoleAsk(root, role, question) {
  const out = execFileSync('bb', [ROLE_ASK_CLI, root, '--role', role, '--question', question], { encoding: 'utf8' });
  return JSON.parse(out);
}

function tickOnce(root) {
  const out = execFileSync('bb', [OPERATOR_RUNTIME_BB, root, '--tick-once'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPERATOR_SKIP_LAUNCH: '1',
      OPERATOR_MINIAPP_WATCHDOG_ENABLED: '0',
      SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
    },
  });
  return JSON.parse(out);
}

function readStatus(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'status.json'), 'utf8'));
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^a role-awaiting marker exists for role "([^"]+)"$/, (ctx, role) => {
    ctx.root = mkTmpRoot();
    ctx.role = role;
    ctx.question = 'which environment?';
    ctx.sentReplies = [];
    ctx.markedRoles = [];
    ctx.acked = [];
    writeAwaitingMarker(ctx.root, role, { question: ctx.question, asked_at_ms: 1000 });
  });

  // ── Scenario Outline: -01 (two example rows share both step texts) ────
  scoped(registry, /^the role topic lookup is missing from role-topic-map\.json$/, (ctx) => {
    writeRoleTopicMap(ctx.root, {});
  });
  scoped(registry, /^the role topic lookup is failing because the map is unreadable$/, (ctx) => {
    fs.mkdirSync(path.dirname(roleTopicMapPath(ctx.root)), { recursive: true });
    fs.writeFileSync(roleTopicMapPath(ctx.root), 'not json');
  });

  // ── When (shared by scenarios 01/03/04 - identical wording) ───────────
  scoped(registry, /^the reply relay processes the specifier role question record$/, async (ctx) => {
    await relayRoleQuestionRecord(ctx);
  });

  // ── Then: -01 ───────────────────────────────────────────────────────
  scoped(registry, /^the awaiting marker is rewritten with state undeliverable$/, (ctx) => {
    const marker = readRoleAwaitingAnswer(ctx.root, ctx.role);
    if (!marker || marker.state !== 'undeliverable') {
      throw new Error(`expected the marker to carry state undeliverable, got ${JSON.stringify(marker)}`);
    }
    if (marker.question !== ctx.question) {
      throw new Error(`expected the original question preserved for forensics, got ${JSON.stringify(marker)}`);
    }
  });
  scoped(registry, /^the record is acked exactly once$/, (ctx) => {
    if (ctx.acked.length !== 1 || ctx.acked[0] !== 'r1') {
      throw new Error(`expected exactly one ack of "r1", got ${JSON.stringify(ctx.acked)}`);
    }
  });

  // ── Scenario: -02 ───────────────────────────────────────────────────
  scoped(registry, /^the awaiting marker for role "([^"]+)" carries state undeliverable$/, (ctx, role) => {
    writeAwaitingMarker(ctx.root, role, { question: ctx.question, asked_at_ms: 1000, state: 'undeliverable' });
  });
  scoped(registry, /^role_ask\.bb is invoked for role "([^"]+)"$/, (ctx, role) => {
    ctx.newQuestion = 'a fresh question';
    ctx.roleAskResult = runRoleAsk(ctx.root, role, ctx.newQuestion);
  });
  scoped(registry, /^the ask is accepted$/, (ctx) => {
    if (ctx.roleAskResult.asked !== true) {
      throw new Error(`expected the ask to be accepted, got ${JSON.stringify(ctx.roleAskResult)}`);
    }
  });
  scoped(registry, /^the marker is overwritten as the new pending question$/, (ctx) => {
    const marker = readRoleAwaitingAnswer(ctx.root, ctx.role);
    if (!marker || marker.question !== ctx.newQuestion || 'state' in marker) {
      throw new Error(`expected an ordinary fresh pending marker (no state), got ${JSON.stringify(marker)}`);
    }
  });

  // ── Scenario: -03 ───────────────────────────────────────────────────
  scoped(registry, /^status\.json reports an undeliverable role question for "([^"]+)"$/, (ctx, role) => {
    tickOnce(ctx.root);
    const status = readStatus(ctx.root);
    const reported = status.role_questions_undeliverable && status.role_questions_undeliverable[role];
    if (!reported || reported.question !== ctx.question) {
      throw new Error(`expected status.json to report an undeliverable question for "${role}", got ${JSON.stringify(status.role_questions_undeliverable)}`);
    }
  });

  // ── Scenario: -04 ───────────────────────────────────────────────────
  scoped(registry, /^role "([^"]+)" has a topic in role-topic-map\.json$/, (ctx, role) => {
    writeRoleTopicMap(ctx.root, { [role]: SPECIFIER_TOPIC_ID });
  });
  scoped(registry, /^the question is posted to the specifier role topic$/, (ctx) => {
    if (ctx.sentReplies.length !== 1 || ctx.sentReplies[0].topicId !== SPECIFIER_TOPIC_ID || ctx.sentReplies[0].text !== ctx.question) {
      throw new Error(`expected the question delivered to topic ${SPECIFIER_TOPIC_ID}, got ${JSON.stringify(ctx.sentReplies)}`);
    }
    if (ctx.markedRoles.length !== 0) {
      throw new Error(`expected markRoleQuestionUndeliverable never called for a deliverable question, got ${JSON.stringify(ctx.markedRoles)}`);
    }
  });
  scoped(registry, /^the awaiting marker remains pending$/, (ctx) => {
    const marker = readRoleAwaitingAnswer(ctx.root, ctx.role);
    if (!marker || 'state' in marker || marker.question !== ctx.question) {
      throw new Error(`expected the ORIGINAL pending marker untouched, got ${JSON.stringify(marker)}`);
    }
  });
}

module.exports = { registerSteps };
