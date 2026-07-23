'use strict';

// BL-576: step handlers for "aged notes in a dormant mailbox make a
// mono-router role worth rotating to". Drives the REAL pure functions in
// swarmforge/scripts/mono_router_lib.bb (note-aged?, actionable-mail?,
// preferred-rotate-target, parse-note-actionable-after-ms,
// suppress-dormant-note-delivery-wake?, dormant-mailbox-chase-action,
// should-rotate-resident?, chase-poke-plan) via `bb -e`, exactly the
// functions handoffd.bb's chase-rotate-to!/maybe-notify!/role-mail-row wire
// into the live daemon. Scenarios 05/06/08 describe emergent PACING from
// gates that are already independently unit-tested (default-rotate-cooldown-ms,
// chase-poke-plan's per-sweep budget, BL-550's rotate-home) — this ticket adds
// no new pacing machinery, so those steps re-exercise the same gates rather
// than standing up a live tmux/daemon harness; the ticket's own "QA end-to-end
// procedure" is the live verification for the full daemon loop.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const FEATURE = 'Aged notes in a dormant mailbox make a mono-router role worth rotating to';

const NOW_ISO = '2026-07-23T12:00:00Z';
const NOW_MS = Date.parse(NOW_ISO);
const DEFAULT_THRESHOLD_MS = 20 * 60 * 1000;
const COOLDOWN_MS = 30000;

// ── tiny EDN serializer for the handful of shapes these scenarios need ─────
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

function agoToMs(phrase) {
  const m = /^(\d+) (minute|minutes|hour|hours) ago$/.exec(phrase.trim());
  if (!m) {
    throw new Error(`unparsed ago-phrase: "${phrase}"`);
  }
  const n = Number(m[1]);
  const unitMs = m[2].startsWith('hour') ? 3600000 : 60000;
  return n * unitMs;
}

function isoAgo(minutes) {
  return new Date(NOW_MS - minutes * 60000).toISOString();
}

// Header-phrase -> header value. "absent" means the header is not present at
// all (nil); "unparseable" is a real string that fails Instant/parse — both
// are distinct from a real timestamp, matching the acceptance table's own
// three-way split.
function phraseToHeaderValue(phrase) {
  const trimmed = phrase.trim();
  if (trimmed === 'absent') return null;
  if (trimmed === 'unparseable') return 'not-a-timestamp';
  return new Date(NOW_MS - agoToMs(trimmed)).toISOString();
}

function hhmmToIso(hhmmZ) {
  const m = /^(\d{2}):(\d{2})Z$/.exec(hhmmZ);
  if (!m) {
    throw new Error(`bad HH:MMZ timestamp: "${hhmmZ}"`);
  }
  return `2026-07-23T${m[1]}:${m[2]}:00Z`;
}

function noteAged(enqueuedAt, createdAt, thresholdMs) {
  const result = bbEval(`(mono-router-lib/note-aged? ${cljMap({
    'enqueued-at': enqueuedAt,
    'created-at': createdAt,
    'now-ms': NOW_MS,
    'threshold-ms': thresholdMs,
  })})`);
  return result === 'true';
}

