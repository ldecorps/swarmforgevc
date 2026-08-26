'use strict';

// BL-495: step handlers for "The topic recreation repair path targets a
// ticket's epic or Backlog topic, never a per-ticket topic". Drives the
// REAL compiled recreateBlTopic (recreate-bl-topic.ts) against a real
// backlog/ + .swarmforge/operator/ fixture on disk and the established
// TELEGRAM_RECREATE_FORCE_RESULT seam (never a real network call) - never
// a hand-rolled reimplementation of the fold-target/reopen-recreate rules.
//
// KNOWN STEP-REGISTRY COLLISION (engineering.prompt's Gherkin-step-registry
// note): "a ticket's epic membership is read from its epic field", "a
// ticket whose epic field names an epic", "a ticket whose epic field is
// empty", and "no per-ticket topic is created" are ALSO registered by
// bl493FoldTicketEventsIntoEpicBacklogTopicSteps.js (required before this
// file in steps/index.js) for an entirely different scenario shape
// (routeEvent-based fold routing, not this file's recreateBlTopic CLI
// fixture). BL-493's own file already anticipated this by registering two
// of the four via registry.defineScoped(pattern, handler, FEATURE_NAME)
// (the BL-425 scoping convention) rather than a plain define - so this
// file registers ALL FOUR of the colliding patterns the same scoped way,
// pinned to THIS feature's own name, letting both files' handlers coexist
// without either silently winning over the other.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { recreateBlTopic } = require(path.join(EXT_DIR, 'out', 'tools', 'recreate-bl-topic'));

const FEATURE_NAME = "The topic recreation repair path targets a ticket's epic or Backlog topic, never a per-ticket topic";

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl495-'));
}

function writeTicketYaml(root, id, title, extra = '') {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "${title}"\nstatus: todo\n${extra}`);
}

function writeBacklogTopicMap(root, map) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog-topic-map.json'), JSON.stringify(map));
}

function readBacklogTopicMap(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), 'utf8'));
}

function writeOperatorTopicMap(root, map) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-topic-map.json'), JSON.stringify(map));
}

const TICKET_ID = 'BL-900';
const EPIC_ID = 'topic-consolidation';

async function invokeRecreation(ctx) {
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  process.env.TELEGRAM_CHAT_ID = 'y';
  process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: ctx.nextCreatedTopicId ?? 700 });
  ctx.result = await recreateBlTopic(ctx.targetPath, TICKET_ID);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the topic recreation path repairs a ticket's target topic$/, (ctx) => {
    ctx.targetPath = mkTmp();
    writeOperatorTopicMap(ctx.targetPath, {});
    writeBacklogTopicMap(ctx.targetPath, {});
  });

  registry.defineScoped(
    /^a ticket's epic membership is read from its epic field$/,
    () => {
      // Documents the invariant (BacklogItem.epic, never inferred from
      // prose, resolveTicketStatusTarget's own contract) - the scenario's
      // own Given below sets the concrete epic value.
    },
    FEATURE_NAME
  );

  // ── topic-recreation-epic-aware-01 ──────────────────────────────────
  registry.defineScoped(
    /^a ticket whose epic field names an epic$/,
    (ctx) => {
      writeTicketYaml(ctx.targetPath, TICKET_ID, 'a fine feature', `epic: ${EPIC_ID}\n`);
      writeTicketYaml(ctx.targetPath, 'BL-491', 'Topic Consolidation', `epic: ${EPIC_ID}\ntype: epic\n`);
    },
    FEATURE_NAME
  );

  registry.define(/^the recreation path is invoked for the ticket$/, async (ctx) => {
    await invokeRecreation(ctx);
  });

  registry.define(/^the repair targets that epic's topic$/, (ctx) => {
    const map = readBacklogTopicMap(ctx.targetPath);
    if (!(EPIC_ID in map) || map[EPIC_ID] !== ctx.result.topicId) {
      throw new Error(`expected the epic id mapped to the repaired topic id, got map=${JSON.stringify(map)} result=${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the epic topic is reopened when it exists or recreated when it is gone$/, async (ctx) => {
    // The Given above left NO epic mapping, so the invocation just proven
    // above already exercised the RECREATE half.
    if (ctx.result.action !== 'recreate') {
      throw new Error(`expected the first invocation (no prior mapping) to recreate, got: ${JSON.stringify(ctx.result)}`);
    }
    // Now prove the REOPEN half: the epic is mapped (by the recreate call
    // just above), so invoking again must reopen the SAME topic, never
    // create a second one.
    ctx.nextCreatedTopicId = 999; // would only be used if a second create wrongly fired
    await invokeRecreation(ctx);
    if (ctx.result.action !== 'reopen') {
      throw new Error(`expected a second invocation (now mapped) to reopen, got: ${JSON.stringify(ctx.result)}`);
    }
    const map = readBacklogTopicMap(ctx.targetPath);
    if (ctx.result.topicId !== map[EPIC_ID] || ctx.result.topicId === 999) {
      throw new Error(`expected the reopen to target the ALREADY-mapped epic topic, not create a new one, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── topic-recreation-epic-aware-02 ──────────────────────────────────
  registry.defineScoped(
    /^a ticket whose epic field is empty$/,
    (ctx) => {
      writeTicketYaml(ctx.targetPath, TICKET_ID, 'an epic-less feature');
    },
    FEATURE_NAME
  );

  registry.define(/^the repair targets the standing Backlog topic$/, (ctx) => {
    const map = JSON.parse(fs.readFileSync(path.join(ctx.targetPath, '.swarmforge', 'operator', 'telegram-topic-map.json'), 'utf8'));
    const backlogEntry = Object.entries(map).find(([, subjectId]) => subjectId === 'BACKLOG');
    if (!backlogEntry || Number(backlogEntry[0]) !== ctx.result.topicId) {
      throw new Error(`expected the reserved BACKLOG subject mapped to the repaired topic id, got map=${JSON.stringify(map)} result=${JSON.stringify(ctx.result)}`);
    }
  });

  // ── topic-recreation-epic-aware-03 ──────────────────────────────────
  registry.define(/^a ticket that formerly owned a per-ticket topic$/, (ctx) => {
    writeTicketYaml(ctx.targetPath, TICKET_ID, 'a fine feature', `epic: ${EPIC_ID}\n`);
    writeTicketYaml(ctx.targetPath, 'BL-491', 'Topic Consolidation', `epic: ${EPIC_ID}\ntype: epic\n`);
    // A legacy per-ticket mapping, keyed by the TICKET's own id - the
    // fold-aware repair path must never consult this key.
    writeBacklogTopicMap(ctx.targetPath, { [TICKET_ID]: 999 });
  });

  registry.defineScoped(
    /^no per-ticket topic is created$/,
    (ctx) => {
      if (ctx.result.topicId === 999) {
        throw new Error('expected the repair to never reopen the stale per-ticket topic id (999)');
      }
      const map = readBacklogTopicMap(ctx.targetPath);
      if (map[TICKET_ID] !== 999) {
        throw new Error(`expected the stale per-ticket key left untouched (never read or reused), got: ${JSON.stringify(map)}`);
      }
      if (!(EPIC_ID in map)) {
        throw new Error(`expected the repair to have targeted the EPIC id instead, got: ${JSON.stringify(map)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
