'use strict';

// BL-835: step handlers for "floored percentiles must not invent flow-watchdog
// warn thresholds". Drives the REAL pure functions in
// swarmforge/scripts/flow_watchdog_lib.bb (calibrate-threshold-table,
// resolve-thresholds, decide-tier, tier-decision-input-keys) via `bb -e`,
// mirroring bl577FlowWatchdogParcelAgeInvariantSteps.js's own bbEval
// convention. Each step's whole computation runs in ONE bb process that
// prints a final camelCase JSON summary - deliberately not round-tripping
// cheshire's hyphenated keyword keys (":warn-ms") through JS field access,
// which is the exact bug this file's first draft hit.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const FEATURE = 'floored percentiles must not invent flow-watchdog warn thresholds';

const NOW_MS = Date.parse('2026-08-06T20:00:00Z');
const T0_MS = Date.parse('2026-08-01T00:00:00.000Z');
const DEFAULT_WARN_MS = 900000;
const DEFAULT_ESCALATE_MS = 3600000;
const MIN_WARN_MS = 60000;
const MIN_SAMPLES = 8;

function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`unsupported clj value: ${v}`);
}
function cljHeaderMap(route, durationMs) {
  const enqueuedAt = new Date(T0_MS).toISOString();
  const completedAt = new Date(T0_MS + durationMs).toISOString();
  return `{:from ${cljVal(route.from)} :to ${cljVal(route.to)} :type ${cljVal(route.type)} `
    + `:enqueued_at ${cljVal(enqueuedAt)} :completed_at ${cljVal(completedAt)}}`;
}
function cljHeadersVec(route, durationsMs) {
  return `[${durationsMs.map((d) => cljHeaderMap(route, d)).join(' ')}]`;
}
function cljRouteMap(route) {
  return `{:from ${cljVal(route.from)} :to ${cljVal(route.to)} :type ${cljVal(route.type)}}`;
}

