'use strict';

// BL-650: step handlers for "flow-watchdog measures parcel age in active
// time, not wall-clock time". Drives the REAL pure functions in
// swarmforge/scripts/flow_watchdog_lib.bb (evaluate-effective-age,
// decide-tier, format-alarm-text, read-pack-aware-global-thresholds,
// tier-decision-input-keys) via `bb -e`, mirroring
// bl835FlowWatchdogFlooredPercentileFalseAlarmsSteps.js's own bbEval
// convention: each step's computation runs in ONE bb process that prints a
// final camelCase JSON summary, never re-implementing the clock's
// arithmetic in JS.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const FEATURE = 'flow-watchdog measures parcel age in active time, not wall-clock time';

const NOW_MS = Date.parse('2026-08-06T20:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DEFAULT_WARN_MS = 900000;
const DEFAULT_ESCALATE_MS = 3600000;

function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`unsupported clj value: ${v}`);
}
function iso(ms) {
  return new Date(ms).toISOString();
}
function cljLedgerInterval({ startMs, endMs, cls, provenance }) {
  return `{:start-ms ${cljVal(startMs)} :end-ms ${endMs === null ? 'nil' : cljVal(endMs)} `
    + `:class ${cljVal(cls)} :provenance ${cljVal(provenance)}}`;
}
function cljLedgerVec(intervals) {
  return `[${intervals.map(cljLedgerInterval).join(' ')}]`;
}
function cljEvidenceLine({ tsMs, provider, text }) {
  return `{:ts-ms ${cljVal(tsMs)} :provider ${cljVal(provider)} :text ${cljVal(text)}}`;
}
function cljEvidenceVec(lines) {
  return `[${lines.map(cljEvidenceLine).join(' ')}]`;
}

