'use strict';

// BL-450: step handlers for "A standing Recert topic is where the human
// recertifies Gherkin scenarios in-chat". Combines three REAL compiled
// surfaces, no live Telegram/network - mirrors
// bl434ApprovalsStandingTopicSteps.js's own structure exactly:
//   - runConciergeTick (conciergeTick.ts) against fake in-memory adapters,
//     for the POSTING half (scenarios 01/02/08), fed off the REAL
//     computeRecertBatch (recertificationStore.ts) against a real git-backed
//     backlog fixture - never a second scenario-selection mechanism.
//   - pollAndForward (telegramFrontDeskBotCore.ts) against fake poll
//     adapters, for the REPLY-DISPATCH half (scenarios 03/04/05/06/07).
//   - the real fs-backed recordRecertValidate/queueRecertAmendProposal/
//     queueRecertDeleteProposal/isScenarioUpForRecert (recertificationStore.ts)
//     against the SAME fixture, reused (never a second recording path) by
//     both halves above.
//
// Scenario-id note: BL-111's own stable-id convention (gherkinScenarios.ts's
// TAG_LINE) always joins a scenario's `# <TICKET> <slug>` tag comment into
// its real id as `<TICKET>/<slug>` (a literal slash) - so the feature
// file's own illustrative example id "BL-207-thing-01" (all dashes) can
// never be a REAL production scenario id; the join always inserts a slash.
// toRealScenarioId below translates the feature file's example wording into
// the real slash-joined id this fixture's tickets actually carry, and every
// step that names a scenario id translates through the SAME ctx.idMap
// recorded by whichever Given step first introduced it - the scenarios fix
// the BEHAVIOR, not this cosmetic id-format detail (the feature file's own
// header comment).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { mkTmpDir } = require(path.join(EXT_DIR, 'test', 'helpers', 'tmpDir'));
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const {
  computeRecertBatch,
  isScenarioUpForRecert,
  recordRecertValidate,
  queueRecertAmendProposal,
  queueRecertDeleteProposal,
} = require(path.join(EXT_DIR, 'out', 'docs', 'recertificationStore'));

const RECERT_SUBJECT_ID = 'RECERT';
const RECERT_TOPIC_ID = 900;
const PRINCIPAL_ID = 111;
const NOW_MS = Date.parse('2026-07-16T12:00:00Z');

const EXAMPLE_ID_PATTERN = /^([A-Za-z]+-\d+)-(.+)$/;