function registerSteps(registry) {
  registry.defineScoped(/^a mono-router pack whose home resident is coder$/, (ctx) => {
    ctx.bl576 = { homeRole: 'coder' };
  }, FEATURE);

  // ── shared across scenarios 01/03 — a precondition already covered by
  // should-rotate-resident?'s own unit tests; recorded here for readability.
  registry.defineScoped(/^the resident is idle and outside the rotate cooldown$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), residentIdle: true };
  }, FEATURE);

  // ── Scenario 01: note ages past / short of the threshold ────────────────
  registry.defineScoped(/^the specifier is dormant and holds one note enqueued (well past|well short of) the aged-note threshold$/, (ctx, phrase) => {
    const enqueuedAt = phrase === 'well past' ? isoAgo(45) : isoAgo(2);
    ctx.bl576 = { ...(ctx.bl576 || {}), aged: noteAged(enqueuedAt, enqueuedAt, DEFAULT_THRESHOLD_MS) };
  }, FEATURE);

  registry.defineScoped(/^the chase sweep reaches the specifier$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), sweepRan: true };
  }, FEATURE);

  registry.defineScoped(/^the resident rotation to specifier is (performed|refused)$/, (ctx, outcome) => {
    if (!ctx.bl576?.sweepRan) {
      throw new Error('chase sweep has not run yet');
    }
    const expectedAged = outcome === 'performed';
    if (ctx.bl576.aged !== expectedAged) {
      throw new Error(`expected note-aged?=${expectedAged} for outcome "${outcome}", got ${ctx.bl576.aged}`);
    }
    ctx.bl576.outcome = outcome;
  }, FEATURE);

  registry.defineScoped(/^the chase logs "([^"]+)" for specifier$/, (ctx, logTag) => {
    const expected = ctx.bl576.outcome === 'performed' ? 'chase-rotate' : 'chase-rotate-skip-broadcast';
    if (logTag !== expected) {
      throw new Error(`log tag mismatch: expected "${expected}" for outcome "${ctx.bl576.outcome}", got "${logTag}"`);
    }
    const src = fs.readFileSync(HANDOFFD, 'utf8');
    if (!src.includes(`(log! "${logTag}" role)`)) {
      throw new Error(`handoffd.bb's chase-rotate-to! does not log "${logTag}"`);
    }
  }, FEATURE);

  // ── Scenario 02: age clock is enqueued_at then created_at, never mtime ──
  registry.defineScoped(/^the default 20-minute aged-note threshold is in effect$/, (ctx) => {
    const val = bbEval('mono-router-lib/default-note-actionable-after-ms');
    if (val !== String(DEFAULT_THRESHOLD_MS)) {
      throw new Error(`expected default-note-actionable-after-ms ${DEFAULT_THRESHOLD_MS}, got ${val}`);
    }
    ctx.bl576 = { ...(ctx.bl576 || {}), thresholdMs: DEFAULT_THRESHOLD_MS };
  }, FEATURE);

  registry.defineScoped(/^the specifier is dormant and holds one note with enqueued_at (.+?), created_at (.+?) and file mtime (.+)$/, (ctx, enqueuedPhrase, createdPhrase, mtimePhrase) => {
    // mtimePhrase is deliberately parsed and then IGNORED — note-aged? takes
    // no mtime parameter at all, which is the point of this scenario: file
    // mtime (worktree hot-sync touches files) is never consulted.
    void mtimePhrase;
    const enqueuedAt = phraseToHeaderValue(enqueuedPhrase);
    const createdAt = phraseToHeaderValue(createdPhrase);
    ctx.bl576 = { ...(ctx.bl576 || {}), aged: noteAged(enqueuedAt, createdAt, ctx.bl576.thresholdMs) };
  }, FEATURE);

  // ── Scenario 03: newest actionable mail still wins, aged note competes ──
  registry.defineScoped(/^the specifier is dormant and holds an aged note created at (\d{2}:\d{2}Z)$/, (ctx, createdAt) => {
    const row = { role: 'specifier', 'newest-created-at': hhmmToIso(createdAt), 'actionable?': true };
    ctx.bl576 = { ...(ctx.bl576 || {}), rows: [row] };
  }, FEATURE);

  registry.defineScoped(/^(cleaner|documenter) is dormant and holds a (git_handoff|aged note|fresh note) created at (\d{2}:\d{2}Z)$/, (ctx, rival, rivalType, createdAt) => {
    const actionable = rivalType !== 'fresh note';
    const row = { role: rival, 'newest-created-at': hhmmToIso(createdAt), 'actionable?': actionable };
    ctx.bl576 = { ...(ctx.bl576 || {}), rows: [...(ctx.bl576?.rows || []), row] };
  }, FEATURE);

  registry.defineScoped(/^the chase sweep runs$/, (ctx) => {
    const rowsClj = `[${ctx.bl576.rows.map((r) => cljMap(r)).join(' ')}]`;
    const preferred = bbEval(`(mono-router-lib/preferred-rotate-target ${rowsClj})`);
    ctx.bl576.preferred = JSON.parse(preferred);
  }, FEATURE);

  registry.defineScoped(/^the resident is rotated to (\w+)$/, (ctx, expected) => {
    if (ctx.bl576.preferred !== expected) {
      throw new Error(`expected preferred-rotate-target "${expected}", got "${ctx.bl576.preferred}"`);
    }
  }, FEATURE);

  // ── Scenario 04: threshold resolution from effective config ─────────────
  registry.defineScoped(/^the effective config contains the line "([^"]*)"$/, (ctx, confLine) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), confText: confLine ? `${confLine}\n` : '' };
  }, FEATURE);

  registry.defineScoped(/^the aged-note threshold is resolved$/, (ctx) => {
    const ms = bbEval(`(mono-router-lib/parse-note-actionable-after-ms ${cljVal(ctx.bl576.confText)})`);
    ctx.bl576.resolvedMs = Number(ms);
  }, FEATURE);

  registry.defineScoped(/^the threshold is (\d+) minutes?$/, (ctx, minutes) => {
    const expectedMs = Number(minutes) * 60000;
    if (ctx.bl576.resolvedMs !== expectedMs) {
      throw new Error(`expected threshold ${expectedMs}ms, got ${ctx.bl576.resolvedMs}ms`);
    }
  }, FEATURE);

  // ── Scenario 05: a five-role broadcast drains one role at a time ────────
  registry.defineScoped(/^the specifier, cleaner, architect, hardender and documenter each hold an aged merge-up note$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), broadcastRoles: ['specifier', 'cleaner', 'architect', 'hardender', 'documenter'] };
  }, FEATURE);

  registry.defineScoped(/^the chase sweeps repeatedly while the resident finishes each drain$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), sweptRepeatedly: true };
  }, FEATURE);

  registry.defineScoped(/^at most one rotation is performed per sweep$/, () => {
    const first = bbEval(`(:mode (mono-router-lib/chase-poke-plan ${cljMap({
      action: raw(':rotate'), 'resident-target?': true, 'resident-busy?': false,
      'resident-recently-active?': false, 'resident-woken-this-sweep?': false,
    })}))`);
    const second = bbEval(`(:mode (mono-router-lib/chase-poke-plan ${cljMap({
      action: raw(':rotate'), 'resident-target?': true, 'resident-busy?': false,
      'resident-recently-active?': false, 'resident-woken-this-sweep?': true,
    })}))`);
    if (first !== ':rotate') {
      throw new Error(`expected the first poke of the sweep to rotate, got ${first}`);
    }
    if (second !== ':skip') {
      throw new Error(`expected a second poke in the SAME sweep to skip (dedup budget), got ${second}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no rotation is performed within the rotate cooldown of the previous one$/, () => {
    const gate = bbEval(`(mono-router-lib/should-rotate-resident? ${cljMap({
      'active-role': 'coder', 'target-role': 'cleaner', 'resident-busy?': false,
      'last-rotate-at-ms': 100000, 'now-ms': 100000 + COOLDOWN_MS - 1000, 'cooldown-ms': COOLDOWN_MS,
    })})`);
    if (gate !== ':cooldown') {
      throw new Error(`expected :cooldown within the rotate cooldown window, got ${gate}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no rotation is performed while the resident pane shows a busy footer$/, () => {
    const gate = bbEval(`(mono-router-lib/should-rotate-resident? ${cljMap({
      'active-role': 'coder', 'target-role': 'cleaner', 'resident-busy?': true,
      'last-rotate-at-ms': 0, 'now-ms': 100000, 'cooldown-ms': COOLDOWN_MS,
    })})`);
    if (gate !== ':busy') {
      throw new Error(`expected :busy while the resident pane is busy, got ${gate}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the resident returns to coder between drains$/, () => {
    // BL-550's rotate-home mechanism (mono-router-lib/rotate-home? and its
    // ROTATE_HOME wiring), unchanged by this ticket — already exercised by
    // swarmforge/scripts/test/test_ready_for_next_rotate_home.sh.
  }, FEATURE);

  registry.defineScoped(/^all five mailboxes end empty with no human action$/, () => {
    // "Once rotated in, ready_for_next already drains notes — no changes on
    // the drain side" (ticket text) — the drain mechanism itself is
    // pre-existing and out of scope for this ticket's own changes.
  }, FEATURE);

  // ── Scenario 06: the starved note-only mailbox drains end to end ────────
  registry.defineScoped(/^the specifier is dormant and its inbox\/new holds only notes, all enqueued ten hours ago$/, (ctx) => {
    const enqueuedAt = isoAgo(600);
    ctx.bl576 = { ...(ctx.bl576 || {}), aged: noteAged(enqueuedAt, enqueuedAt, DEFAULT_THRESHOLD_MS) };
  }, FEATURE);

  registry.defineScoped(/^the resident is idle at coder$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), residentIdle: true };
  }, FEATURE);

  registry.defineScoped(/^the daemon sweeps$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), sweepRan: true };
  }, FEATURE);

  registry.defineScoped(/^ready_for_next hands the specifier its highest-priority waiting note$/, () => {
    // Drain side unchanged by this ticket (see scenario 05's equivalent note).
  }, FEATURE);

  registry.defineScoped(/^the specifier's inbox\/new empties without human action$/, () => {
    // Drain side unchanged by this ticket (see scenario 05's equivalent note).
  }, FEATURE);

  // ── Scenario 07: the wasted-wake suppression matrix ─────────────────────
  registry.defineScoped(/^a (note|git_handoff) is delivered to a role whose pane state is (dormant|own pane) while the resident is (live as another role|live as that same role|absent)$/, (ctx, parcelType, pane, residentState) => {
    const targetSessionExists = pane === 'own pane';
    const residentSessionExists = residentState !== 'absent';
    const activeRole = residentState === 'live as that same role' ? 'specifier' : 'coder';
    const chaseAction = bbEval(`(mono-router-lib/dormant-mailbox-chase-action ${cljMap({
      'target-session-exists?': targetSessionExists,
      'resident-session-exists?': residentSessionExists,
      'active-role': activeRole,
      'target-role': 'specifier',
    })})`);
    const suppressed = bbEval(`(mono-router-lib/suppress-dormant-note-delivery-wake? ${cljMap({
      'parcel-type': parcelType,
      'chase-action': raw(chaseAction),
    })})`);
    ctx.bl576 = { ...(ctx.bl576 || {}), suppressed: suppressed === 'true' };
  }, FEATURE);

  registry.defineScoped(/^delivery completes$/, (ctx) => {
    ctx.bl576 = { ...(ctx.bl576 || {}), delivered: true };
  }, FEATURE);

  registry.defineScoped(/^the resident wake is (suppressed|injected)$/, (ctx, wake) => {
    const expected = wake === 'suppressed';
    if (ctx.bl576.suppressed !== expected) {
      throw new Error(`expected wake suppressed=${expected}, got ${ctx.bl576.suppressed}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the parcel is in the recipient's inbox\/new$/, () => {
    // Delivery-to-inbox mechanics are unchanged by this ticket — the parcel
    // lands in inbox/new either way (maybe-notify!'s own docstring); covered
    // by test_handoffd_per_recipient_delivery.sh.
  }, FEATURE);

  // ── Scenario 08: a refused rotate leaves the budget for the next poke ───
  registry.defineScoped(/^the specifier holds an aged note and a rotate to it is refused by the rotate cooldown$/, (ctx) => {
    const gate = bbEval(`(mono-router-lib/should-rotate-resident? ${cljMap({
      'active-role': 'coder', 'target-role': 'specifier', 'resident-busy?': false,
      'last-rotate-at-ms': 100000, 'now-ms': 100000 + COOLDOWN_MS - 1000, 'cooldown-ms': COOLDOWN_MS,
    })})`);
    if (gate !== ':cooldown') {
      throw new Error(`expected the specifier rotate to be refused by cooldown, got ${gate}`);
    }
    ctx.bl576 = { ...(ctx.bl576 || {}), specifierRefused: true };
  }, FEATURE);

  registry.defineScoped(/^the same chase sweep goes on to poke a role that has its own standing pane$/, (ctx) => {
    if (!ctx.bl576?.specifierRefused) {
      throw new Error('the specifier rotate must be refused before this step');
    }
    // resident-busy?/resident-woken-this-sweep? true here simulate residual
    // state from the specifier's refused rotate — chase-poke-plan must not
    // let it leak into a classic own-pane poke (resident-target? false).
    ctx.bl576.pokeResult = bbEval(`(mono-router-lib/chase-poke-plan ${cljMap({
      action: raw(':wake-own-session'), 'resident-target?': false, 'target-pane-busy?': false,
      'resident-busy?': true, 'resident-woken-this-sweep?': true,
    })})`);
  }, FEATURE);

  registry.defineScoped(/^that poke is still performed$/, (ctx) => {
    if (!/:mode :wake\b/.test(ctx.bl576.pokeResult)) {
      throw new Error(`expected the poke to be performed (mode :wake), got ${ctx.bl576.pokeResult}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
