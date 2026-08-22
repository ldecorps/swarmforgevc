const assert = require('node:assert/strict');
const { EPIC_ICON_POOL, resolveEpicIcon } = require('../out/concierge/epicIcon');
const { FORUM_TOPIC_ICON_STICKER_SET } = require('../out/concierge/forumTopicIconStickerSet');
const { ICON_EMOJI, STANDING_TOPIC_ICON, ROLE_TOPIC_ICON } = require('../out/concierge/topicIcon');

// BL-449: epic topics are a distinct icon-assignment path from the
// ticket-state sync in topicIcon.ts - the three seeded epics (Swarm Role
// Benchmarking, Dynamic Routing, Onboarding a New Target Repo) get finalised
// glyphs, and any further epic is auto-assigned the next distinct icon from
// an ordered musical-form pool.

// ── epic-icon-assignment-01: each seeded epic resolves to its finalised icon ──

test('resolveEpicIcon: role-benchmarking resolves to the microphone', () => {
  assert.equal(resolveEpicIcon('role-benchmarking'), '🎙');
});

test('resolveEpicIcon: dynamic-routing resolves to the masks', () => {
  assert.equal(resolveEpicIcon('dynamic-routing'), '🎭');
});

test('resolveEpicIcon: onboarding-target-repo resolves to the clapperboard', () => {
  assert.equal(resolveEpicIcon('onboarding-target-repo'), '🎬');
});

// A seeded epic's icon is fixed regardless of what else is already assigned
// - never displaced by the pool-assignment branch below.
test('resolveEpicIcon: a seeded epic keeps its fixed icon even when it collides with alreadyAssignedIcons', () => {
  assert.equal(resolveEpicIcon('role-benchmarking', ['🎙', '🎭', '🎬']), '🎙');
});

// BL-946 bounce D1: an epic id named after an Object.prototype member must
// resolve like any other UNKNOWN epic - a bare table lookup reaches the
// prototype and returns the inherited FUNCTION as the icon, which both live
// callers would pass straight to the Telegram API. Exhaustive over the
// prototype names (deterministic - never left to a lucky fast-check seed,
// bounce D2), plus '__proto__' whose inherited value is an object, not a
// function.
test('resolveEpicIcon: prototype-named epic ids resolve to a pool icon string, never an inherited prototype member', () => {
  const prototypeIds = ['valueOf', 'toString', 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__'];
  for (const epicId of prototypeIds) {
    const icon = resolveEpicIcon(epicId, []);
    assert.equal(typeof icon, 'string', `${epicId}: expected a string icon, got ${typeof icon}`);
    assert.ok(EPIC_ICON_POOL.includes(icon), `${epicId}: expected a pool member, got ${JSON.stringify(icon)}`);
    // Same table, same answer: the id is not a known epic, so it takes the
    // pool-assignment branch exactly as any other unknown id does.
    assert.equal(icon, resolveEpicIcon('some-ordinary-unknown-epic', []), `${epicId}: must resolve like any other unknown epic`);
  }
});

// ── epic-icon-new-topic-02: a new epic beyond the seeded set gets the next
//    distinct pool icon ──────────────────────────────────────────────────

test('resolveEpicIcon: an unseeded epic with no prior assignments gets the pool head', () => {
  assert.equal(resolveEpicIcon('fleet-second-swarm', []), '🎙');
});

test('resolveEpicIcon: an unseeded epic is assigned the next pool icon distinct from every already-assigned one', () => {
  assert.equal(resolveEpicIcon('fleet-second-swarm', ['🎙', '🎭', '🎬']), '🎤');
});

test('resolveEpicIcon: a second unseeded epic in the same pass gets a further distinct pool icon', () => {
  assert.equal(resolveEpicIcon('swarm-self-optimization', ['🎙', '🎭', '🎬', '🎤']), '🎨');
});

// Pool exhaustion: distinctness is best-effort, never a crash - gracefully
// reuses rather than throwing once every pool slot is taken.
test('resolveEpicIcon: gracefully reuses the last pool icon once every slot is already assigned, never throws', () => {
  const everySlotUsed = [...EPIC_ICON_POOL];
  assert.doesNotThrow(() => resolveEpicIcon('one-epic-too-many', everySlotUsed));
  assert.equal(resolveEpicIcon('one-epic-too-many', everySlotUsed), EPIC_ICON_POOL[EPIC_ICON_POOL.length - 1]);
});

// ── epic-icon-disjoint-03: the epic pool never collides with the
//    ticket-state or standing-topic icons already in use ──────────────────

test('EPIC_ICON_POOL is disjoint from ICON_EMOJI (the ticket-state icons)', () => {
  const ticketStateIcons = new Set(Object.values(ICON_EMOJI));
  for (const icon of EPIC_ICON_POOL) {
    assert.ok(!ticketStateIcons.has(icon), `expected the epic pool to never collide with the ticket-state icon "${icon}"`);
  }
});

test('EPIC_ICON_POOL is disjoint from STANDING_TOPIC_ICON', () => {
  const standingIcons = new Set(Object.values(STANDING_TOPIC_ICON));
  for (const icon of EPIC_ICON_POOL) {
    assert.ok(!standingIcons.has(icon), `expected the epic pool to never collide with the standing-topic icon "${icon}"`);
  }
});

// BL-449 notes: 🎶 is deliberately excluded (reads as 🎵, the feature-in-
// flight icon, at badge size) - a direct regression guard for that call.
test('EPIC_ICON_POOL excludes the musical-notes emoji (badge-collision with the feature-in-flight icon)', () => {
  assert.ok(!EPIC_ICON_POOL.includes('🎶'));
});

test('EPIC_ICON_POOL has no internal duplicates', () => {
  assert.equal(new Set(EPIC_ICON_POOL).size, EPIC_ICON_POOL.length);
});

// ── BL-946: the pool draws from the whole stock set ──────────────────────

test('EPIC_ICON_POOL holds at least 60 icons (39 live epics today, with headroom)', () => {
  assert.ok(EPIC_ICON_POOL.length >= 60, `expected >= 60 pool icons, got ${EPIC_ICON_POOL.length}`);
});

test('EPIC_ICON_POOL is disjoint from ROLE_TOPIC_ICON', () => {
  const roleIcons = new Set(Object.values(ROLE_TOPIC_ICON));
  for (const icon of EPIC_ICON_POOL) {
    assert.ok(!roleIcons.has(icon), `expected the epic pool to never collide with the role-topic icon "${icon}"`);
  }
});

test('every EPIC_ICON_POOL member is in the committed sticker-set snapshot (an absent glyph fails silently in production)', () => {
  const live = new Set(FORUM_TOPIC_ICON_STICKER_SET);
  for (const icon of EPIC_ICON_POOL) {
    assert.ok(live.has(icon), `pool glyph "${icon}" is not in the snapshot`);
  }
});

test('the original 10 glyphs stay as the pool order prefix, so already-assigned epics keep their badges', () => {
  assert.deepEqual(EPIC_ICON_POOL.slice(0, 10), ['🎙', '🎭', '🎬', '🎤', '🎨', '🎩', '🕺', '💃', '✍️', '📚']);
});