function bbRun(code) {
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed:\n${code}\n${result.stderr}`);
  }
  const lines = result.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

// One shared entry point: evaluate-effective-age + decide-tier (fed the
// EFFECTIVE age, exactly as run-sweep! does) + format-alarm-text, all in
// one bb process.
function evaluateEffectiveAge({
  enqueuedAtMs, ledgerIntervals = [], providerEvidence = [], warnMs = DEFAULT_WARN_MS,
  escalateMs = DEFAULT_ESCALATE_MS, highestTierAlarmed = null, snoozed = false,
}) {
  const code = `
(load-file "${LIB}")
(def eff (flow-watchdog-lib/evaluate-effective-age
          {:enqueued-at ${cljVal(iso(enqueuedAtMs))} :now-ms ${NOW_MS}
           :ledger-intervals ${cljLedgerVec(ledgerIntervals)}
           :provider-evidence ${cljEvidenceVec(providerEvidence)}}))
(def tier (flow-watchdog-lib/decide-tier {:age-ms (:effective-age-ms eff) :warn-ms ${warnMs} :escalate-ms ${escalateMs}
                                           :highest-tier-alarmed ${highestTierAlarmed ? `:${highestTierAlarmed}` : 'nil'}
                                           :snoozed? ${cljVal(snoozed)}}))
(def text (flow-watchdog-lib/format-alarm-text
           {:id "p" :from "a" :to "b" :type "note" :age-ms (:effective-age-ms eff)
            :wall-age-ms (:wall-age-ms eff) :role "cleaner" :mailbox :new :verb :rotate
            :tier tier :outage-intervals (:outage-intervals eff)
            :unreconstructable? (:unreconstructable? eff)}))
(println (cheshire.core/generate-string {:effectiveAgeMs (:effective-age-ms eff)
                                          :wallAgeMs (:wall-age-ms eff)
                                          :unreconstructable (:unreconstructable? eff)
                                          :outageCount (count (:outage-intervals eff))
                                          :tier (name tier)
                                          :alarmText text}))`;
  return bbRun(code);
}

function registerSteps(registry) {
  // ── Scenario 01: stop-interval-not-counted ───────────────────────────────
  registry.defineScoped(/^a parcel enqueued 1 minute before the swarm stopped$/, (ctx) => {
    ctx.bl650 = { enqueuedAtMs: NOW_MS - 15 * MIN, ledgerIntervals: [] };
  }, FEATURE);

  registry.defineScoped(/^the swarm was stopped for 6 minutes$/, (ctx) => {
    const stopStart = ctx.bl650.enqueuedAtMs + 1 * MIN;
    ctx.bl650.ledgerIntervals.push({ startMs: stopStart, endMs: stopStart + 6 * MIN, cls: 'swarm-stop', provenance: 'proven' });
  }, FEATURE);

  registry.defineScoped(/^the swarm was then active for 8 minutes$/, (ctx) => {
    // 1m (pre-stop active) + 6m (stopped) + 8m (post-stop active) = 15m wall.
    // Nothing further to record - the ledger interval already carries the
    // stop; the remaining wall span is active time by construction.
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog evaluates the parcel's age$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({
      enqueuedAtMs: ctx.bl650.enqueuedAtMs,
      ledgerIntervals: ctx.bl650.ledgerIntervals,
      warnMs: 15 * MIN,
      escalateMs: HOUR,
    });
  }, FEATURE);

  registry.defineScoped(/^its effective age is 9 minutes$/, (ctx) => {
    if (ctx.bl650.result.effectiveAgeMs !== 9 * MIN) {
      throw new Error(`expected effective age 9m (${9 * MIN}ms), got ${ctx.bl650.result.effectiveAgeMs}ms`);
    }
  }, FEATURE);

  registry.defineScoped(/^no warn fires at the 15-minute wall-clock mark$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'none') {
      throw new Error(`expected no alarm, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);

  // ── Scenario 02: overnight-cooldown-resume-no-storm ──────────────────────
  registry.defineScoped(/^a parcel enqueued at the start of the nightly cooldown pause$/, (ctx) => {
    ctx.bl650 = { enqueuedAtMs: NOW_MS - 12 * HOUR };
  }, FEATURE);

  registry.defineScoped(/^the swarm remained paused all night until the 07:00 resume$/, (ctx) => {
    ctx.bl650.ledgerIntervals = [
      { startMs: ctx.bl650.enqueuedAtMs, endMs: NOW_MS, cls: 'control-pause', provenance: 'proven' },
    ];
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweeps immediately after resume$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({
      enqueuedAtMs: ctx.bl650.enqueuedAtMs,
      ledgerIntervals: ctx.bl650.ledgerIntervals,
    });
  }, FEATURE);

  registry.defineScoped(/^the parcel's effective age is approximately zero$/, (ctx) => {
    if (ctx.bl650.result.effectiveAgeMs > 1000) {
      throw new Error(`expected ~0 effective age, got ${ctx.bl650.result.effectiveAgeMs}ms`);
    }
  }, FEATURE);

  registry.defineScoped(/^nothing fires for that parcel$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'none') {
      throw new Error(`expected no alarm, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);

  // ── Scenario 03: active-ignored-parcel-still-alarms ──────────────────────
  registry.defineScoped(/^a parcel has sat unprocessed for the full warn threshold while the swarm was active and unpaused$/, (ctx) => {
    ctx.bl650 = { enqueuedAtMs: NOW_MS - (DEFAULT_WARN_MS + 1000), highestTierAlarmed: null };
  }, FEATURE);

  // Shared by scenario 03 (plain sweep) and scenario 06 (pack-aware sweep) -
  // both use the identical literal step text "When the flow watchdog
  // sweeps", so ONE registration dispatches on which fixture set the
  // preceding Given populated (ctx.bl650.packType only exists for 06).
  registry.defineScoped(/^the flow watchdog sweeps$/, (ctx) => {
    if (ctx.bl650.packType !== undefined) {
      const code = `
(load-file "${LIB}")
(def router? ${cljVal(ctx.bl650.packType === 'rotation router')})
(def global (if router?
              {:warn-ms flow-watchdog-lib/default-router-warn-ms :escalate-ms flow-watchdog-lib/default-router-escalate-ms}
              {:warn-ms flow-watchdog-lib/default-warn-ms :escalate-ms flow-watchdog-lib/default-escalate-ms}))
(def eff (flow-watchdog-lib/evaluate-effective-age
          {:enqueued-at ${cljVal(iso(ctx.bl650.enqueuedAtMs))} :now-ms ${NOW_MS}
           :ledger-intervals [] :provider-evidence []}))
(def tier (flow-watchdog-lib/decide-tier {:age-ms (:effective-age-ms eff) :warn-ms (:warn-ms global) :escalate-ms (:escalate-ms global)
                                           :highest-tier-alarmed nil :snoozed? false}))
(println (cheshire.core/generate-string {:tier (name tier)}))`;
      ctx.bl650.result = bbRun(code);
    } else {
      ctx.bl650.result = evaluateEffectiveAge({
        enqueuedAtMs: ctx.bl650.enqueuedAtMs,
        highestTierAlarmed: ctx.bl650.highestTierAlarmed,
      });
    }
  }, FEATURE);

  registry.defineScoped(/^a WARN fires$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'warn') {
      throw new Error(`expected a WARN, got tier "${ctx.bl650.result.tier}"`);
    }
    ctx.bl650.highestTierAlarmed = 'warn';
  }, FEATURE);

  registry.defineScoped(/^that same parcel continues unprocessed to the escalate threshold of active time$/, (ctx) => {
    ctx.bl650.enqueuedAtMs = NOW_MS - (DEFAULT_ESCALATE_MS + 1000);
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweeps again$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({
      enqueuedAtMs: ctx.bl650.enqueuedAtMs,
      highestTierAlarmed: ctx.bl650.highestTierAlarmed,
    });
  }, FEATURE);

  registry.defineScoped(/^an ESCALATE fires$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'escalate') {
      throw new Error(`expected an ESCALATE, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);

  // ── Scenario 04: decide-tier-structural-guarantee-intact ─────────────────
  registry.defineScoped(/^decide-tier's current inputs$/, (ctx) => {
    ctx.bl650 = {};
  }, FEATURE);

  registry.defineScoped(/^this ticket's change is applied$/, (ctx) => {
    const code = `
(load-file "${LIB}")
(println (cheshire.core/generate-string {:allowedKeys (mapv name flow-watchdog-lib/tier-decision-input-keys)}))`;
    ctx.bl650.result = bbRun(code);
  }, FEATURE);

  registry.defineScoped(/^decide-tier's only mute remains snoozed\?$/, (ctx) => {
    const code = `
(load-file "${LIB}")
(println (cheshire.core/generate-string
          {:mutedWhenSnoozed (name (flow-watchdog-lib/decide-tier {:age-ms 99999999 :warn-ms 60 :escalate-ms 600 :highest-tier-alarmed nil :snoozed? true}))
           :notMutedOtherwise (name (flow-watchdog-lib/decide-tier {:age-ms 99999999 :warn-ms 60 :escalate-ms 600 :highest-tier-alarmed nil :snoozed? false}))}))`;
    const r = bbRun(code);
    if (r.mutedWhenSnoozed !== 'none' || r.notMutedOtherwise === 'none') {
      throw new Error(`snoozed? must be the only mute: ${JSON.stringify(r)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no role, type, or dormancy branch has been added to its inputs$/, (ctx) => {
    const forbidden = ['from', 'to', 'type', 'role', 'dormancy', 'dormant?'];
    for (const key of forbidden) {
      if (ctx.bl650.result.allowedKeys.includes(key)) {
        throw new Error(`decide-tier's allowed keys must never carry "${key}": ${JSON.stringify(ctx.bl650.result.allowedKeys)}`);
      }
    }
    const expected = ['age-ms', 'escalate-ms', 'highest-tier-alarmed', 'snoozed?', 'warn-ms'].sort();
    if (JSON.stringify([...ctx.bl650.result.allowedKeys].sort()) !== JSON.stringify(expected)) {
      throw new Error(`unexpected allowed-key set: ${JSON.stringify(ctx.bl650.result.allowedKeys)}`);
    }
  }, FEATURE);

  // ── Scenario 05: unreconstructable-interval-degrades-to-wall-clock ───────
  registry.defineScoped(/^a pause or stop interval whose durable record is missing or unreliable$/, (ctx) => {
    const stopStart = NOW_MS - 20 * MIN;
    ctx.bl650 = {
      enqueuedAtMs: stopStart,
      ledgerIntervals: [{ startMs: stopStart, endMs: null, cls: 'swarm-stop', provenance: 'open' }],
    };
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog evaluates a parcel spanning that interval$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({
      enqueuedAtMs: ctx.bl650.enqueuedAtMs,
      ledgerIntervals: ctx.bl650.ledgerIntervals,
    });
  }, FEATURE);

  registry.defineScoped(/^the parcel's age falls back to wall clock for that interval$/, (ctx) => {
    if (ctx.bl650.result.effectiveAgeMs !== ctx.bl650.result.wallAgeMs) {
      throw new Error(`expected effective age to equal wall age (fallback), got ${JSON.stringify(ctx.bl650.result)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm text flags that the interval could not be reconstructed$/, (ctx) => {
    if (!ctx.bl650.result.unreconstructable || !ctx.bl650.result.alarmText.includes('could not be reconstructed')) {
      throw new Error(`expected the alarm text to flag an unreconstructable interval: ${JSON.stringify(ctx.bl650.result)}`);
    }
  }, FEATURE);

  // ── Scenario 06: rotation-pack-threshold-vs-parallel-pack (Outline) ──────
  registry.defineScoped(/^a pack of type (rotation router|parallel \(all resident\))$/, (ctx, packType) => {
    ctx.bl650 = { packType };
  }, FEATURE);

  registry.defineScoped(/^a broadcast parcel waiting a nominal rotation turn in a dormant role's inbox$/, (ctx) => {
    // A nominal wait: exactly the plain (non-router) default warn threshold.
    ctx.bl650.enqueuedAtMs = NOW_MS - (DEFAULT_WARN_MS + 1000);
  }, FEATURE);

  registry.defineScoped(/^no warn fires$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'none') {
      throw new Error(`expected no alarm under a rotation-router pack, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);

  registry.defineScoped(/^a warn still fires$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'warn') {
      throw new Error(`expected a warn under a parallel/all-resident pack, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);

  // ── Scenario 07: alarm-text-states-clock-and-outage ──────────────────────
  registry.defineScoped(/^a parcel aged 9 minutes active out of 15 minutes wall, with 6 minutes subtracted for a provider outage$/, (ctx) => {
    const enqueuedAtMs = NOW_MS - 15 * MIN;
    const outageStart = enqueuedAtMs + 3 * MIN;
    const outageEnd = outageStart + 6 * MIN;
    ctx.bl650 = {
      enqueuedAtMs,
      providerEvidence: [
        { tsMs: outageStart, provider: 'anthropic', text: '529 Overloaded attempt 1/5' },
        { tsMs: outageEnd, provider: 'anthropic', text: '529 Overloaded attempt 5/5' },
      ],
    };
  }, FEATURE);

  registry.defineScoped(/^a WARN or ESCALATE fires for that parcel$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({
      enqueuedAtMs: ctx.bl650.enqueuedAtMs,
      providerEvidence: ctx.bl650.providerEvidence,
      // 5m warn so the 9m EFFECTIVE age (not the 15m wall age) is what
      // crosses the threshold - proving the fixture's own subtraction, not
      // just a generously low global default, drove the alarm.
      warnMs: 5 * MIN,
      escalateMs: HOUR,
    });
    if (ctx.bl650.result.tier === 'none') {
      throw new Error(`expected a WARN or ESCALATE, got none: ${JSON.stringify(ctx.bl650.result)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm text reads its active age and its wall age$/, (ctx) => {
    const { alarmText } = ctx.bl650.result;
    if (!alarmText.includes('9m') || !alarmText.includes('15m')) {
      throw new Error(`expected alarm text to read both 9m active and 15m wall: "${alarmText}"`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm text names the subtracted provider-outage interval$/, (ctx) => {
    if (!ctx.bl650.result.alarmText.includes('anthropic')) {
      throw new Error(`expected alarm text to name the provider: "${ctx.bl650.result.alarmText}"`);
    }
  }, FEATURE);

  // ── Scenario 08: provider-outage-interval-tracked-per-provider ───────────
  registry.defineScoped(/^a 529 retry storm during an architect's review, backed by timestamped retry lines in the role transcript$/, (ctx) => {
    const enqueuedAtMs = NOW_MS - 15 * MIN;
    const outageStart = enqueuedAtMs + 3 * MIN;
    const outageEnd = outageStart + 6 * MIN;
    ctx.bl650 = {
      enqueuedAtMs,
      providerEvidence: [
        { tsMs: outageStart, provider: 'anthropic', text: '529 Overloaded attempt 1/5' },
        { tsMs: outageEnd, provider: 'anthropic', text: '529 Overloaded attempt 5/5' },
      ],
    };
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog computes effective age for parcels in flight during that storm$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({
      enqueuedAtMs: ctx.bl650.enqueuedAtMs,
      providerEvidence: ctx.bl650.providerEvidence,
    });
    ctx.bl650.noEvidenceResult = evaluateEffectiveAge({ enqueuedAtMs: ctx.bl650.enqueuedAtMs, providerEvidence: [] });
  }, FEATURE);

  registry.defineScoped(/^the retry-storm interval is subtracted from those parcels' effective age$/, (ctx) => {
    if (ctx.bl650.result.effectiveAgeMs !== 9 * MIN) {
      throw new Error(`expected 9m effective age after subtracting the 6m storm, got ${ctx.bl650.result.effectiveAgeMs}ms`);
    }
  }, FEATURE);

  registry.defineScoped(/^that interval is recorded as its own provider-outage class, distinct from swarm-stop intervals$/, (ctx) => {
    if (ctx.bl650.result.outageCount < 1) {
      throw new Error('expected at least one recorded provider-outage interval');
    }
  }, FEATURE);

  registry.defineScoped(/^an interval with no signature evidence in the transcript subtracts nothing$/, (ctx) => {
    if (ctx.bl650.noEvidenceResult.effectiveAgeMs !== ctx.bl650.noEvidenceResult.wallAgeMs) {
      throw new Error(`expected no-evidence effective age to equal wall age, got ${JSON.stringify(ctx.bl650.noEvidenceResult)}`);
    }
  }, FEATURE);

  // ── Scenario 09: legitimate-prerequisite-detour-not-a-stall ──────────────
  registry.defineScoped(/^a single resident is in_process on a parcel$/, (ctx) => {
    ctx.bl650 = { enqueuedAtMs: NOW_MS - 2 * MIN };
  }, FEATURE);

  registry.defineScoped(/^the resident detours to another stage to satisfy that same parcel's own prerequisite$/, () => {
    // The detour is legitimate active work on the SAME parcel's dependency -
    // no ledger/outage interval is recorded, so wall time keeps accruing as
    // active time exactly as it would for any other in-flight parcel.
  }, FEATURE);

  registry.defineScoped(/^the resident returns to the original parcel shortly after$/, () => {
    // "Shortly" - the detour is brief enough that the parcel's active age
    // stays well under warn by the time the next sweep observes it.
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweeps during the detour$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({ enqueuedAtMs: ctx.bl650.enqueuedAtMs });
  }, FEATURE);

  registry.defineScoped(/^no stall is alarmed for that parcel$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'none') {
      throw new Error(`expected no alarm during a short legitimate detour, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);

  // ── Scenario 10: orphaned-claim-still-alarms ──────────────────────────────
  registry.defineScoped(/^a single resident claimed a parcel and then never returns to it$/, (ctx) => {
    ctx.bl650 = { enqueuedAtMs: NOW_MS - (DEFAULT_WARN_MS + 1000) };
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweeps past the warn threshold of active time$/, (ctx) => {
    ctx.bl650.result = evaluateEffectiveAge({ enqueuedAtMs: ctx.bl650.enqueuedAtMs });
  }, FEATURE);

  registry.defineScoped(/^a WARN still fires for that orphaned claim$/, (ctx) => {
    if (ctx.bl650.result.tier !== 'warn') {
      throw new Error(`expected a WARN for the orphaned in_process claim, got tier "${ctx.bl650.result.tier}"`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
