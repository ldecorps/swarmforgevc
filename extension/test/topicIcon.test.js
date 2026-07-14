const assert = require('node:assert/strict');
const { ICON_EMOJI, resolveIconState, resolveIconStickerId } = require('../out/concierge/topicIcon');

// BL-342: pure icon-state resolution - the ticket's own convention:
// check = done/shipped; microbe = defect in flight; bulb = feature in
// flight; magnifier = paused/held. Folder membership is authoritative over
// the ticket's own `type:` field for done/paused (a paused bug still shows
// the magnifier, a shipped bug still shows the check) - only the
// active/in-flight case actually branches on type.

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
  assert.equal(ICON_EMOJI.feature, '💡');
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

test('resolveIconStickerId returns undefined for an emoji not present in the fetched set - never a hardcoded fallback', () => {
  assert.equal(resolveIconStickerId(STICKERS, '💡'), undefined);
});

test('resolveIconStickerId returns undefined for an empty sticker list', () => {
  assert.equal(resolveIconStickerId([], '✅'), undefined);
});
