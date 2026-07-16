const assert = require('node:assert/strict');
const { EPIC_ICON_POOL, resolveEpicIcon } = require('../out/concierge/epicIcon');
const { ICON_EMOJI, STANDING_TOPIC_ICON } = require('../out/concierge/topicIcon');

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