function bbRun(code) {
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed:\n${code}\n${result.stderr}`);
  }
  const lines = result.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────────
  registry.defineScoped(/^a daemon state directory and a project config with the global warn and escalate pair$/, (ctx) => {
    ctx.bl835 = { globalWarnMs: DEFAULT_WARN_MS, globalEscalateMs: DEFAULT_ESCALATE_MS };
  }, FEATURE);

  // ── Scenario 01: sub-floor route is not calibrated ──────────────────────
  registry.defineScoped(/^a route with at least the minimum number of completed handoffs$/, (ctx) => {
    ctx.bl835 = { ...(ctx.bl835 || {}), route: { from: 'qa', to: 'coordinator', type: 'git_handoff' }, sampleCount: MIN_SAMPLES + 2 };
  }, FEATURE);

  registry.defineScoped(/^every recorded residence on that route is below min-warn-ms$/, (ctx) => {
    // Deterministic durations, all strictly under the 60s gate - the exact
    // behavior the ticket's live incident showed (QA→coordinator|git_handoff
    // residence of ~1 minute or less).
    ctx.bl835.durationsMs = Array.from({ length: ctx.bl835.sampleCount }, (_, i) => 3000 + i * 500);
  }, FEATURE);

  registry.defineScoped(/^the threshold table is calibrated$/, (ctx) => {
    const s = ctx.bl835;
    const key = `${s.route.from}->${s.route.to}|${s.route.type}`;
    const code = `
(load-file "${LIB}")
(def headers ${cljHeadersVec(s.route, s.durationsMs)})
(def table (flow-watchdog-lib/calibrate-threshold-table headers ${NOW_MS}))
(def resolved (flow-watchdog-lib/resolve-thresholds ${cljRouteMap(s.route)} (:specs table) {:warn-ms ${s.globalWarnMs} :escalate-ms ${s.globalEscalateMs}}))
(println (cheshire.core/generate-string {:hasExactEntry (contains? (:specs table) ${cljVal(key)})
                                          :resolvedVia (:resolved-via resolved)
                                          :resolvedWarnMs (:warn-ms resolved)
                                          :resolvedEscalateMs (:escalate-ms resolved)}))`;
    ctx.bl835.result = bbRun(code);
  }, FEATURE);

  registry.defineScoped(/^no exact-spec entry is emitted for that route$/, (ctx) => {
    if (ctx.bl835.result.hasExactEntry) {
      throw new Error('expected no exact-spec entry for the sub-floor route, but one was emitted');
    }
  }, FEATURE);

  registry.defineScoped(/^resolution for a parcel on that route falls through to the global pair$/, (ctx) => {
    const s = ctx.bl835;
    const r = s.result;
    if (r.resolvedVia !== 'global') {
      throw new Error(`expected resolution to fall through to global, got resolved-via="${r.resolvedVia}"`);
    }
    if (r.resolvedWarnMs !== s.globalWarnMs || r.resolvedEscalateMs !== s.globalEscalateMs) {
      throw new Error(`expected the global pair (${s.globalWarnMs}/${s.globalEscalateMs}), got (${r.resolvedWarnMs}/${r.resolvedEscalateMs})`);
    }
  }, FEATURE);

  // ── Scenario 02: ~90s parcel on sub-floor route does not WARN ───────────
  registry.defineScoped(/^a route whose history is entirely below min-warn-ms$/, (ctx) => {
    ctx.bl835 = {
      ...(ctx.bl835 || {}),
      route: { from: 'qa', to: 'coordinator', type: 'git_handoff' },
      durationsMs: Array.from({ length: MIN_SAMPLES + 2 }, (_, i) => 3000 + i * 500),
    };
  }, FEATURE);

  registry.defineScoped(/^a live parcel on that route aged about 90 seconds$/, (ctx) => {
    ctx.bl835.ageMs = 90000;
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweep runs$/, (ctx) => {
    const s = ctx.bl835;
    const code = `
(load-file "${LIB}")
(def headers ${cljHeadersVec(s.route, s.durationsMs)})
(def table (flow-watchdog-lib/calibrate-threshold-table headers ${NOW_MS}))
(def resolved (flow-watchdog-lib/resolve-thresholds ${cljRouteMap(s.route)} (:specs table) {:warn-ms ${s.globalWarnMs} :escalate-ms ${s.globalEscalateMs}}))
(def tier (flow-watchdog-lib/decide-tier {:age-ms ${s.ageMs} :warn-ms (:warn-ms resolved) :escalate-ms (:escalate-ms resolved)
                                           :highest-tier-alarmed nil :snoozed? false}))
(println (cheshire.core/generate-string {:resolvedVia (:resolved-via resolved)
                                          :resolvedWarnMs (:warn-ms resolved)
                                          :resolvedEscalateMs (:escalate-ms resolved)
                                          :tier (name tier)}))`;
    ctx.bl835.result = bbRun(code);
  }, FEATURE);

  registry.defineScoped(/^no warn or escalate alarm is emitted for that parcel$/, (ctx) => {
    if (ctx.bl835.result.tier !== 'none') {
      throw new Error(`expected no alarm (tier "none"), got "${ctx.bl835.result.tier}" (resolved warn-ms=${ctx.bl835.result.resolvedWarnMs})`);
    }
  }, FEATURE);

  // ── Scenario 03: gate-clearing route still calibrates and can WARN early ─
  registry.defineScoped(/^a route with enough samples whose p67 is well above min-warn-ms$/, (ctx) => {
    const calibratedWarnMs = 5 * 60 * 1000;
    // 8 samples at the p67 value plus 2 long-tail samples, mirroring the
    // bb unit test's shape - a flat sample set would collapse p67 and p97
    // together and force decide-tier straight to :escalate.
    const durationsMs = [...Array.from({ length: MIN_SAMPLES }, () => calibratedWarnMs), 20 * 60 * 1000, 40 * 60 * 1000];
    ctx.bl835 = {
      ...(ctx.bl835 || {}),
      route: { from: 'architect', to: 'hardener', type: 'git_handoff' },
      durationsMs,
      calibratedWarnMs,
    };
  }, FEATURE);

  registry.defineScoped(/^that p67 is still below the global warn$/, (ctx) => {
    const { calibratedWarnMs, globalWarnMs } = ctx.bl835;
    if (!(calibratedWarnMs > MIN_WARN_MS && calibratedWarnMs < globalWarnMs)) {
      throw new Error(`fixture p67 ${calibratedWarnMs}ms must sit strictly between the gate and the global warn`);
    }
  }, FEATURE);

  registry.defineScoped(/^a live parcel on that route aged past the calibrated warn$/, (ctx) => {
    ctx.bl835.ageMs = ctx.bl835.calibratedWarnMs + 60000;
    if (ctx.bl835.ageMs >= ctx.bl835.globalWarnMs) {
      throw new Error('fixture age must still sit below the global warn to prove EARLY firing');
    }
  }, FEATURE);

  registry.defineScoped(/^a warn alarm is emitted for that parcel before the global warn would have fired$/, (ctx) => {
    const s = ctx.bl835;
    if (s.result.tier !== 'warn') {
      throw new Error(`expected a warn-tier alarm, got "${s.result.tier}"`);
    }
    if (s.result.resolvedVia === 'global') {
      throw new Error('expected the alarm to fire via the calibrated per-route threshold, not the global fallback');
    }
    if (!(s.ageMs < s.globalWarnMs)) {
      throw new Error(`expected the alarm to fire before the global warn (age=${s.ageMs}ms, global=${s.globalWarnMs}ms)`);
    }
  }, FEATURE);

  // ── Scenario 04: decide-tier never sees the route identity ──────────────
  registry.defineScoped(/^a parcel whose thresholds were resolved after a sub-floor key was rejected$/, (ctx) => {
    const route = { from: 'coder', to: 'coordinator', type: 'note' };
    const durationsMs = Array.from({ length: MIN_SAMPLES + 2 }, (_, i) => 2000 + i * 200);
    const global = { warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS };
    const code = `
(load-file "${LIB}")
(def headers ${cljHeadersVec(route, durationsMs)})
(def table (flow-watchdog-lib/calibrate-threshold-table headers ${NOW_MS}))
(def resolved (flow-watchdog-lib/resolve-thresholds ${cljRouteMap(route)} (:specs table) {:warn-ms ${global.warnMs} :escalate-ms ${global.escalateMs}}))
(println (cheshire.core/generate-string {:hadExactEntry (contains? (:specs table) ${cljVal(`${route.from}->${route.to}|${route.type}`)})
                                          :resolvedVia (:resolved-via resolved)
                                          :resolvedWarnMs (:warn-ms resolved)
                                          :resolvedEscalateMs (:escalate-ms resolved)}))`;
    const result = bbRun(code);
    if (result.hadExactEntry || result.resolvedVia !== 'global') {
      throw new Error(`fixture route must be sub-floor-rejected and resolve via global, got: ${JSON.stringify(result)}`);
    }
    ctx.bl835 = {
      ...(ctx.bl835 || {}),
      resolvedWarnMs: result.resolvedWarnMs,
      resolvedEscalateMs: result.resolvedEscalateMs,
      ageMs: 90000,
    };
  }, FEATURE);

  registry.defineScoped(/^the tier decision is made$/, (ctx) => {
    const s = ctx.bl835;
    const code = `
(load-file "${LIB}")
(def plain-input {:age-ms ${s.ageMs} :warn-ms ${s.resolvedWarnMs} :escalate-ms ${s.resolvedEscalateMs}
                   :highest-tier-alarmed nil :snoozed? false})
(def tainted-input (assoc plain-input :from "coder" :to "coordinator" :type "note" :role "coordinator" :dormant? true))
(def allowed-keys flow-watchdog-lib/tier-decision-input-keys)
(println (cheshire.core/generate-string
          {:tier (name (flow-watchdog-lib/decide-tier plain-input))
           :taintedTier (name (flow-watchdog-lib/decide-tier tainted-input))
           :inputKeys (mapv name (keys plain-input))
           :allowedKeys (mapv name allowed-keys)}))`;
    ctx.bl835.decisionResult = bbRun(code);
  }, FEATURE);

  registry.defineScoped(/^the decision input carries only an age and a threshold pair$/, (ctx) => {
    const r = ctx.bl835.decisionResult;
    const expected = ['age-ms', 'escalate-ms', 'highest-tier-alarmed', 'snoozed?', 'warn-ms'];
    const got = [...r.inputKeys].sort();
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      throw new Error(`expected decide-tier input keys ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
    const allowedGot = [...r.allowedKeys].sort();
    if (JSON.stringify(allowedGot) !== JSON.stringify(expected)) {
      throw new Error(`expected tier-decision-input-keys ${JSON.stringify(expected)}, got ${JSON.stringify(allowedGot)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^it carries no from role, to role, type, or dormancy signal$/, (ctx) => {
    const r = ctx.bl835.decisionResult;
    for (const forbidden of ['from', 'to', 'type', 'role', 'dormancy', 'dormant?']) {
      if (r.inputKeys.includes(forbidden) || r.allowedKeys.includes(forbidden)) {
        throw new Error(`decide-tier input/allowed-keys must never carry "${forbidden}"`);
      }
    }
    if (r.tier !== r.taintedTier) {
      throw new Error(`decide-tier's verdict changed when from/to/type/role/dormant? keys were injected: "${r.tier}" vs "${r.taintedTier}"`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