function toTicketAndSuffix(exampleId) {
  const match = exampleId.match(EXAMPLE_ID_PATTERN);
  if (!match) {
    throw new Error(`fixture id "${exampleId}" does not match the expected <TICKET>-<slug> shape`);
  }
  return { ticketId: match[1], suffix: match[2] };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Writes one real backlog ticket carrying one or more BL-111-tagged Gherkin
// scenarios in its acceptance: field, then commits it - the SAME fixture
// shape recertificationStore.test.js's own mkGenerateRecertBatchFixture
// uses.
function writeRecertTicket(ctx, ticketId, title, scenarios) {
  const dir = path.join(ctx.targetPath, 'backlog', 'active');
  mkdirp(dir);
  const blocks = scenarios.map((s) => `  # ${ticketId} ${s.suffix}\n  Scenario: ${s.name}\n    ${s.steps.join('\n    ')}\n`).join('\n');
  fs.writeFileSync(path.join(dir, `${ticketId}.yaml`), `id: ${ticketId}\ntitle: ${title}\nstatus: active\nmilestone: M1\nacceptance: |\n${blocks}`);
  git(ctx.targetPath, ['add', '-A']);
  git(ctx.targetPath, ['commit', '-q', '-m', `fixture: ${ticketId}`]);
}

function buildConciergeAdapters(ctx) {
  return {
    readFolders: () => ({ active: [], paused: [], done: [] }),
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.tickState,
    writeTickState: (next) => {
      ctx.tickState = next;
    },
    routeAdapters: {
      getTopicMap: () => ctx.topicMap,
      createTopic: async (name) => {
        ctx.created.push(name);
        return { success: true, topicId: 950 + ctx.created.length };
      },
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => 750,
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
    // BL-450: fed off the REAL computeRecertBatch against ctx.targetPath - a
    // fixed clock (NOW_MS) so "the oldest un-reviewed scenario" is
    // deterministic across every scenario in this file.
    readRecertScenario: () => computeRecertBatch(ctx.targetPath, 1, NOW_MS).batch[0],
    recertPostingAdapters: {
      ensureRecertTopic: async () => {
        ctx.recertTopicEnsured = true;
        return RECERT_TOPIC_ID;
      },
      postMessage: async (topicId, text) => {
        ctx.posted.push({ topicId, text });
        return ctx.posted.length;
      },
      editMessage: async (topicId, messageId, text) => {
        ctx.edited.push({ topicId, messageId, text });
        return true;
      },
    },
  };
}

async function tick(ctx) {
  ctx.tickResult = await runConciergeTick(ctx.adapters);
}

// Posts scenario `exampleId` into the Recert topic by writing the ticket the
// SAME real computeRecertBatch selection reads, then running a tick - by the
// time a scenario's own When step fires, the scenario is genuinely the
// current oldest, exactly as recert-telegram-03..06's own Given wording
// requires. Always creates a SIBLING scenario too, so validating the
// primary one away leaves a real second one behind to observe
// recert-telegram-03's "leaves the queue" against (a single-scenario pool
// would always re-select itself regardless of its timestamp). Records the
// example->real id translation in ctx.idMap for every later step.
async function givenScenarioPosted(ctx, exampleId) {
  const { ticketId, suffix } = toTicketAndSuffix(exampleId);
  writeRecertTicket(ctx, ticketId, `fixture for ${ticketId}`, [
    { suffix, name: 'first', steps: ['Given a', 'When b', 'Then c'] },
    { suffix: `${suffix}-sibling`, name: 'second', steps: ['Given x'] },
  ]);
  ctx.idMap[exampleId] = `${ticketId}/${suffix}`;
  await tick(ctx);
}

// Translates every example id this scenario has already introduced
// (ctx.idMap) into its real slash-joined counterpart wherever it appears in
// `text` - a plain, safe substring substitution since an example id and its
// real translation differ only in one separator character.
function substituteKnownIds(ctx, text) {
  return Object.entries(ctx.idMap).reduce((acc, [exampleId, realId]) => acc.split(exampleId).join(realId), text);
}

function realIdFor(ctx, exampleId) {
  return ctx.idMap[exampleId] ?? exampleId;
}

async function deliverRecertTopicReply(ctx, text) {
  ctx.updateCounter = (ctx.updateCounter ?? 0) + 1;
  ctx.replyResult = await pollAndForward(0, String(PRINCIPAL_ID), {
    chatId: '1',
    getUpdates: async () => ({
      success: true,
      updates: [{ update_id: ctx.updateCounter, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: RECERT_TOPIC_ID, text } }],
    }),
    postToBridge: async () => {
      throw new Error('postToBridge should not be called for a Recert-topic reply');
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called for a Recert-topic reply');
    },
    subjectForTopic: (topicId) => (topicId === RECERT_TOPIC_ID ? RECERT_SUBJECT_ID : undefined),
    backlogForTopic: () => undefined,
    postOperatorContext: async () => {
      throw new Error('postOperatorContext should not be called for a Recert-topic reply');
    },
    // Real writers against ctx.targetPath - the SAME production functions
    // telegram-front-desk-bot.ts wires, not fakes (mirrors
    // bl434ApprovalsStandingTopicSteps.js's own posture).
    isScenarioUpForRecert: (scenarioId) => Promise.resolve(isScenarioUpForRecert(ctx.targetPath, scenarioId, NOW_MS)),
    recordRecertValidate: (scenarioId) => Promise.resolve(recordRecertValidate(ctx.targetPath, scenarioId, NOW_MS)),
    queueRecertAmendProposal: (scenarioId, newText) => Promise.resolve(queueRecertAmendProposal(ctx.targetPath, scenarioId, newText, NOW_MS)),
    queueRecertDeleteProposal: (scenarioId) => Promise.resolve(queueRecertDeleteProposal(ctx.targetPath, scenarioId, NOW_MS)),
    // BL-450: the delete-confirmation gate is genuinely bot-local, ephemeral
    // conversation state (not something recertificationStore.ts owns) - a
    // small in-memory ctx marker mirrors telegram-front-desk-bot.ts's own
    // real file-backed store closely enough for this fixture.
    getPendingRecertDelete: async () => ctx.pendingDelete,
    setPendingRecertDelete: async (scenarioId) => {
      ctx.pendingDelete = scenarioId;
    },
    clearPendingRecertDelete: async () => {
      ctx.pendingDelete = undefined;
    },
    notifyRecertTopic: async (topicId, text2) => {
      ctx.notified.push({ topicId, text: text2 });
      return true;
    },
  });
}

function proposalsFile(ctx) {
  const month = new Date(NOW_MS).toISOString().slice(0, 7);
  return path.join(ctx.targetPath, '.swarmforge', 'recert_proposals', `${month}.jsonl`);
}

function readProposals(ctx) {
  if (!fs.existsSync(proposalsFile(ctx))) {
    return [];
  }
  return fs
    .readFileSync(proposalsFile(ctx), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readRecertState(ctx) {
  const file = path.join(ctx.targetPath, '.swarmforge', 'recert-state.json');
  if (!fs.existsSync(file)) {
    return { scenarios: {} };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Exported so a sibling feature that has no "a standing Recert topic
// exists" Background of its own (BL-451's retirement scenarios reuse "the
// recert posting runs" without one) can build the SAME ctx shape rather
// than reimplementing this fixture wiring a second time.
function initRecertTopicFixture(ctx) {
  ctx.targetPath = mkTmpDir('sfvc-bl450-');
  git(ctx.targetPath, ['init', '-q']);
  git(ctx.targetPath, ['config', 'user.email', 't@t']);
  git(ctx.targetPath, ['config', 'user.name', 't']);
  mkdirp(path.join(ctx.targetPath, '.swarmforge'));
  fs.writeFileSync(path.join(ctx.targetPath, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${ctx.targetPath}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  ctx.topicMap = {};
  ctx.created = [];
  ctx.posted = [];
  ctx.edited = [];
  ctx.notified = [];
  ctx.tickState = { snapshot: null, emittedKeys: [] };
  ctx.pendingDelete = undefined;
  ctx.idMap = {};
  ctx.adapters = buildConciergeAdapters(ctx);
}

function seedScenariosNeedingRecertification(ctx) {
  writeRecertTicket(ctx, 'BL-207', 'a fine ticket', [
    { suffix: 'thing-01', name: 'first', steps: ['Given a', 'When b', 'Then c'] },
    { suffix: 'thing-02', name: 'second', steps: ['Given x'] },
  ]);
}

function registerSteps(registry) {
  const FEATURE_NAME = 'A standing Recert topic is where the human recertifies Gherkin scenarios in-chat';

  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a standing Recert topic exists$/, (ctx) => {
    initRecertTopicFixture(ctx);
  });

  // ── recert-telegram-01/02 ────────────────────────────────────────────
  registry.define(/^scenarios need recertification$/, (ctx) => {
    seedScenariosNeedingRecertification(ctx);
  });

  registry.define(/^the recert posting runs(?: again with that scenario still the oldest)?$/, async (ctx) => {
    await tick(ctx);
  });

  registry.define(/^the oldest un-reviewed scenario is posted in the Recert topic$/, (ctx) => {
    if (!ctx.posted.some((m) => m.topicId === RECERT_TOPIC_ID && m.text.includes('BL-207/thing-01'))) {
      throw new Error(`expected BL-207/thing-01 posted into the Recert topic, got ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^no other scenario is posted at the same time$/, (ctx) => {
    if (ctx.posted.length !== 1) {
      throw new Error(`expected exactly one scenario posted, got ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^the oldest un-reviewed scenario has already been posted in the Recert topic$/, async (ctx) => {
    writeRecertTicket(ctx, 'BL-207', 'a fine ticket', [
      { suffix: 'thing-01', name: 'first', steps: ['Given a', 'When b', 'Then c'] },
      { suffix: 'thing-02', name: 'second', steps: ['Given x'] },
    ]);
    await tick(ctx);
  });

  registry.define(/^the scenario is not posted again$/, (ctx) => {
    if (ctx.posted.length !== 1 || ctx.edited.length !== 0) {
      throw new Error(`expected no new post or edit on an unchanged oldest scenario, got posted=${JSON.stringify(ctx.posted)} edited=${JSON.stringify(ctx.edited)}`);
    }
  });

  // ── recert-telegram-03/04/05/06 (shared Given) ──────────────────────
  registry.define(/^scenario "([^"]*)" is posted in the Recert topic for recertification$/, async (ctx, exampleId) => {
    await givenScenarioPosted(ctx, exampleId);
  });

  // ── shared reply/confirm delivery ───────────────────────────────────
  registry.define(/^the human replies "([^"]*)" in the Recert topic$/, async (ctx, reply) => {
    await deliverRecertTopicReply(ctx, substituteKnownIds(ctx, reply));
  });

  // ── recert-telegram-03 ───────────────────────────────────────────────
  registry.define(/^scenario "([^"]*)"'s last-reviewed timestamp is advanced to now$/, (ctx, exampleId) => {
    const state = readRecertState(ctx);
    const entry = state.scenarios[realIdFor(ctx, exampleId)];
    const iso = entry && entry.lastReviewedIso;
    if (iso !== new Date(NOW_MS).toISOString()) {
      throw new Error(`expected ${exampleId}'s lastReviewedIso advanced to ${new Date(NOW_MS).toISOString()}, got ${iso}`);
    }
  });

  registry.define(/^scenario "([^"]*)" leaves the recertification queue$/, (ctx, exampleId) => {
    const next = computeRecertBatch(ctx.targetPath, 1, NOW_MS).batch[0];
    if (!next || next.id === realIdFor(ctx, exampleId)) {
      throw new Error(`expected a DIFFERENT scenario now oldest after validating ${exampleId}, got ${JSON.stringify(next)}`);
    }
  });

  // ── recert-telegram-04 ───────────────────────────────────────────────
  registry.define(/^the human replies to amend "([^"]*)" with new scenario text in the Recert topic$/, async (ctx, exampleId) => {
    ctx.amendedText = 'Given a revised precondition';
    ctx.ticketFileBefore = fs.readFileSync(path.join(ctx.targetPath, 'backlog', 'active', toTicketAndSuffix(exampleId).ticketId + '.yaml'), 'utf8');
    await deliverRecertTopicReply(ctx, `amend ${realIdFor(ctx, exampleId)} ${ctx.amendedText}`);
  });

  registry.define(/^an update proposal for "([^"]*)" carrying the new text is queued for specifier review$/, (ctx, exampleId) => {
    const proposal = readProposals(ctx).find((p) => p.scenarioId === realIdFor(ctx, exampleId));
    if (!proposal || proposal.outcome !== 'update' || proposal.newText !== ctx.amendedText) {
      throw new Error(`expected an "update" proposal for ${exampleId} carrying "${ctx.amendedText}", got ${JSON.stringify(readProposals(ctx))}`);
    }
  });

  registry.define(/^the scenario's feature file is not edited directly$/, (ctx) => {
    const ticketId = Object.keys(ctx.idMap)
      .map((exampleId) => toTicketAndSuffix(exampleId).ticketId)[0];
    const after = fs.readFileSync(path.join(ctx.targetPath, 'backlog', 'active', `${ticketId}.yaml`), 'utf8');
    if (after !== ctx.ticketFileBefore) {
      throw new Error('expected the ticket/feature source untouched by an amend reply, but it changed');
    }
  });

  // ── recert-telegram-05 ───────────────────────────────────────────────
  registry.define(/^no delete proposal is queued yet$/, (ctx) => {
    if (readProposals(ctx).some((p) => p.outcome === 'delete')) {
      throw new Error(`expected no delete proposal queued yet, got ${JSON.stringify(readProposals(ctx))}`);
    }
  });

  registry.define(/^an explicit confirmation of the deletion is requested$/, (ctx) => {
    if (!ctx.notified.some((n) => n.topicId === RECERT_TOPIC_ID && /confirm/i.test(n.text))) {
      throw new Error(`expected a confirmation request posted into the Recert topic, got ${JSON.stringify(ctx.notified)}`);
    }
  });

  // ── recert-telegram-06 ───────────────────────────────────────────────
  registry.define(/^the human has been asked to confirm deleting scenario "([^"]*)"$/, async (ctx, exampleId) => {
    await givenScenarioPosted(ctx, exampleId);
    await deliverRecertTopicReply(ctx, `delete ${realIdFor(ctx, exampleId)}`);
  });

  registry.define(/^the human confirms the deletion in the Recert topic$/, async (ctx) => {
    await deliverRecertTopicReply(ctx, 'confirm');
  });

  registry.define(/^a delete proposal for "([^"]*)" is queued for specifier review$/, (ctx, exampleId) => {
    const proposal = readProposals(ctx).find((p) => p.scenarioId === realIdFor(ctx, exampleId) && p.outcome === 'delete');
    if (!proposal) {
      throw new Error(`expected a "delete" proposal for ${exampleId}, got ${JSON.stringify(readProposals(ctx))}`);
    }
  });

  // ── recert-telegram-07 ───────────────────────────────────────────────
  registry.define(/^no scenario "([^"]*)" is awaiting recertification$/, () => {
    // A clean fixture already has no such scenario - nothing to set up, and
    // deliberately no ctx.idMap entry, so its literal example id is never
    // translated into a real one below.
  });

  registry.define(/^no recertification verdict is recorded for "([^"]*)"$/, (ctx, exampleId) => {
    const state = readRecertState(ctx);
    if (state.scenarios[realIdFor(ctx, exampleId)]) {
      throw new Error(`expected no recorded verdict for ${exampleId}, got ${JSON.stringify(state.scenarios[realIdFor(ctx, exampleId)])}`);
    }
    if (ctx.replyResult.posted !== 0) {
      throw new Error(`expected the reply naming a not-up-for-recert scenario to record nothing, got posted=${ctx.replyResult.posted}`);
    }
  });

  // Scoped - the exact same Then text is ALREADY registered unscoped by
  // bl434ApprovalsStandingTopicSteps.js (BL-434) for its own Approvals-topic
  // ctx shape; unscoped registration order would make that OLDER handler
  // win here regardless of this file's own position in index.js's DOMAINS
  // array (same collision class as "no scenario needs recertification"
  // above - stepRegistry.resolve() matches literal text suite-wide).
  registry.defineScoped(
    /^the reply is surfaced back as not acted on$/,
    (ctx) => {
      if (!ctx.notified.some((n) => n.topicId === RECERT_TOPIC_ID)) {
        throw new Error(`expected a surfacing reply into the Recert topic, got ${JSON.stringify(ctx.notified)}`);
      }
      if (ctx.replyResult.dropped !== 1) {
        throw new Error(`expected the not-currently-up-for-recert reply to be a deliberate drop, got dropped=${ctx.replyResult.dropped}`);
      }
    },
    FEATURE_NAME
  );

  // ── recert-telegram-08 ───────────────────────────────────────────────
  // Scoped (defineScoped) - the exact same Given text is ALREADY registered
  // by recertListenSteps.js (BL-271) for a completely unrelated PWA-render
  // fixture (ctx.batch, not ctx.folders/adapters). stepRegistry.resolve()
  // matches by literal text across the WHOLE suite regardless of origin
  // file, so an unscoped registration here would either shadow BL-271's own
  // scenarios (if registered earlier in index.js) or never be reached (if
  // registered later) - defineScoped pins this handler to THIS feature only,
  // the same fix bl425RoleSteeringTopicsSteps.js already established for the
  // identical collision shape.
  registry.defineScoped(
    /^no scenario needs recertification$/,
    () => {
      // A clean fixture already has no ticket at all - nothing to set up.
    },
    FEATURE_NAME
  );

  registry.define(/^nothing is posted in the Recert topic$/, (ctx) => {
    if (ctx.posted.length !== 0 || ctx.recertTopicEnsured) {
      throw new Error(`expected nothing posted and the Recert topic never even created, got posted=${JSON.stringify(ctx.posted)} ensured=${!!ctx.recertTopicEnsured}`);
    }
  });
}

module.exports = { registerSteps, initRecertTopicFixture, seedScenariosNeedingRecertification, RECERT_TOPIC_ID };
