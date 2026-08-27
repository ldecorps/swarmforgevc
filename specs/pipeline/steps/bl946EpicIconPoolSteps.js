'use strict';

// BL-946: step handlers for "Epic topic icons draw from the whole stock
// sticker set". Drives the REAL compiled epicIcon.ts/topicIcon.ts modules
// (extension/out/) - the pool under test is the derived production constant,
// never a re-declaration of it.

const assert = require('node:assert/strict');

const { EPIC_ICON_POOL, resolveEpicIcon } = require('../../../extension/out/concierge/epicIcon');
const {
  ICON_EMOJI,
  STANDING_TOPIC_ICON,
  ROLE_TOPIC_ICON,
} = require('../../../extension/out/concierge/topicIcon');

const FEATURE = 'Epic topic icons draw from the whole stock sticker set';

// Scenario Outline <table> values validated against an explicit lookup
// (engineering.prompt's Outline rule) - never a bare passthrough.
const TABLE_EXAMPLES = {
  ICON_EMOJI: () => ICON_EMOJI,
  STANDING_TOPIC_ICON: () => STANDING_TOPIC_ICON,
  ROLE_TOPIC_ICON: () => ROLE_TOPIC_ICON,
};

function knownTable(token) {
  if (!Object.prototype.hasOwnProperty.call(TABLE_EXAMPLES, token)) {
    throw new Error(`unknown <table> token: ${token}`);
  }
  return TABLE_EXAMPLES[token]();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^the epic icon pool$/, (ctx) => {
    ctx.pool = EPIC_ICON_POOL;
  });

  scoped(/^the reserved icon tables ICON_EMOJI, STANDING_TOPIC_ICON and ROLE_TOPIC_ICON$/, (ctx) => {
    ctx.tables = { ICON_EMOJI, STANDING_TOPIC_ICON, ROLE_TOPIC_ICON };
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^the pool size is measured$/, (ctx) => {
    ctx.size = ctx.pool.length;
  });

  scoped(/^it holds at least 60 icons$/, (ctx) => {
    assert.ok(ctx.size >= 60, `expected the pool to hold >= 60 icons, got ${ctx.size}`);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^the pool is checked for repeats$/, (ctx) => {
    const counts = new Map();
    for (const glyph of ctx.pool) counts.set(glyph, (counts.get(glyph) ?? 0) + 1);
    ctx.repeated = [...counts.entries()].filter(([, n]) => n > 1).map(([g, n]) => `${g} x${n}`);
  });

  scoped(/^every entry appears exactly once$/, (ctx) => {
    assert.deepEqual(ctx.repeated, [], `expected no repeated pool glyphs, got: ${ctx.repeated.join(', ')}`);
  });

  // ── Scenario 03 (Outline) ─────────────────────────────────────────────────
  scoped(/^the pool is compared against (\S+)$/, (ctx, token) => {
    const table = knownTable(token);
    const reserved = new Set(Object.values(table));
    ctx.tableName = token;
    ctx.overlap = ctx.pool.filter((glyph) => reserved.has(glyph));
  });

  scoped(/^no glyph appears in both$/, (ctx) => {
    assert.deepEqual(
      ctx.overlap,
      [],
      `expected the pool to be disjoint from ${ctx.tableName}, colliding glyphs: ${ctx.overlap.join(' ')}`
    );
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────────
  scoped(/^39 distinct epic ids$/, (ctx) => {
    ctx.epicIds = Array.from({ length: 39 }, (_, i) => `epic-${i + 1}`);
    assert.equal(new Set(ctx.epicIds).size, 39, 'fixture sanity: the 39 ids must be distinct');
  });

  scoped(/^each is resolved in one pass, threading the already-assigned icons$/, (ctx) => {
    const assigned = [];
    ctx.assignments = ctx.epicIds.map((id) => {
      const icon = resolveEpicIcon(id, assigned);
      assigned.push(icon);
      return icon;
    });
  });

  scoped(/^all 39 receive different icons$/, (ctx) => {
    assert.equal(
      new Set(ctx.assignments).size,
      39,
      `expected 39 distinct icons, got ${new Set(ctx.assignments).size}: ${ctx.assignments.join(' ')}`
    );
  });

  scoped(/^no exhaustion reuse occurs$/, (ctx) => {
    const last = EPIC_ICON_POOL[EPIC_ICON_POOL.length - 1];
    const lastCount = ctx.assignments.filter((icon) => icon === last).length;
    assert.ok(lastCount <= 1, `the pool's last icon (the reuse fallback) was handed out ${lastCount} times - exhaustion fired`);
  });

  // ── Scenario 05 ───────────────────────────────────────────────────────────
  scoped(/^the epic id "role-benchmarking"$/, (ctx) => {
    ctx.epicId = 'role-benchmarking';
  });

  scoped(/^it is resolved after other epics have drained the pool$/, (ctx) => {
    ctx.resolved = resolveEpicIcon(ctx.epicId, [...EPIC_ICON_POOL]);
  });

  scoped(/^it receives its pinned glyph$/, (ctx) => {
    assert.equal(ctx.resolved, '🎙', `expected role-benchmarking's 2026-07-16 pinned glyph, got ${ctx.resolved}`);
  });

  // ── Scenario 06 ───────────────────────────────────────────────────────────
  scoped(/^every pool icon is already assigned$/, (ctx) => {
    ctx.assigned = [...EPIC_ICON_POOL];
  });

  scoped(/^an unknown epic id is resolved$/, (ctx) => {
    ctx.error = null;
    try {
      ctx.resolved = resolveEpicIcon('one-epic-too-many', ctx.assigned);
    } catch (err) {
      ctx.error = err;
    }
  });

  scoped(/^it receives the pool's last icon$/, (ctx) => {
    assert.equal(ctx.resolved, EPIC_ICON_POOL[EPIC_ICON_POOL.length - 1]);
  });

  scoped(/^no error is raised$/, (ctx) => {
    assert.equal(ctx.error, null, `expected no throw on exhaustion, got: ${ctx.error}`);
  });
}

module.exports = { registerSteps };
