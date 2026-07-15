const assert = require('node:assert/strict');
const { ICON_EMOJI, resolveIconState, resolveIconStickerId, STANDING_TOPIC_ICON } = require('../out/concierge/topicIcon');

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

test('ICON_EMOJI carries the exact emoji for each of the four states, per the convention', () => {
  assert.equal(ICON_EMOJI.done, '✅');
  assert.equal(ICON_EMOJI.defect, '🦠');
  assert.equal(ICON_EMOJI.feature, '🎵');
  assert.equal(ICON_EMOJI.paused, '🔍');
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
// office, the Operator topic is the opera house.

test('STANDING_TOPIC_ICON: support/intake resolves to the box-office ticket emoji', () => {
  assert.equal(STANDING_TOPIC_ICON['support/intake'], '🎟');
});

test('STANDING_TOPIC_ICON: operator resolves to the opera-house emoji', () => {
  assert.equal(STANDING_TOPIC_ICON.operator, '🏛');
});
