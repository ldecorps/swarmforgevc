'use strict';

// BL-636: mono-router rotation preference orders by handoff priority.
// Drives REAL mono_router_lib.bb pure functions via `bb -e` for ordering
// scenarios, and the REAL handoffd.bb --print-preferred-rotate-target /
// wiring shell test for role-mail-row feeding :best-priority (the BL-576
// F1 anti-pattern of hand-building score rows alone is insufficient).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const WIRING = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_priority_rotate_wiring.sh');
const FEATURE = 'mono-router rotation preference orders by handoff priority, not only recency';

class Raw {
  constructor(text) { this.text = text; }
}
function raw(text) { return new Raw(text); }
function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (v instanceof Raw) return v.text;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`unsupported clj value: ${v}`);
}
function cljMap(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `:${k} ${cljVal(v)}`);
  return `{${parts.join(' ')}}`;
}

function bbEval(expr) {
  const code = `(load-file "${LIB}") (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function parsePri(s) {
  return Number(bbEval(`(mono-router-lib/parse-priority-rank ${cljVal(s)})`));
}

function ensureState(ctx) {
  if (!ctx.bl636) ctx.bl636 = { rows: [], pack: null };
  return ctx.bl636;
}

function upsertRow(ctx, role, fields) {
  const st = ensureState(ctx);
  const idx = st.rows.findIndex((r) => r.role === role);
  const base = idx >= 0 ? st.rows[idx] : { role, 'newest-created-at': '2026-07-25T10:00:00Z', 'actionable?': true };
  const next = { ...base, ...fields, role };
  if (idx >= 0) st.rows[idx] = next;
  else st.rows.push(next);
}

function computePreferred(ctx) {
  const st = ensureState(ctx);
  const rowsClj = `[${st.rows.map((r) => cljMap(r)).join(' ')}]`;
  const preferred = bbEval(`(mono-router-lib/preferred-rotate-target ${rowsClj})`);
  // pr-str of a string is quoted; nil prints as nil
  st.preferred = preferred === 'nil' ? null : JSON.parse(preferred);
  return st.preferred;
}

function ensureWiring(ctx) {
  const st = ensureState(ctx);
  if (st.wiring) return st.wiring;
  const result = spawnSync('bash', [WIRING], { encoding: 'utf8' });
  st.wiring = {
    status: result.status,
    out: `${result.stdout || ''}${result.stderr || ''}`,
  };
  if (st.wiring.status !== 0) {
    throw new Error(`priority rotate wiring test failed:\n${st.wiring.out}`);
  }
  return st.wiring;
}

function registerSteps(registry) {
  registry.defineScoped(/^a mono-router pack with config rotation router$/, (ctx) => {
    ensureState(ctx).pack = 'mono-router';
  }, FEATURE);

  // ── Scenario 01 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^role "([^"]+)" has actionable mail whose best priority is "([^"]+)"$/, (ctx, role, pri) => {
    upsertRow(ctx, role, {
      'best-priority': parsePri(pri),
      'newest-created-at': '2026-07-25T10:00:00Z',
      'actionable?': true,
    });
  }, FEATURE);

  registry.defineScoped(/^role "([^"]+)" has newer actionable mail whose best priority is "([^"]+)"$/, (ctx, role, pri) => {
    upsertRow(ctx, role, {
      'best-priority': parsePri(pri),
      'newest-created-at': '2026-07-25T12:30:00Z',
      'actionable?': true,
    });
  }, FEATURE);

  // ── Scenario 02 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^role "([^"]+)" and role "([^"]+)" both have actionable mail at priority "([^"]+)"$/, (ctx, a, b, pri) => {
    const rank = parsePri(pri);
    upsertRow(ctx, a, { 'best-priority': rank, 'newest-created-at': '2026-07-25T10:00:00Z', 'actionable?': true });
    upsertRow(ctx, b, { 'best-priority': rank, 'newest-created-at': '2026-07-25T10:00:00Z', 'actionable?': true });
  }, FEATURE);

  registry.defineScoped(/^role "([^"]+)" holds the newer parcel$/, (ctx, role) => {
    upsertRow(ctx, role, { 'newest-created-at': '2026-07-25T11:00:00Z' });
  }, FEATURE);

  // ── Scenario 03 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^role "([^"]+)" holds actionable mail at priority "([^"]+)" and a newer parcel at priority "([^"]+)"$/, (ctx, role, best, _newer) => {
    // preferred-rotate-target sees the role's already-computed best-priority;
    // role-mail-row's min-over-parcels is covered by the wiring shell test.
    upsertRow(ctx, role, {
      'best-priority': parsePri(best),
      'newest-created-at': '2026-07-25T12:00:00Z',
      'actionable?': true,
    });
    ensureState(ctx).bestNotNewest = { role, best, newer: _newer };
  }, FEATURE);

  registry.defineScoped(/^role "([^"]+)" holds actionable mail at priority "([^"]+)"$/, (ctx, role, pri) => {
    upsertRow(ctx, role, {
      'best-priority': parsePri(pri),
      'newest-created-at': '2026-07-25T11:00:00Z',
      'actionable?': true,
    });
  }, FEATURE);

  // ── Scenario 04 ─────────────────────────────────────────────────────────
  registry.defineScoped(/^role "([^"]+)" has actionable mail with no parseable priority$/, (ctx, role) => {
    const missing = Number(bbEval('mono-router-lib/missing-priority-rank'));
    upsertRow(ctx, role, {
      'best-priority': missing,
      'newest-created-at': '2026-07-25T12:00:00Z',
      'actionable?': true,
    });
    ensureState(ctx).missingPriorityRole = role;
  }, FEATURE);

  registry.defineScoped(/^role "([^"]+)" has actionable mail at priority "([^"]+)"$/, (ctx, role, pri) => {
    upsertRow(ctx, role, {
      'best-priority': parsePri(pri),
      'newest-created-at': '2026-07-25T10:00:00Z',
      'actionable?': true,
    });
  }, FEATURE);

  // ── shared When / Then for 01-04 ────────────────────────────────────────
  registry.defineScoped(/^the rotation target is computed$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.pack === 'mono-router' && st.rows.length > 0) {
      computePreferred(ctx);
    }
    // Also exercise the real role-mail-row wiring once per feature run.
    ensureWiring(ctx);
  }, FEATURE);

  registry.defineScoped(/^"([^"]+)" is selected$/, (ctx, role) => {
    const st = ensureState(ctx);
    if (st.preferred !== role) {
      throw new Error(`expected preferred-rotate-target "${role}", got "${st.preferred}"`);
    }
  }, FEATURE);

  registry.defineScoped(/^"([^"]+)" is not selected on the strength of its missing priority$/, (ctx, role) => {
    const st = ensureState(ctx);
    if (st.preferred === role) {
      throw new Error(`role "${role}" was selected despite missing priority`);
    }
  }, FEATURE);

  // ── Scenario 05: full-forge unaffected ──────────────────────────────────
  registry.defineScoped(/^a full-forge pack where every role is its own standing process$/, (ctx) => {
    ensureState(ctx).pack = 'full-forge';
  }, FEATURE);

  registry.defineScoped(/^rotation preference logic would apply$/, (ctx) => {
    const st = ensureState(ctx);
    // Outside rotation router there is no shared resident to allocate.
    const router = bbEval('(mono-router-lib/conf-rotation-router? "config rotation sequential\\n")');
    if (router !== 'false') {
      throw new Error(`expected conf-rotation-router? false for non-router conf, got ${router}`);
    }
    const src = fs.readFileSync(HANDOFFD, 'utf8');
    if (!src.includes('(rotation-router-mode?)')) {
      throw new Error('handoffd.bb no longer gates on rotation-router-mode?');
    }
    // :rotate chase action only allocates the shared resident; classic packs
    // respawn their own panes instead (resident-poke-target? false).
    st.fullForgeChecked = true;
  }, FEATURE);

  registry.defineScoped(/^no shared-resident allocation decision is made$/, (ctx) => {
    if (!ensureState(ctx).fullForgeChecked) {
      throw new Error('full-forge rotation preference check did not run');
    }
    // Conf without "config rotation router" must not look like mono-router.
    const isRouter = bbEval('(mono-router-lib/conf-rotation-router? "window coder claude coder\\n")');
    if (isRouter !== 'false') {
      throw new Error('non-router conf unexpectedly detected as rotation router');
    }
  }, FEATURE);

  // ── Scenario 06: aged-note gate unchanged ───────────────────────────────
  registry.defineScoped(/^a fresh priority-00 note broadcast to a dormant role$/, (ctx) => {
    const nowMs = Date.parse('2026-07-25T12:00:00Z');
    const freshAt = new Date(nowMs - 2 * 60000).toISOString();
    const aged = bbEval(`(mono-router-lib/note-aged? ${cljMap({
      'enqueued-at': freshAt,
      'created-at': freshAt,
      'now-ms': nowMs,
      'threshold-ms': raw('mono-router-lib/default-note-actionable-after-ms'),
    })})`);
    ensureState(ctx).freshNoteAged = aged === 'true';
    ensureState(ctx).dormantRole = 'specifier';
  }, FEATURE);

  registry.defineScoped(/^the note is younger than note_actionable_after_ms$/, (ctx) => {
    if (ensureState(ctx).freshNoteAged) {
      throw new Error('fresh note unexpectedly counted as aged');
    }
  }, FEATURE);

  registry.defineScoped(/^the dormant role is not selected until the note ages into actionable$/, (ctx) => {
    const st = ensureState(ctx);
    // Fresh note does not make the role actionable.
    const actionable = bbEval(`(mono-router-lib/actionable-mail? ${cljMap({
      'in-process-count': 0,
      'git-handoff-count': 0,
      'aged-note-count': 0,
    })})`);
    if (actionable !== 'false') {
      throw new Error('empty/fresh-note mailbox must not be actionable');
    }
    // Priority alone must not flip actionability — wiring scenario C proves
    // role-mail-row still filters fresh notes out of the candidate set.
    ensureWiring(ctx);
    if (!st.wiring.out.includes('PASS: C:')) {
      throw new Error(`wiring test missing aged-note gate scenario C:\n${st.wiring.out}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
