const assert = require('node:assert/strict');
const { ICON_EMOJI, resolveIconState, resolveIconStickerId, STANDING_TOPIC_ICON, ROLE_TOPIC_ICON } = require('../out/concierge/topicIcon');
const { EPIC_ICON_POOL } = require('../out/concierge/epicIcon');

// BL-342: pure icon-state resolution - the ticket's own convention:
// check = done/shipped; microbe = defect in flight; musical note (BL-417,
// was the bulb) = feature in flight; magnifier = paused/held. Folder
// membership is authoritative over the ticket's own `type:` field for
// done/paused (a paused bug still shows the magnifier, a shipped bug still
// shows the check) - only the active/in-flight case actually branches on
// type.

test('resolveIconState: a done ticket is always "done", regardless of type', () => {
  assert.equal(resolveIconState('done', 'bug'), 'done');
  assert.equal(resolveIconState('done', 'feature'), 'done');
  assert.equal(resolveIconState('done', undefined), 'done');
});

test('resolveIconState: a paused ticket is always "paused", regardless of type', () => {
  assert.equal(resolveIconState('paused', 'bug'), 'paused');
  assert.equal(resolveIconState('paused', 'feature'), 'paused');
});

test('resolveIconState: an active bug ticket is "defect"', () => {
  assert.equal(resolveIconState('active', 'bug'), 'defect');
});

test('resolveIconState: an active feature or chore ticket is "feature"', () => {
  assert.equal(resolveIconState('active', 'feature'), 'feature');
  assert.equal(resolveIconState('active', 'chore'), 'feature');
  assert.equal(resolveIconState('active', undefined), 'feature');
});

test('ICON_EMOJI carries the exact emoji for each of the five states, per the convention', () => {
  assert.equal(ICON_EMOJI.done, '✅');
  assert.equal(ICON_EMOJI.defect, '🦠');
  assert.equal(ICON_EMOJI.feature, '🎵');
  assert.equal(ICON_EMOJI.paused, '🔍');
  assert.equal(ICON_EMOJI['awaiting-approval'], '👀');
});

// ── BL-424 approval-icon-state-01: a paused ticket blocked ONLY on the
//    human's approval gets its own icon state, distinct from any other
//    paused hold ─────────────────────────────────────────────────────────

test('resolveIconState: a paused ticket with human_approval pending is "awaiting-approval"', () => {
  assert.equal(resolveIconState('paused', 'feature', 'pending'), 'awaiting-approval');
});

test('resolveIconState: a paused ticket that is approved keeps the plain "paused" state', () => {
  assert.equal(resolveIconState('paused', 'feature', 'approved'), 'paused');
});

test('resolveIconState: a paused ticket with no human_approval field at all keeps the plain "paused" state', () => {
  assert.equal(resolveIconState('paused', 'feature', undefined), 'paused');
});

// The "both branches true at once" engineering rule: an ACTIVE ticket with
// human_approval pending must stay "feature", proving the FOLDER gates the
// awaiting-approval state, not the approval field alone.
test('resolveIconState: an active ticket with human_approval pending is unaffected - the marker is paused-scoped', () => {
  assert.equal(resolveIconState('active', 'feature', 'pending'), 'feature');
  assert.equal(resolveIconState('active', 'bug', 'pending'), 'defect');
});

test('resolveIconState: a done ticket is unaffected by human_approval', () => {
  assert.equal(resolveIconState('done', 'feature', 'pending'), 'done');
});

// ── resolveIconStickerId (BL-342 scenario 06: validated against the REAL
//    Telegram-returned set, never a hardcoded id) ─────────────────────────

const STICKERS = [
  { emoji: '✅', customEmojiId: 'id-check' },
  { emoji: '🦠', customEmojiId: 'id-microbe' },
];

test('resolveIconStickerId returns the matching sticker\'s own id', () => {
  assert.equal(resolveIconStickerId(STICKERS, '✅'), 'id-check');
});

// BL-417 feature-topic-icon-musical-note-03: the musical note absent from
// the live sticker set resolves to undefined (skip), never a crash or a
// hardcoded fallback id.
test('resolveIconStickerId returns undefined for an emoji not present in the fetched set - never a hardcoded fallback', () => {
  assert.equal(resolveIconStickerId(STICKERS, '🎵'), undefined);
});

