'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { EPIC_ICON_POOL, resolveEpicIcon, isKnownEpic } = require('../out/concierge/epicIcon');
const { FORUM_TOPIC_ICON_STICKER_SET } = require('../out/concierge/forumTopicIconStickerSet');
const { ICON_EMOJI, STANDING_TOPIC_ICON, ROLE_TOPIC_ICON } = require('../out/concierge/topicIcon');

// BL-946 declared invariants (property authorship rests with the coder,
// first pass - BL-654).
//
// Invariants 1 and 2 quantify over the POOL - a finite, committed constant -
// so they are checked EXHAUSTIVELY over every member rather than sampled:
// exhaustive coverage of the whole quantified domain is strictly stronger
// than any generator over it. Invariant 3 quantifies over arbitrary epic ids
// and assignment states and is generative (fast-check), with the exhausted
// pool - the deep state the graceful-reuse tail exists for - drawn by
// CONSTRUCTION in about a third of runs, never left astronomically rare.

// ── Invariant 1: every pool member is present in the (snapshot of the)
//    live getForumTopicIconStickers set. An absent glyph fails SILENTLY in
//    production (syncTopicIcon returns skipped-unresolved-icon), so this
//    gate is the committed-data half; qa_e2e step 5 confirms the same
//    membership against the LIVE set with the bot token. ─────────────────
test('BL-946 invariant 1 (exhaustive): every EPIC_ICON_POOL member is in the committed live-set snapshot', () => {
  const live = new Set(FORUM_TOPIC_ICON_STICKER_SET);
  for (const glyph of EPIC_ICON_POOL) {
    assert.ok(live.has(glyph), `pool glyph ${glyph} is not in the sticker-set snapshot - it would fail silently in production`);
  }
});

// ── Invariant 2: the pool is disjoint from the values of every other icon
//    table, and carries no badge-size read-alike of theirs. KNOWN_EPIC_ICON
//    pins are pool members by design (the deliberate exception) - they
//    appear in no other table, so disjointness still holds. ───────────────
test('BL-946 invariant 2 (exhaustive): EPIC_ICON_POOL is disjoint from ICON_EMOJI, STANDING_TOPIC_ICON and ROLE_TOPIC_ICON, and excludes their badge-size read-alikes', () => {
  const reserved = new Map();
  for (const [k, v] of Object.entries(ICON_EMOJI)) reserved.set(v, `ICON_EMOJI.${k}`);
  for (const [k, v] of Object.entries(STANDING_TOPIC_ICON)) reserved.set(v, `STANDING_TOPIC_ICON['${k}']`);
  for (const [k, v] of Object.entries(ROLE_TOPIC_ICON)) reserved.set(v, `ROLE_TOPIC_ICON.${k}`);
  for (const glyph of EPIC_ICON_POOL) {
    assert.ok(!reserved.has(glyph), `pool glyph ${glyph} collides with ${reserved.get(glyph)}`);
  }
  // The known badge-size read-alike of a reserved glyph: 🎶 reads as 🎵
  // (ICON_EMOJI.feature) at badge size.
  assert.ok(!EPIC_ICON_POOL.includes('🎶'), 'the musical-notes read-alike of the feature icon must stay excluded');
});

// ── Invariant 3: resolveEpicIcon stays pure and total - no I/O, never
//    throws, still returns a usable (pool-member) icon when the pool is
//    exhausted, and is deterministic for identical inputs. ────────────────
const poolMember = new Set(EPIC_ICON_POOL);

// Object.prototype member names drawn BY CONSTRUCTION (bounce D2): a bare
// table lookup resolves these to an inherited function/object, and leaving
// them to fc.string made the gate fire only on a lucky seed - the exact
// shape BL-654 names (a live defect a property can pass hundreds of runs
// against). A reach floor below asserts the arm is actually common.
const PROTOTYPE_EPIC_IDS = ['valueOf', 'toString', 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__'];

const epicIdArb = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
  fc.constant(''),
  fc.constant('role-benchmarking'),
  fc.constant('dynamic-routing'),
  fc.constant('onboarding-target-repo'),
  fc.constantFrom(...PROTOTYPE_EPIC_IDS)
);

// Assignment states: arbitrary subsets of the pool, junk strings that were
// never pool icons, and - weighted in by construction - the FULLY exhausted
// pool, so the graceful-reuse tail is a common draw, never a rare one.
const assignedArb = fc.oneof(
  { arbitrary: fc.constant([...EPIC_ICON_POOL]), weight: 1 },
  { arbitrary: fc.shuffledSubarray([...EPIC_ICON_POOL]), weight: 1 },
  {
    arbitrary: fc.array(fc.oneof(fc.constantFrom(...EPIC_ICON_POOL), fc.string({ unit: 'grapheme', maxLength: 4 })), { maxLength: 120 }),
    weight: 1,
  }
);

test('BL-946 invariant 3 (property): resolveEpicIcon never throws, always returns a pool member, and is deterministic - for any epic id and any assignment state, exhausted pool included', () => {
  let exhaustedDraws = 0;
  let prototypeIdDraws = 0;
  fc.assert(
    fc.property(epicIdArb, assignedArb, (epicId, assigned) => {
      if (EPIC_ICON_POOL.every((g) => assigned.includes(g))) exhaustedDraws += 1;
      if (PROTOTYPE_EPIC_IDS.includes(epicId)) prototypeIdDraws += 1;
      const first = resolveEpicIcon(epicId, assigned);
      const second = resolveEpicIcon(epicId, assigned);
      assert.equal(typeof first, 'string');
      assert.ok(poolMember.has(first), `expected a usable pool icon, got ${JSON.stringify(first)}`);
      assert.equal(first, second, 'purity proxy: identical inputs must resolve identically');
      if (isKnownEpic(epicId)) {
        assert.equal(first, resolveEpicIcon(epicId, []), 'a pinned epic resolves the same regardless of assignment state');
      }
    }),
    { numRuns: 300 }
  );
  // Generator-reach floors (BL-654): the exhausted state and the
  // prototype-named ids must actually be common, not merely reachable.
  assert.ok(exhaustedDraws >= 30, `exhausted-pool draws must be common by construction, got ${exhaustedDraws}/300`);
  assert.ok(prototypeIdDraws >= 20, `prototype-named-id draws must be common by construction, got ${prototypeIdDraws}/300`);
});
