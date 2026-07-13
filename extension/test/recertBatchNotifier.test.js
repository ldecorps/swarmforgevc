const assert = require('node:assert/strict');
const { decideRecertAnnouncement, buildRecertAnnouncementText } = require('../out/notify/recertBatchNotifier');

// ── decideRecertAnnouncement (BL-339 scope items 1/3/4, and -06) ─────────

test('BL-339: a first-ever waiting batch is announced and its ids are remembered', () => {
  const decision = decideRecertAnnouncement(['BL-100/s1', 'BL-100/s2'], []);
  assert.equal(decision.shouldAnnounce, true);
  assert.deepEqual(decision.nextAnnouncedIds.sort(), ['BL-100/s1', 'BL-100/s2']);
});

test('BL-339: the SAME outstanding batch is not re-announced on every tick (no spam)', () => {
  const decision = decideRecertAnnouncement(['BL-100/s1'], ['BL-100/s1']);
  assert.equal(decision.shouldAnnounce, false);
  assert.deepEqual(decision.nextAnnouncedIds, ['BL-100/s1']);
});

test('the same batch in a DIFFERENT array order is still recognized as unchanged - no re-announce', () => {
  const decision = decideRecertAnnouncement(['b', 'a'], ['a', 'b']);
  assert.equal(decision.shouldAnnounce, false);
});

test('BL-339: an emptied pool never announces, and clears the remembered ids', () => {
  const decision = decideRecertAnnouncement([], ['BL-100/s1']);
  assert.equal(decision.shouldAnnounce, false);
  assert.deepEqual(decision.nextAnnouncedIds, []);
});

test('BL-339: no batch, never announced - stays quiet (never fabricates an announcement)', () => {
  const decision = decideRecertAnnouncement([], []);
  assert.equal(decision.shouldAnnounce, false);
  assert.deepEqual(decision.nextAnnouncedIds, []);
});

test('recert-notify-deep-link-06: a genuinely NEW batch (different ids) after the prior one is announced again, even without the pool ever emptying', () => {
  // selectForRecertification never truly empties the pool - answering the
  // current batch just rotates the NEXT scenario to the front, so the
  // batch SIZE can stay identical while its IDENTITY changes. This must
  // still be recognized as a new batch worth announcing.
  const decision = decideRecertAnnouncement(['BL-200/s1'], ['BL-100/s1']);
  assert.equal(decision.shouldAnnounce, true);
  assert.deepEqual(decision.nextAnnouncedIds, ['BL-200/s1']);
});

test('a batch that clears and returns is announced again (re-arms on the next edge)', () => {
  let decision = decideRecertAnnouncement(['BL-100/s1'], []);
  assert.equal(decision.shouldAnnounce, true);
  decision = decideRecertAnnouncement([], decision.nextAnnouncedIds);
  assert.deepEqual(decision.nextAnnouncedIds, []);
  decision = decideRecertAnnouncement(['BL-300/s1'], decision.nextAnnouncedIds);
  assert.equal(decision.shouldAnnounce, true);
});

// ── buildRecertAnnouncementText (one message per batch, not per scenario) ─

test('BL-339: the text names the batch COUNT, not each scenario individually', () => {
  const text = buildRecertAnnouncementText(17, null);
  assert.match(text, /17 recert scenarios/);
  assert.equal(text.split('\n').length <= 2, true, 'a 17-scenario batch must still be ONE short message, not 17 lines');
});

test('the text uses singular phrasing for exactly one scenario', () => {
  const text = buildRecertAnnouncementText(1, null);
  assert.match(text, /1 recert scenario waiting/);
});

test('the deep link, when present, is included in the announcement text', () => {
  const text = buildRecertAnnouncementText(2, 'https://example.github.io/app/#recert=1');
  assert.match(text, /https:\/\/example\.github\.io\/app\/#recert=1/);
});

test('a missing deep link (no pwa_base_url configured) still produces a valid announcement, just without a link', () => {
  const text = buildRecertAnnouncementText(2, null);
  assert.match(text, /2 recert scenarios waiting for your review\.$/);
});