test('resolveIconStickerId returns undefined for an empty sticker list', () => {
  assert.equal(resolveIconStickerId([], '✅'), undefined);
});

// ── STANDING_TOPIC_ICON (BL-418 standing-topic-icons-01) ─────────────────
// The orchestra remap's harder half: the standing NON-ticket topics get
// their own icons, human-decided 2026-07-15 - support/intake is the box
// office, the Operator/Concierge topic is the bell (BL-453 rebrand).

test('STANDING_TOPIC_ICON: support/intake resolves to the box-office ticket emoji', () => {
  assert.equal(STANDING_TOPIC_ICON['support/intake'], '🎟');
});

// BL-453: supersedes the BL-418 opera-house choice for the Operator/Concierge
// standing topic with the human-chosen bell (🛎, "The bell is fine").
test('STANDING_TOPIC_ICON: operator resolves to the bell emoji (BL-453 Concierge rebrand)', () => {
  assert.equal(STANDING_TOPIC_ICON.operator, '🛎');
});

// BL-434: the standing Approvals topic's own icon.
test('STANDING_TOPIC_ICON: approvals resolves to the clipboard emoji', () => {
  assert.equal(STANDING_TOPIC_ICON.approvals, '📋');
});

// ── ROLE_TOPIC_ICON (BL-469 per-agent-steering-topic-icon) ───────────────
// Each of the 8 per-agent Telegram steering topics (BL-425) gets its own
// fixed, human-chosen icon (firm 2026-07-16 decision) so the human can tell
// the role topics apart at a glance - a THIRD table, distinct from
// ICON_EMOJI (ticket state) and STANDING_TOPIC_ICON (standing topics).

test('ROLE_TOPIC_ICON: carries the exact human-chosen icon for each of the 8 role topics', () => {
  assert.equal(ROLE_TOPIC_ICON.coordinator, '📣');
  assert.equal(ROLE_TOPIC_ICON.specifier, '📝');
  assert.equal(ROLE_TOPIC_ICON.architect, '🏛');
  assert.equal(ROLE_TOPIC_ICON.coder, '💻');
  assert.equal(ROLE_TOPIC_ICON.cleaner, '🧼');
  assert.equal(ROLE_TOPIC_ICON.hardender, '🧪');
  assert.equal(ROLE_TOPIC_ICON.QA, '🔎');
  assert.equal(ROLE_TOPIC_ICON.documenter, '📰');
});

// BL-469 2026-07-17 remap: the prior QA magnifier (🔍) collided with
// ICON_EMOJI.paused; the approved replacement (🔎) resolves it.
test('ROLE_TOPIC_ICON: QA no longer collides with the paused ticket-state icon', () => {
  assert.notEqual(ROLE_TOPIC_ICON.QA, ICON_EMOJI.paused);
});

// BL-469 2nd QA bounce (2026-07-17): the first remap's coordinator (🎬) and
// documenter (📚) collided with the live epic-icon pool - 🎬 is the
// onboarding-target-repo epic, 📚 is the pool's own tail slot. The amended
// mapping (coordinator 📣, documenter 📰) must not collide with ANY of the
// four live icon tables/pools, not just the two checked by the tests above.
test('ROLE_TOPIC_ICON: no role icon collides with the live epic-icon pool', () => {
  for (const [role, icon] of Object.entries(ROLE_TOPIC_ICON)) {
    assert.ok(!EPIC_ICON_POOL.includes(icon), `${role}'s icon ${icon} collides with EPIC_ICON_POOL`);
  }
});

test('ROLE_TOPIC_ICON: no role icon collides with ICON_EMOJI or STANDING_TOPIC_ICON', () => {
  const reserved = new Set([...Object.values(ICON_EMOJI), ...Object.values(STANDING_TOPIC_ICON)]);
  for (const [role, icon] of Object.entries(ROLE_TOPIC_ICON)) {
    assert.ok(!reserved.has(icon), `${role}'s icon ${icon} collides with ICON_EMOJI/STANDING_TOPIC_ICON`);
  }
});
