const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deriveSwarmEvents, swarmEventKey } = require('../out/events/swarmEventStream');

// BL-296: pure prev/curr snapshot diff (mirrors telegramNarrator.test.js's
// own diffNarrationEvents test shape) - no real clock, no network, no
// Telegram. `snapshot()` fixtures build fresh per test, spread-overridden.

function snapshot(overrides = {}) {
  return {
    backlog: { active: [], paused: [], done: [] },
    gates: [],
    roleTicket: {},
    ticketSummaries: {},
    ...overrides,
  };
}

// ── typed-events-01 ─────────────────────────────────────────────────────

test('typed-events-01: a backlog item newly in the active folder emits TaskStarted tagged with it', () => {
  const prev = snapshot();
  const curr = snapshot({ backlog: { active: ['BL-500'], paused: [], done: [] } });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [{ type: 'TaskStarted', backlogId: 'BL-500', payload: {} }]);
});

test('BL-322: a TaskStarted event carries the ticket summary (title/notes/firstAcceptanceStep) when one is resolved', () => {
  const prev = snapshot();
  const curr = snapshot({
    backlog: { active: ['BL-500'], paused: [], done: [] },
    ticketSummaries: { 'BL-500': { title: 'a fine feature', notes: 'the notes', firstAcceptanceStep: 'the first step' } },
  });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [
    { type: 'TaskStarted', backlogId: 'BL-500', payload: { title: 'a fine feature', notes: 'the notes', firstAcceptanceStep: 'the first step' } },
  ]);
});

test('BL-322: a TaskStarted event with no resolved summary still emits payload {} (degraded, never a crash)', () => {
  const prev = snapshot();
  const curr = snapshot({ backlog: { active: ['BL-500'], paused: [], done: [] }, ticketSummaries: {} });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [{ type: 'TaskStarted', backlogId: 'BL-500', payload: {} }]);
});

test('typed-events-01: a role whose gate newly captures maps to its currently-held BL-### and emits NeedsApproval', () => {
  const prev = snapshot({ gates: [{ role: 'coder', gated: false }] });
  const curr = snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: { coder: 'BL-500' } });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [{ type: 'NeedsApproval', backlogId: 'BL-500', payload: {} }]);
});

test('BL-325: a captured gate carrying a snippet puts it into the NeedsApproval payload', () => {
  const prev = snapshot({ gates: [{ role: 'coder', gated: false }] });
  const curr = snapshot({
    gates: [{ role: 'coder', gated: true, snippet: 'Proceed with the migration? (y/n)' }],
    roleTicket: { coder: 'BL-500' },
  });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [
    { type: 'NeedsApproval', backlogId: 'BL-500', payload: { snippet: 'Proceed with the migration? (y/n)' } },
  ]);
});

test('BL-325: a captured gate with no snippet still emits payload {} (regression)', () => {
  const prev = snapshot({ gates: [{ role: 'coder', gated: false }] });
  const curr = snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: { coder: 'BL-500' } });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [{ type: 'NeedsApproval', backlogId: 'BL-500', payload: {} }]);
});

test('typed-events-01: a backlog item newly in the done folder emits TaskCompleted tagged with it', () => {
  const prev = snapshot();
  const curr = snapshot({ backlog: { active: [], paused: [], done: ['BL-500'] } });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [{ type: 'TaskCompleted', backlogId: 'BL-500', payload: {} }]);
});

// ── untagged gate (BL-358) ─────────────────────────────────────────────────

test('BL-358: a captured gate for a role holding no ticket emits an untagged NeedsApproval (backlogId null, role set)', () => {
  const prev = snapshot({ gates: [{ role: 'coder', gated: false }] });
  const curr = snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: {} });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [{ type: 'NeedsApproval', backlogId: null, role: 'coder', payload: {} }]);
});

test('BL-358: an untagged captured gate still carries its snippet', () => {
  const prev = snapshot({ gates: [{ role: 'specifier', gated: false }] });
  const curr = snapshot({
    gates: [{ role: 'specifier', gated: true, snippet: 'Which design should I pick? (1/2/3)' }],
    roleTicket: {},
  });
  const events = deriveSwarmEvents(prev, curr);
  assert.deepEqual(events, [
    { type: 'NeedsApproval', backlogId: null, role: 'specifier', payload: { snippet: 'Which design should I pick? (1/2/3)' } },
  ]);
});

