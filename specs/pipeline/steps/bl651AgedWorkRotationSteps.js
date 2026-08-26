'use strict';

// BL-651: mono-router rotation bounds starvation by parcel age. Drives REAL
// mono_router_lib.bb pure functions via `bb -e` for the ordering/gate/
// threshold scenarios, and the REAL handoffd.bb --print-preferred-rotate-target
// wiring shell test (test_handoffd_starve_rotate_wiring.sh) for the "wired
// into the live rotation decision" scenario — hand-building score rows
// alone would stay green even if role-mail-row never fed
// :oldest-actionable-waited-ms into production (the BL-576/BL-636 F1
// anti-pattern, repeated).

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const FLOW_WATCHDOG_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const WIRING = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_starve_rotate_wiring.sh');
const FEATURE = 'mono-router rotation bounds starvation by parcel age';

const REFERENCE_NOW = '2026-08-01T12:00:00Z';
const REFERENCE_NOW_MS = Date.parse(REFERENCE_NOW);

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

function bbEval(expr, { flowWatchdog } = {}) {
  const loads = [`(load-file "${LIB}")`];
  if (flowWatchdog) loads.push(`(load-file "${FLOW_WATCHDOG_LIB}")`);
  const code = `${loads.join(' ')} (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function parsePri(s) {
  return Number(bbEval(`(mono-router-lib/parse-priority-rank ${cljVal(s)})`));
}

// "12m" / "1m" / "40m" -> ms. Every fixture in this feature is minutes-only.
function parseWaitedMs(s) {
  const m = /^(\d+)m$/.exec(String(s).trim());
  if (!m) throw new Error(`unsupported waited duration: ${s}`);
  return Number(m[1]) * 60000;
}

function isoMinusMs(ms) {
  return new Date(REFERENCE_NOW_MS - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ensureState(ctx) {
  if (!ctx.bl651) ctx.bl651 = { rows: [], starveAfterMs: 600000 };
  return ctx.bl651;
}

function upsertRow(ctx, role, { priority, waited }) {
  const st = ensureState(ctx);
  const waitedMs = parseWaitedMs(waited);
  const idx = st.rows.findIndex((r) => r.role === role);
  const row = {
    role,
    'best-priority': parsePri(priority),
    'newest-created-at': isoMinusMs(waitedMs),
    'oldest-actionable-waited-ms': waitedMs,
    'actionable?': true,
  };
  if (idx >= 0) st.rows[idx] = row;
  else st.rows.push(row);
}

function computePreferred(ctx) {
  const st = ensureState(ctx);
  const rowsClj = `[${st.rows.map((r) => cljMap(r)).join(' ')}]`;
  const starveArg = st.starveAfterMs === 'off' ? raw(':off') : st.starveAfterMs;
  const preferred = bbEval(`(mono-router-lib/preferred-rotate-target ${rowsClj} ${cljVal(starveArg)})`);
  st.preferred = preferred === 'nil' ? null : JSON.parse(preferred);
  return st.preferred;
}

function runWiring() {
  const result = spawnSync('bash', [WIRING], { encoding: 'utf8' });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`starve rotate wiring test failed:\n${out}`);
  }
  return out;
}

function ensureWiring(ctx) {
  const st = ensureState(ctx);
  if (st.wiring) return st.wiring;
  st.wiring = { out: runWiring() };
  return st.wiring;
}

function registerSteps(registry) {
  registry.defineScoped(/^a mono-router pack with config rotation router$/, (ctx) => {
    ensureState(ctx).pack = 'mono-router';
  }, FEATURE);

  registry.defineScoped(/^rotation_starve_after_ms is "([^"]+)"$/, (ctx, value) => {
    const st = ensureState(ctx);
    st.starveAfterMs = value === 'off' ? 'off' : Number(value);
  }, FEATURE);

  // ── row-building Givens (scenarios 01-04) ─────────────────────────────
  registry.defineScoped(/^dormant role "([^"]+)" holds actionable mail at priority "([^"]+)" that has waited "([^"]+)"$/, (ctx, role, pri, waited) => {
    upsertRow(ctx, role, { priority: pri, waited });
  }, FEATURE);

  registry.defineScoped(/^home role "([^"]+)" holds actionable mail at priority "([^"]+)" that has waited "([^"]+)"$/, (ctx, role, pri, waited) => {
    upsertRow(ctx, role, { priority: pri, waited });
  }, FEATURE);

  // ── Scenario 03: mtime must never be the age source ─────────────────────
  registry.defineScoped(/^that parcel's file mtime was touched by a worktree sync moments ago$/, (ctx) => {
    ensureState(ctx).assertMtimeIgnored = true;
  }, FEATURE);

  // ── shared When / Then for 01-04 ──────────────────────────────────────
  registry.defineScoped(/^the rotation target is computed$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.pack === 'mono-router' && st.rows.length > 0) {
      computePreferred(ctx);
    }
    if (st.assertMtimeIgnored) {
      // Real fixture proof (not just the pure function, which has no
      // concept of file mtime at all): a touched inbox file must not reset
      // the wait handoffd computes from the parcel's own header.
      const wiring = ensureWiring(ctx);
      if (!wiring.out.includes('PASS: C:')) {
        throw new Error(`wiring test missing mtime-ignored scenario C:\n${wiring.out}`);
      }
    }
  }, FEATURE);

  registry.defineScoped(/^"([^"]+)" is selected$/, (ctx, role) => {
    const st = ensureState(ctx);
    if (st.preferred !== role) {
      throw new Error(`expected preferred-rotate-target "${role}", got "${st.preferred}"`);
    }
  }, FEATURE);

  // ── Scenario 05: never preempts work in flight ───────────────────────────
  registry.defineScoped(/^the resident pane is busy$/, (ctx) => {
    ensureState(ctx).residentBusy = true;
  }, FEATURE);

  registry.defineScoped(/^the resident rotation gate is evaluated for "([^"]+)"$/, (ctx, role) => {
    const st = ensureState(ctx);
    const gate = bbEval(`(mono-router-lib/should-rotate-resident? ${cljMap({
      'active-role': 'coder',
      'target-role': role,
      'resident-busy?': Boolean(st.residentBusy),
      'last-rotate-at-ms': 0,
      'now-ms': REFERENCE_NOW_MS,
      'cooldown-ms': raw('mono-router-lib/default-rotate-cooldown-ms'),
    })})`);
    // pr-str of a keyword prints as ":busy" etc.
    st.gate = gate.replace(/^:/, '');
  }, FEATURE);

  registry.defineScoped(/^the rotation is refused as "([^"]+)"$/, (ctx, reason) => {
    const st = ensureState(ctx);
    if (st.gate !== reason) {
      throw new Error(`expected rotation gate "${reason}", got "${st.gate}"`);
    }
  }, FEATURE);

  // ── Scenario 06: default threshold sits below the watchdog warn tier ────
  registry.defineScoped(/^the default rotation_starve_after_ms$/, (ctx) => {
    ensureState(ctx).rotationDefault = Number(bbEval('mono-router-lib/default-rotation-starve-after-ms'));
  }, FEATURE);

  registry.defineScoped(/^the default flow_watchdog_warn_ms$/, (ctx) => {
    ensureState(ctx).watchdogDefault = Number(bbEval('flow-watchdog-lib/default-warn-ms', { flowWatchdog: true }));
  }, FEATURE);

  registry.defineScoped(/^the two thresholds are compared$/, (ctx) => {
    ensureState(ctx).compared = true;
  }, FEATURE);

  registry.defineScoped(/^the rotation threshold is lower than the warn threshold$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.compared) throw new Error('thresholds were never compared');
    if (!(st.rotationDefault < st.watchdogDefault)) {
      throw new Error(`expected rotation default (${st.rotationDefault}) < flow-watchdog warn default (${st.watchdogDefault})`);
    }
  }, FEATURE);

  // ── Scenario 07: wired into the live rotation decision ──────────────────
  registry.defineScoped(/^a live handoffd role set where dormant role "([^"]+)" holds a git_handoff that has waited "([^"]+)"$/, (ctx, role) => {
    ensureState(ctx).liveDormantRole = role;
  }, FEATURE);

  registry.defineScoped(/^home role "([^"]+)" holds a newer git_handoff at the same priority$/, (ctx) => {
    // Fixture is fixed inside test_handoffd_starve_rotate_wiring.sh scenario A
    // (dormant documenter 12m old vs. home coder 1m old, both priority 00) -
    // this step only records that the scenario names it explicitly.
    ensureState(ctx).liveHomeNewer = true;
  }, FEATURE);

  registry.defineScoped(/^handoffd computes its preferred rotate target$/, (ctx) => {
    ensureWiring(ctx);
  }, FEATURE);

  registry.defineScoped(/^"([^"]+)" is printed as the preferred rotate target$/, (ctx, role) => {
    const st = ensureState(ctx);
    if (st.liveDormantRole !== role) {
      throw new Error(`scenario names dormant role "${role}" but fixture built for "${st.liveDormantRole}"`);
    }
    const wiring = ensureWiring(ctx);
    if (!wiring.out.includes('PASS: A:')) {
      throw new Error(`wiring test missing live starve-preference scenario A:\n${wiring.out}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
