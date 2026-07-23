'use strict';

// BL-296: step handlers for the swarm typed-event-stream feature. Drives the
// REAL pure deriveSwarmEvents (extension/out/events/swarmEventStream.js)
// directly against in-memory fixture snapshots - no fs, no CLI subprocess,
// no tmux/network, matching the ticket's own "pure function over provided
// inputs" constraint (mirrors needsApprovalSteps.js's own require-compiled-
// module pattern).
const path = require('node:path');
const fs = require('node:fs');

const { deriveSwarmEvents, swarmEventKey } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'events', 'swarmEventStream'));

const SWARM_EVENT_STREAM_SOURCE_PATH = path.join(__dirname, '..', '..', '..', 'extension', 'src', 'events', 'swarmEventStream.ts');
const BACKLOG_ID = 'BL-500';

function snapshot(overrides = {}) {
  return {
    backlog: { active: [], paused: [], done: [] },
    gates: [],
    roleTicket: {},
    ...overrides,
  };
}

function snapshotsForTrigger(trigger) {
  if (trigger === 'that has just started being worked') {
    return { prev: snapshot(), curr: snapshot({ backlog: { active: [BACKLOG_ID], paused: [], done: [] } }) };
  }
  if (trigger === 'whose work has captured a to-human gate') {
    return {
      prev: snapshot({ gates: [{ role: 'coder', gated: false }] }),
      curr: snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: { coder: BACKLOG_ID } }),
    };
  }
  if (trigger === 'that has just completed') {
    return { prev: snapshot(), curr: snapshot({ backlog: { active: [], paused: [], done: [BACKLOG_ID] } }) };
  }
  throw new Error(`unknown trigger: ${trigger}`);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm's activity is turned into typed events without any knowledge of Telegram$/, () => {
    const src = fs.readFileSync(SWARM_EVENT_STREAM_SOURCE_PATH, 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/telegram/i.test(code)) {
      throw new Error('expected the swarm event-stream module to never reference Telegram');
    }
  });

  // ── typed-events-01 ─────────────────────────────────────────────────
  registry.define(/^a backlog item (.+)$/, (ctx, trigger) => {
    ctx.trigger = trigger;
    const { prev, curr } = snapshotsForTrigger(trigger);
    ctx.prev = prev;
    ctx.curr = curr;
  });

  registry.define(/^the event stream is derived$/, (ctx) => {
    ctx.events = deriveSwarmEvents(ctx.prev, ctx.curr);
  });

  registry.define(/^it includes a (\S+) event tagged with that backlog item$/, (ctx, eventType) => {
    const match = ctx.events.find((e) => e.type === eventType && e.backlogId === BACKLOG_ID);
    if (!match) {
      throw new Error(`expected a ${eventType} event tagged with ${BACKLOG_ID}, got ${JSON.stringify(ctx.events)}`);
    }
  });

  // ── typed-events-02 ───────────────────────────────────────────────────
  registry.define(/^an emitted event$/, (ctx) => {
    const curr = snapshot({ backlog: { active: [BACKLOG_ID], paused: [], done: [] } });
    ctx.event = deriveSwarmEvents(null, curr)[0];
  });

  registry.define(/^it is inspected$/, (ctx) => {
    ctx.inspected = { keys: Object.keys(ctx.event).sort(), serialized: JSON.stringify(ctx.event) };
  });

  registry.define(/^it names its type and its backlog item but nothing about Telegram or topics$/, (ctx) => {
    const expectedKeys = ['backlogId', 'payload', 'type'];
    if (JSON.stringify(ctx.inspected.keys) !== JSON.stringify(expectedKeys)) {
      throw new Error(`expected exactly the keys ${expectedKeys.join(', ')}, got ${ctx.inspected.keys.join(', ')}`);
    }
    if (/telegram|topic|message_thread_id/i.test(ctx.inspected.serialized)) {
      throw new Error(`expected no Telegram/topic reference in the emitted event, got ${ctx.inspected.serialized}`);
    }
  });

  // ── typed-events-03 ───────────────────────────────────────────────────
  registry.define(/^an event already emitted for a backlog item$/, (ctx) => {
    ctx.curr = snapshot({ backlog: { active: [BACKLOG_ID], paused: [], done: [] } });
    const firstPass = deriveSwarmEvents(null, ctx.curr);
    ctx.priorEvent = firstPass[0];
    ctx.alreadyEmitted = new Set(firstPass.map(swarmEventKey));
  });

  registry.define(/^the stream is derived again with no new change$/, (ctx) => {
    ctx.events = deriveSwarmEvents(null, ctx.curr, ctx.alreadyEmitted);
  });

  registry.define(/^that event is not emitted again$/, (ctx) => {
    const stillPresent = ctx.events.some((e) => swarmEventKey(e) === swarmEventKey(ctx.priorEvent));
    if (stillPresent) {
      throw new Error(`expected ${swarmEventKey(ctx.priorEvent)} not to be re-emitted, got ${JSON.stringify(ctx.events)}`);
    }
  });
}

module.exports = { registerSteps };