test('BL-358: an untagged gate that stays captured across two polls only emits once', () => {
  const gated = snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: {} });
  assert.deepEqual(deriveSwarmEvents(gated, gated), []);
});

test('BL-358: an untagged gate is dedup-keyed per role, distinct from a tagged event and from other roles', () => {
  const a = { type: 'NeedsApproval', backlogId: null, role: 'coder', payload: {} };
  const b = { type: 'NeedsApproval', backlogId: null, role: 'coder', payload: { snippet: 'different' } };
  const c = { type: 'NeedsApproval', backlogId: null, role: 'cleaner', payload: {} };
  const d = { type: 'NeedsApproval', backlogId: 'BL-500', payload: {} };
  assert.equal(swarmEventKey(a), swarmEventKey(b));
  assert.notEqual(swarmEventKey(a), swarmEventKey(c));
  assert.notEqual(swarmEventKey(a), swarmEventKey(d));
});

test('BL-358: an untagged gate is idempotent via the durable prior-emitted set, same as a tagged one', () => {
  const curr = snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: {} });
  const first = deriveSwarmEvents(null, curr);
  assert.deepEqual(first, [{ type: 'NeedsApproval', backlogId: null, role: 'coder', payload: {} }]);

  const alreadyEmitted = new Set(first.map(swarmEventKey));
  const second = deriveSwarmEvents(null, curr, alreadyEmitted);
  assert.deepEqual(second, []);
});

// ── no-real-transition guards ─────────────────────────────────────────────

test('deriving from an unchanged snapshot emits nothing', () => {
  const state = snapshot({ backlog: { active: ['BL-500'], paused: [], done: [] } });
  assert.deepEqual(deriveSwarmEvents(state, state), []);
});

test('a gate that stays captured across two polls only emits once (on the false -> true transition)', () => {
  const gated = snapshot({ gates: [{ role: 'coder', gated: true }], roleTicket: { coder: 'BL-500' } });
  assert.deepEqual(deriveSwarmEvents(gated, gated), []);
});

test('a null prior snapshot is treated as an empty baseline (no restart burst is assumed here - that is alreadyEmitted\'s job)', () => {
  const curr = snapshot({ backlog: { active: ['BL-500'], paused: [], done: [] } });
  assert.deepEqual(deriveSwarmEvents(null, curr), [{ type: 'TaskStarted', backlogId: 'BL-500', payload: {} }]);
});

// ── typed-events-02: Telegram-agnostic hard contract ──────────────────────

test('typed-events-02: an emitted event names only its type and backlog item, nothing Telegram/topic-shaped', () => {
  const prev = snapshot();
  const curr = snapshot({ backlog: { active: ['BL-500'], paused: [], done: [] } });
  const [event] = deriveSwarmEvents(prev, curr);
  assert.deepEqual(Object.keys(event).sort(), ['backlogId', 'payload', 'type']);
  const serialized = JSON.stringify(event);
  assert.equal(/telegram|topic|message_thread_id/i.test(serialized), false);
});

test('typed-events-02: the emitting module never references Telegram - the swarm never knows Telegram exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'events', 'swarmEventStream.ts'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/telegram/i.test(code), false);
});

// ── typed-events-03: idempotency via a persisted prior-emitted set ────────

test('typed-events-03: an event already in the prior-emitted set is not emitted again on re-derivation', () => {
  const curr = snapshot({ backlog: { active: ['BL-500'], paused: [], done: [] } });
  const first = deriveSwarmEvents(null, curr);
  assert.deepEqual(first, [{ type: 'TaskStarted', backlogId: 'BL-500', payload: {} }]);

  const alreadyEmitted = new Set(first.map(swarmEventKey));
  const second = deriveSwarmEvents(null, curr, alreadyEmitted);
  assert.deepEqual(second, []);
});

test('swarmEventKey is stable for the same (type, backlogId) and distinct across types/ids', () => {
  const a = { type: 'TaskStarted', backlogId: 'BL-500', payload: {} };
  const b = { type: 'TaskStarted', backlogId: 'BL-500', payload: { extra: true } };
  const c = { type: 'TaskCompleted', backlogId: 'BL-500', payload: {} };
  const d = { type: 'TaskStarted', backlogId: 'BL-501', payload: {} };
  assert.equal(swarmEventKey(a), swarmEventKey(b));
  assert.notEqual(swarmEventKey(a), swarmEventKey(c));
  assert.notEqual(swarmEventKey(a), swarmEventKey(d));
});
