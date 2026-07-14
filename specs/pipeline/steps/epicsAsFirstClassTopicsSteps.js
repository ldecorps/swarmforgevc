'use strict';

// BL-341: step handlers for "The human can follow an epic, not just its
// atomised slices". Drives two REAL compiled surfaces, no live Telegram/
// network:
//   - parseBacklogYaml (backlogReader.ts) for the epic-as-data scenario
//     (01) - proves the field is READ, never inferred from prose.
//   - runConciergeTick (conciergeTick.ts) against fake in-memory adapters
//     for everything else (02-04, 06-08) - mirrors
//     conciergeNeedsApprovalSteps.js's own buildAdapters shape. The
//     epic-defining ticket is the SAME `type: epic` / self-referential
//     `epic:` convention this ticket discovered already live in the
//     backlog (BL-384), reused rather than a second data source.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { parseBacklogYaml } = require(path.join(EXT_DIR, 'out', 'panel', 'backlogReader'));
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { decideTopicAction, decideEpicTopicAction } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));

const EPIC_ID = 'dynamic-routing';
const EPIC_TITLE = 'Dynamic Routing';

function buildAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.state,
    writeTickState: (next) => {
      ctx.state = next;
    },
    routeAdapters: {
      getTopicMap: () => ctx.topicMap,
      createTopic: async (name) => {
        ctx.created.push(name);
        return { success: true, topicId: 900 + ctx.created.length };
      },
      recordTopicId: (backlogId, topicId) => {
        ctx.topicMap[backlogId] = topicId;
      },
      sendMessage: async (topicId, text) => {
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
    },
    iconAdapters: {
      // BL-342: a safe default for fixtures that predate topic icons and
      // do not exercise them - an empty sticker list means syncTopicIcon
      // always no-ops (skipped-unresolved-icon), so runConciergeTick's own
      // icon-sync pass never calls setTopicIcon unexpectedly here.
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function epicDefTicket(remainingSlices = []) {
  return { id: `${EPIC_ID}-epic-ticket`, title: EPIC_TITLE, type: 'epic', epic: EPIC_ID, remainingSlices };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^work that is delivered as several slices over time$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [epicDefTicket()], done: [] };
  });

  // ── epics-as-first-class-topics-01 ──────────────────────────────────────
  registry.define(/^a slice belonging to an epic$/, (ctx) => {
    ctx.rawSliceYaml = [
      'id: BL-500',
      'title: t',
      `epic: ${EPIC_ID}`,
      'notes: |',
      '  This slice actually belongs to some-other-epic, according to this prose -',
      '  the epic: field above must win, never this text.',
    ].join('\n');
  });

  registry.define(/^the slice is read$/, (ctx) => {
    ctx.parsedSlice = parseBacklogYaml(ctx.rawSliceYaml);
  });

  registry.define(/^the epic it belongs to is read from the slice itself$/, (ctx) => {
    if (ctx.parsedSlice.epic !== EPIC_ID) {
      throw new Error(`expected epic "${EPIC_ID}" read from the slice's own field, got ${JSON.stringify(ctx.parsedSlice.epic)}`);
    }
  });

  registry.define(/^it is not inferred from the slice's prose$/, (ctx) => {
    if (ctx.parsedSlice.epic !== EPIC_ID || ctx.parsedSlice.epic === 'some-other-epic') {
      throw new Error('the epic field must come from epic:, never from notes: prose');
    }
  });

  // ── epics-as-first-class-topics-02/03 ───────────────────────────────────
  registry.define(/^an epic with no topic yet$/, () => {
    // Background already leaves ctx.topicMap empty for EPIC_ID - nothing
    // further to arrange.
  });

  registry.define(/^its first slice appears$/, async (ctx) => {
    ctx.folders.active.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^a topic is created for the epic$/, (ctx) => {
    if (!ctx.created.includes(`EPIC — ${EPIC_TITLE}`)) {
      throw new Error(`expected an epic topic named "EPIC — ${EPIC_TITLE}", got ${JSON.stringify(ctx.created)}`);
    }
  });

  registry.define(/^an epic that already has a topic$/, async (ctx) => {
    ctx.folders.active.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
    ctx.epicTopicsCreatedSoFar = ctx.created.filter((name) => name.startsWith('EPIC — ')).length;
  });

  registry.define(/^another of its slices appears$/, async (ctx) => {
    ctx.folders.active.push({ id: 'BL-2', title: 'second slice', epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^no second topic is created for that epic$/, (ctx) => {
    const epicTopicsNow = ctx.created.filter((name) => name.startsWith('EPIC — ')).length;
    if (epicTopicsNow !== ctx.epicTopicsCreatedSoFar) {
      throw new Error(`expected no new epic topic, got ${JSON.stringify(ctx.created)}`);
    }
    if (ctx.topicMap[EPIC_ID] !== ctx.epicTopicId) {
      throw new Error('expected the SAME epic topic id to be reused');
    }
  });

  // ── epics-as-first-class-topics-04/05/06 ────────────────────────────────
  registry.define(/^an epic with a topic and several slices$/, async (ctx) => {
    ctx.folders.active.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID }, { id: 'BL-2', title: 'second slice', epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
  });

  registry.define(/^one of its slices completes$/, async (ctx) => {
    ctx.folders.active = ctx.folders.active.filter((item) => item.id !== 'BL-1');
    ctx.folders.done.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^progress is posted into the epic's topic$/, (ctx) => {
    if (!ctx.sent.some((m) => m.topicId === ctx.epicTopicId && m.text.includes('ticketed slice'))) {
      throw new Error(`expected progress posted into the epic's topic, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^the progress states how many of the epic's slices remain$/, (ctx) => {
    if (!ctx.sent.some((m) => m.topicId === ctx.epicTopicId && m.text === '1 of 2 ticketed slice(s) complete.')) {
      throw new Error(`expected the progress to count 1 of 2 ticketed slices complete, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^the epic has a remaining slice that has no ticket$/, (ctx) => {
    ctx.folders.paused = [epicDefTicket(['warm-core/break-even tuning'])];
  });

  registry.define(/^the epic's remaining work is stated$/, async (ctx) => {
    if (ctx.folders.active.length === 0 && ctx.folders.done.filter((i) => i.epic === EPIC_ID).length === 0) {
      // scenario-05 arrives here with no slice yet at all - give it one
      // ticketed slice so a completion can trigger the progress post.
      ctx.folders.active.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID });
      await runConciergeTick(buildAdapters(ctx));
    }
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
    ctx.folders.active = ctx.folders.active.filter((item) => item.id !== 'BL-1');
    ctx.folders.done.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^that slice is stated as remaining$/, (ctx) => {
    const last = ctx.sent.filter((m) => m.topicId === ctx.epicTopicId).slice(-1)[0];
    if (!last || !/warm-core\/break-even tuning/.test(last.text)) {
      throw new Error(`expected the untracked remaining slice named, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^an epic whose every ticketed slice is done$/, () => {
    // The next step ("the epic's remaining work is stated") itself drives
    // the one ticketed slice to completion - nothing further to arrange.
  });

  registry.define(/^the epic is not reported as complete$/, (ctx) => {
    const last = ctx.sent.filter((m) => m.topicId === ctx.epicTopicId).slice(-1)[0];
    if (!last || last.text.includes('Epic complete')) {
      throw new Error(`expected no completion claim while an untracked slice remains, got ${JSON.stringify(last)}`);
    }
  });

  // ── epics-as-first-class-topics-07 ──────────────────────────────────────
  registry.define(/^a ticket that declares no epic$/, (ctx) => {
    ctx.folders = { active: [{ id: 'BL-9', title: 'an ordinary ticket' }], paused: [], done: [] };
  });

  registry.define(/^the ticket completes$/, async (ctx) => {
    await runConciergeTick(buildAdapters(ctx));
    ctx.folders.active = [];
    ctx.folders.done = [{ id: 'BL-9', title: 'an ordinary ticket' }];
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^it is routed to its own topic as before$/, (ctx) => {
    if (!ctx.sent.some((m) => m.text === 'BL-9 - an ordinary ticket is complete.')) {
      throw new Error(`expected the ordinary completion summary, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^no epic progress is posted$/, (ctx) => {
    if (ctx.sent.some((m) => m.text.includes('ticketed slice') || m.text.startsWith('Epic:'))) {
      throw new Error(`expected no epic-shaped message, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── epics-as-first-class-topics-08 ──────────────────────────────────────
  registry.define(/^an epic with a topic$/, (ctx) => {
    ctx.sharedMap = { 'BL-123': 99, [EPIC_ID]: 42 };
  });

  registry.define(/^the epic's topic is looked up$/, (ctx) => {
    ctx.ticketAction = decideTopicAction({ type: 'TaskStarted', backlogId: 'BL-123', payload: {} }, ctx.sharedMap, 'a fine feature');
    ctx.epicAction = decideEpicTopicAction(EPIC_ID, EPIC_TITLE, ctx.sharedMap, 'progress text');
  });

  registry.define(/^it is looked up through the same mapping the per-ticket topics use$/, (ctx) => {
    if (ctx.ticketAction.kind !== 'reuse' || ctx.ticketAction.topicId !== 99) {
      throw new Error('expected the ticket topic resolved from the shared map');
    }
    if (ctx.epicAction.kind !== 'reuse' || ctx.epicAction.topicId !== 42) {
      throw new Error('expected the epic topic resolved from the SAME shared map');
    }
  });
}

module.exports = { registerSteps };
