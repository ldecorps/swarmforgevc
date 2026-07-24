'use strict';

// BL-577: step handlers for "flow watchdog alarms on any parcel aged past
// threshold in any mailbox". Drives the REAL pure functions in
// swarmforge/scripts/flow_watchdog_lib.bb (decide-tier, decide-verb,
// parcel-age-ms, format-alarm-text, tier-decision-input-keys,
// prune-progressed-entries, parse-warn-ms/parse-escalate-ms, scan-mailbox-dir)
// via `bb -e`, mirroring bl576AgedNoteActionabilitySteps.js's own bbEval
// convention exactly. The full daemon-loop wiring (handoffd.bb's
// flow-watchdog-sweep!) is proven live by
// swarmforge/scripts/test/test_handoffd_flow_watchdog_wiring.sh; this
// ticket's own QA end-to-end procedure is the live verification beyond that.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const FEATURE = 'flow watchdog alarms on any parcel aged past threshold in any mailbox';

const NOW_ISO = '2026-07-24T12:00:00Z';
const NOW_MS = Date.parse(NOW_ISO);
const DEFAULT_WARN_MS = 900000;
const DEFAULT_ESCALATE_MS = 3600000;

// ── tiny EDN serializer (mirrors bl576's own convention) ────────────────────
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

// For an expr whose OWN return value is already a JSON string (e.g.
// cheshire.core/generate-string) - bbEval's pr-str would otherwise re-quote
// and escape that string, double-encoding it. This prints it verbatim so
// JSON.parse on the result works directly.
function bbEvalJson(expr) {
  const code = `(load-file "${LIB}") (println ${expr})`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval (json) failed for: ${expr}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

function keywordFromClj(edn) {
  // ":warn" -> "warn", ":none" -> "none", "nil" -> null
  if (edn === 'nil') return null;
  return edn.startsWith(':') ? edn.slice(1) : edn;
}

function registerSteps(registry) {
  // ── Scenario 01: over-threshold parcel in a dormant role's inbox alarms ──
  registry.defineScoped(/^a (git_handoff|note|broadcast note copy) parcel aged past the warn threshold sits in dormant role cleaner's inbox\/new$/, (ctx, type) => {
    ctx.bl577 = {
      ...(ctx.bl577 || {}),
      id: 'p-01', from: 'specifier', to: 'cleaner', type, role: 'cleaner', mailbox: 'new',
      enqueuedAt: new Date(NOW_MS - (DEFAULT_WARN_MS + 60000)).toISOString(),
      warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS,
    };
  }, FEATURE);

  registry.defineScoped(/^every liveness signal for cleaner reads healthy$/, (ctx) => {
    // Deliberately NOT fed into decide-tier at all — acceptance-05 proves the
    // tier decision's input map has no room for a liveness/dormancy signal.
    // Recorded here purely for scenario readability.
    ctx.bl577 = { ...(ctx.bl577 || {}), livenessHealthy: true, liveSession: false };
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweep runs$/, (ctx) => {
    if (ctx.bl577.progressed || ctx.bl577.parcels) {
      // Scenario 04 (progressed): already proven via prune-progressed-entries
      // in the "the parcel is <progress>" step - a progressed parcel is no
      // longer present in any mailbox, so no per-parcel tier is ever decided.
      // Scenario 12 (snooze): the per-parcel decisions are made explicitly in
      // "only the unsnoozed parcel alarms" below, over ctx.bl577.parcels.
      return;
    }
    if (ctx.bl577.unconfirmedFixtureRoot) {
      // Scenario 13: drives the real IMPURE run-sweep! (not the pure
      // decide-tier direct-call path the other scenarios use) end-to-end,
      // with a fake emit-alarm! adapter whose confirmation flips mid-run -
      // this is the only scenario that needs run-sweep!'s own state-write
      // gating (BL-577 bounce fix), so it is driven in one bb process to
      // keep the atoms/durable-state sequence coherent across sweeps.
      const root = ctx.bl577.unconfirmedFixtureRoot;
      const daemonDir = path.join(root, '.swarmforge', 'daemon');
      const newDir = path.join(root, 'cleaner', 'inbox', 'new');
      const inProcessDir = path.join(root, 'cleaner', 'inbox', 'in_process');
      const code = `
(load-file "${LIB}")
(def attempts (atom 0))
(def confirm? (atom false))
(def adapters {:live-session? (fn [_role] false)
               :emit-alarm! (fn [_text] (swap! attempts inc) @confirm?)})
(def inboxes [{:role "cleaner" :new-dir "${newDir}" :in-process-dir "${inProcessDir}"}])
(flow-watchdog-lib/run-sweep! inboxes ${NOW_MS} "${root}" "${daemonDir}" adapters)
(def tier1 (:tier (get (flow-watchdog-lib/read-state "${daemonDir}") :p-13)))
(def attempts1 @attempts)
(flow-watchdog-lib/run-sweep! inboxes ${NOW_MS + 1000} "${root}" "${daemonDir}" adapters)
(def tier2 (:tier (get (flow-watchdog-lib/read-state "${daemonDir}") :p-13)))
(def attempts2 @attempts)
(reset! confirm? true)
(flow-watchdog-lib/run-sweep! inboxes ${NOW_MS + 2000} "${root}" "${daemonDir}" adapters)
(def tier3 (:tier (get (flow-watchdog-lib/read-state "${daemonDir}") :p-13)))
(def attempts3 @attempts)
(flow-watchdog-lib/run-sweep! inboxes ${NOW_MS + 3000} "${root}" "${daemonDir}" adapters)
(def attempts4 @attempts)
(println (cheshire.core/generate-string {:tier1 tier1 :attempts1 attempts1 :tier2 tier2 :attempts2 attempts2 :tier3 tier3 :attempts3 attempts3 :attempts4 attempts4}))
`;
      const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`bb eval failed for scenario 13: ${result.stderr}`);
      }
      ctx.bl577.unconfirmedResult = JSON.parse(result.stdout.trim());
      return;
    }
    const s = ctx.bl577;
    const ageMs = Number(bbEval(`(flow-watchdog-lib/parcel-age-ms ${cljMap({
      'enqueued-at': s.enqueuedAt, 'now-ms': NOW_MS,
    })})`));
    const tier = keywordFromClj(bbEval(`(flow-watchdog-lib/decide-tier ${cljMap({
      'age-ms': ageMs, 'warn-ms': s.warnMs, 'escalate-ms': s.escalateMs,
      'highest-tier-alarmed': s.highestTierAlarmed ? raw(`:${s.highestTierAlarmed}`) : null,
      'snoozed?': !!s.snoozed,
    })})`));
    ctx.bl577.ageMs = ageMs;
    ctx.bl577.tier = tier;
    if (tier !== 'none') {
      const verb = keywordFromClj(bbEval(`(flow-watchdog-lib/decide-verb ${cljMap({
        mailbox: raw(`:${s.mailbox}`), 'live-session?': !!s.liveSession,
      })})`));
      ctx.bl577.verb = verb;
      ctx.bl577.alarmText = bbEval(`(flow-watchdog-lib/format-alarm-text ${cljMap({
        id: s.id, from: s.from, to: s.to, type: s.type, 'age-ms': ageMs,
        role: s.role, mailbox: raw(`:${s.mailbox}`), verb: raw(`:${verb}`), tier: raw(`:${tier}`),
      })})`).replace(/^"|"$/g, '');
      ctx.bl577.alarmCount = (ctx.bl577.alarmCount || 0) + 1;
    }
  }, FEATURE);

  registry.defineScoped(/^exactly one Telegram alarm is emitted for that parcel$/, (ctx) => {
    if (ctx.bl577.tier === 'none') {
      throw new Error(`expected an alarm, but decide-tier returned :none (age=${ctx.bl577.ageMs}ms, warn=${ctx.bl577.warnMs}ms)`);
    }
    if ((ctx.bl577.alarmCount || 0) !== 1) {
      throw new Error(`expected exactly one alarm, got ${ctx.bl577.alarmCount}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm names the parcel id, from role, to role, type, age, holding mailbox, and an unblock verb$/, (ctx) => {
    const text = ctx.bl577.alarmText;
    const s = ctx.bl577;
    const mustInclude = [s.id, `${s.from}->${s.to}`, s.type, s.role, s.mailbox, s.verb];
    for (const fragment of mustInclude) {
      if (!text.includes(fragment)) {
        throw new Error(`alarm text missing "${fragment}": ${text}`);
      }
    }
  }, FEATURE);

  // ── Scenario 02: repeated sweeps within one tier never repeat the alarm ──
  registry.defineScoped(/^a parcel already alarmed at the warn tier$/, (ctx) => {
    ctx.bl577 = {
      ...(ctx.bl577 || {}),
      id: 'p-02', from: 'specifier', to: 'cleaner', type: 'note', role: 'cleaner', mailbox: 'new',
      warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS,
      highestTierAlarmed: 'warn', liveSession: false,
    };
  }, FEATURE);

  registry.defineScoped(/^the parcel has not aged past the escalate threshold$/, (ctx) => {
    const ageMs = DEFAULT_WARN_MS + 60000;
    ctx.bl577.enqueuedAt = new Date(NOW_MS - ageMs).toISOString();
  }, FEATURE);

  registry.defineScoped(/^no new alarm is emitted for that parcel$/, (ctx) => {
    // Shared by scenario 02 (still within a tier) and scenario 04 (progressed
    // out of every mailbox entirely - already proven via prune-progressed-
    // entries, so there is no per-parcel tier to check at all here).
    if (ctx.bl577.progressed) {
      if (!ctx.bl577.prunedStateEmpty) {
        throw new Error('expected the progressed parcel\'s state entry to be pruned');
      }
      return;
    }
    if (ctx.bl577.tier !== 'none') {
      throw new Error(`expected no alarm (tier :none), got :${ctx.bl577.tier}`);
    }
  }, FEATURE);

  // ── Scenario 03: crossing the escalate tier re-alarms exactly once ──────
  registry.defineScoped(/^the parcel ages past the escalate threshold$/, (ctx) => {
    const ageMs = ctx.bl577.escalateMs + 60000;
    ctx.bl577.enqueuedAt = new Date(NOW_MS - ageMs).toISOString();
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog sweep runs twice$/, (ctx) => {
    const s = ctx.bl577;
    const runOnce = () => {
      const ageMs = Number(bbEval(`(flow-watchdog-lib/parcel-age-ms ${cljMap({
        'enqueued-at': s.enqueuedAt, 'now-ms': NOW_MS,
      })})`));
      const tier = keywordFromClj(bbEval(`(flow-watchdog-lib/decide-tier ${cljMap({
        'age-ms': ageMs, 'warn-ms': s.warnMs, 'escalate-ms': s.escalateMs,
        'highest-tier-alarmed': s.highestTierAlarmed ? raw(`:${s.highestTierAlarmed}`) : null,
        'snoozed?': !!s.snoozed,
      })})`));
      if (tier !== 'none') {
        s.highestTierAlarmed = tier;
        s.alarmCount = (s.alarmCount || 0) + 1;
        s.lastAlarmTier = tier;
      }
      return tier;
    };
    runOnce();
    runOnce();
  }, FEATURE);

  registry.defineScoped(/^exactly one escalate-tier alarm is emitted for that parcel$/, (ctx) => {
    if (ctx.bl577.lastAlarmTier !== 'escalate') {
      throw new Error(`expected the alarm to have reached escalate tier, got :${ctx.bl577.lastAlarmTier}`);
    }
    if ((ctx.bl577.alarmCount || 0) !== 1) {
      // The "already alarmed at the warn tier" Given is a precondition (a
      // prior sweep's own alarm, not counted here) - across the two sweeps
      // performed by this scenario, exactly one NEW alarm (the escalate) may
      // fire; the second sweep must not re-fire it.
      throw new Error(`expected exactly one NEW (escalate) alarm across both sweeps, got ${ctx.bl577.alarmCount}`);
    }
  }, FEATURE);

  // ── Scenario 04: a parcel that progresses never alarms again ────────────
  registry.defineScoped(/^the parcel is (claimed|completed|reaped)$/, (ctx, _progress) => {
    // All three progress kinds collapse to the SAME observable fact this
    // lib's contract cares about: the parcel is no longer present in any
    // watched new/in_process mailbox. prune-progressed-entries is the pure
    // fn that enacts "no longer present -> entry cleared, never re-alarmed".
    const prunedEdn = bbEval(
      '(flow-watchdog-lib/prune-progressed-entries {:p04 {:tier "warn" :alarmedAt ' + (NOW_MS - 1000) + '}} #{})'
    );
    ctx.bl577 = { ...(ctx.bl577 || {}), progressed: true, prunedStateEmpty: prunedEdn === '{}' };
  }, FEATURE);

  // ── Scenario 05: structurally unable to suppress by role, type, dormancy ─
  registry.defineScoped(/^the flow watchdog's tier decision function$/, (ctx) => {
    ctx.bl577 = { ...(ctx.bl577 || {}) };
  }, FEATURE);

  registry.defineScoped(/^its inputs carry only parcel age, thresholds, prior alarmed tier, and snooze state$/, () => {
    const keys = bbEval('flow-watchdog-lib/tier-decision-input-keys');
    for (const required of [':age-ms', ':warn-ms', ':escalate-ms', ':highest-tier-alarmed', ':snoozed?']) {
      if (!keys.includes(required)) {
        throw new Error(`tier-decision-input-keys missing ${required}: ${keys}`);
      }
    }
  }, FEATURE);

  registry.defineScoped(/^no role, type, or dormancy field reaches the decision$/, () => {
    const withoutExtras = bbEval(`(flow-watchdog-lib/decide-tier ${cljMap({
      'age-ms': 100, 'warn-ms': 60, 'escalate-ms': 600, 'highest-tier-alarmed': null, 'snoozed?': false,
    })})`);
    const withExtras = bbEval(`(flow-watchdog-lib/decide-tier ${cljMap({
      'age-ms': 100, 'warn-ms': 60, 'escalate-ms': 600, 'highest-tier-alarmed': null, 'snoozed?': false,
      role: 'cleaner', type: 'note', 'dormant?': true,
    })})`);
    if (withoutExtras !== withExtras) {
      throw new Error(`decide-tier's result changed when role/type/dormant? keys were present: ${withoutExtras} vs ${withExtras}`);
    }
    for (const forbidden of [':role', ':type', ':dormancy']) {
      const keys = bbEval('flow-watchdog-lib/tier-decision-input-keys');
      if (keys.includes(forbidden)) {
        throw new Error(`tier-decision-input-keys must never contain ${forbidden}: ${keys}`);
      }
    }
  }, FEATURE);

  // ── Scenario 06/07: header age clock, never mtime ───────────────────────
  registry.defineScoped(/^a parcel in a role's inbox\/new whose enqueued_at header is older than the warn threshold and whose file mtime is fresh$/, (ctx) => {
    ctx.bl577 = {
      ...(ctx.bl577 || {}),
      id: 'p-06', from: 'specifier', to: 'coder', type: 'note', role: 'coder', mailbox: 'new',
      warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS, liveSession: false,
      enqueuedAt: new Date(NOW_MS - (DEFAULT_WARN_MS + 60000)).toISOString(),
      // mtime is deliberately never passed to any flow_watchdog_lib.bb
      // function at all - there is no parameter for it.
    };
  }, FEATURE);

  registry.defineScoped(/^a warn-tier alarm is emitted for that parcel$/, (ctx) => {
    if (ctx.bl577.tier !== 'warn') {
      throw new Error(`expected warn-tier alarm, got :${ctx.bl577.tier}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a parcel in a role's inbox\/new whose enqueued_at header is fresher than the warn threshold and whose file mtime is old$/, (ctx) => {
    ctx.bl577 = {
      ...(ctx.bl577 || {}),
      id: 'p-07', from: 'specifier', to: 'coder', type: 'note', role: 'coder', mailbox: 'new',
      warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS, liveSession: false,
      enqueuedAt: new Date(NOW_MS - 60000).toISOString(),
    };
  }, FEATURE);

  // ── Scenario 08: master-resident / worktree, new / in_process coverage ──
  registry.defineScoped(/^an over-threshold parcel sits in the (master-resident specifier inbox\/new|master-resident coordinator inbox\/in_process|worktree cleaner inbox\/new|worktree QA inbox\/in_process) mailbox$/, (ctx, mailboxLabel) => {
    const roleMatch = /(?:master-resident|worktree) (\w+) inbox\/(new|in_process)/.exec(mailboxLabel);
    const role = roleMatch[1].toLowerCase();
    const mailbox = roleMatch[2];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl577-mailbox-'));
    const handoffFile = path.join(tmpDir, 'p08.handoff');
    const enqueuedAt = new Date(NOW_MS - (DEFAULT_WARN_MS + 60000)).toISOString();
    fs.writeFileSync(handoffFile, `id: p-08\nfrom: specifier\nto: ${role}\ntype: git_handoff\nenqueued_at: ${enqueuedAt}\n\nbody\n`);
    const records = bbEvalJson(`(cheshire.core/generate-string (flow-watchdog-lib/scan-mailbox-dir "${tmpDir}"))`);
    if (records.length !== 1 || records[0].id !== 'p-08') {
      throw new Error(`scan-mailbox-dir did not find the fixture parcel in ${mailboxLabel}: ${JSON.stringify(records)}`);
    }
    ctx.bl577 = {
      ...(ctx.bl577 || {}), id: 'p-08', from: 'specifier', to: role, type: 'git_handoff',
      role, mailbox, mailboxLabel, warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS,
      enqueuedAt, liveSession: false,
    };
  }, FEATURE);

  registry.defineScoped(/^an alarm is emitted naming the (master-resident specifier inbox\/new|master-resident coordinator inbox\/in_process|worktree cleaner inbox\/new|worktree QA inbox\/in_process) mailbox as the holder$/, (ctx, mailboxLabel) => {
    if (ctx.bl577.tier === 'none') {
      throw new Error('expected an alarm, got none');
    }
    if (!ctx.bl577.alarmText.includes(ctx.bl577.role) || !ctx.bl577.alarmText.includes(ctx.bl577.mailbox)) {
      throw new Error(`alarm text does not name the ${mailboxLabel} mailbox as holder: ${ctx.bl577.alarmText}`);
    }
  }, FEATURE);

  // ── Scenario 09: 2026-07-23 incidents replayed as fixtures ──────────────
  registry.defineScoped(/^the (wake-budget-starved architect git_handoff|ten-hour dead-lettered specifier note|unforwarded cleaner in_process parcel) fixture with its parcel aged just past the warn threshold$/, (ctx, incident) => {
    const shape = {
      'wake-budget-starved architect git_handoff': { role: 'architect', mailbox: 'new', type: 'git_handoff', liveSession: false },
      'ten-hour dead-lettered specifier note': { role: 'specifier', mailbox: 'new', type: 'note', liveSession: false },
      'unforwarded cleaner in_process parcel': { role: 'cleaner', mailbox: 'in_process', type: 'git_handoff', liveSession: true },
    }[incident];
    ctx.bl577 = {
      ...(ctx.bl577 || {}), id: 'p-09', from: 'specifier', to: shape.role, type: shape.type,
      role: shape.role, mailbox: shape.mailbox, liveSession: shape.liveSession,
      warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS,
      enqueuedAt: new Date(NOW_MS - (DEFAULT_WARN_MS + 60000)).toISOString(),
    };
  }, FEATURE);

  registry.defineScoped(/^an alarm is emitted for that parcel prescribing (rotate|investigate|expedite)$/, (ctx, expectedVerb) => {
    if (ctx.bl577.tier === 'none') {
      throw new Error('expected an alarm, got none');
    }
    if (ctx.bl577.verb !== expectedVerb) {
      throw new Error(`expected verb "${expectedVerb}", got "${ctx.bl577.verb}"`);
    }
  }, FEATURE);

  // ── Scenario 10: thresholds come from the effective config ──────────────
  registry.defineScoped(/^the effective config sets flow_watchdog_warn_ms to (\d+)$/, (ctx, ms) => {
    const confText = `config flow_watchdog_warn_ms ${ms}\n`;
    const parsed = Number(bbEval(`(flow-watchdog-lib/parse-warn-ms ${cljVal(confText)})`));
    if (parsed !== Number(ms)) {
      throw new Error(`expected parsed warn-ms ${ms}, got ${parsed}`);
    }
    ctx.bl577 = { ...(ctx.bl577 || {}), warnMs: parsed, escalateMs: DEFAULT_ESCALATE_MS };
  }, FEATURE);

  registry.defineScoped(/^a parcel aged (\d+) ms sits in a role's inbox\/new$/, (ctx, ageMs) => {
    ctx.bl577 = {
      ...(ctx.bl577 || {}), id: 'p-10', from: 'specifier', to: 'coder', type: 'note', role: 'coder', mailbox: 'new',
      liveSession: false, enqueuedAt: new Date(NOW_MS - Number(ageMs)).toISOString(),
    };
  }, FEATURE);

  // ── Scenario 11: malformed config falls back to defaults, never disables ─
  registry.defineScoped(/^the effective config's flow watchdog lines are malformed$/, (ctx) => {
    const confText = 'config flow_watchdog_warn_ms banana\nconfig flow_watchdog_escalate_ms banana\n';
    const warnMs = Number(bbEval(`(flow-watchdog-lib/parse-warn-ms ${cljVal(confText)})`));
    const escalateMs = Number(bbEval(`(flow-watchdog-lib/parse-escalate-ms ${cljVal(confText)})`));
    if (warnMs !== DEFAULT_WARN_MS || escalateMs !== DEFAULT_ESCALATE_MS) {
      throw new Error(`expected defaults on malformed config, got warn=${warnMs} escalate=${escalateMs}`);
    }
    ctx.bl577 = { ...(ctx.bl577 || {}), warnMs, escalateMs };
  }, FEATURE);

  registry.defineScoped(/^a parcel aged past the default warn threshold sits in a role's inbox\/new$/, (ctx) => {
    ctx.bl577 = {
      ...(ctx.bl577 || {}), id: 'p-11', from: 'specifier', to: 'coder', type: 'note', role: 'coder', mailbox: 'new',
      liveSession: false, enqueuedAt: new Date(NOW_MS - (DEFAULT_WARN_MS + 60000)).toISOString(),
    };
  }, FEATURE);

  // ── Scenario 12: per-parcel snooze mutes only the snoozed parcel ────────
  registry.defineScoped(/^two over-threshold parcels where exactly one carries a snooze entry in the watchdog state file$/, (ctx) => {
    const shared = {
      warnMs: DEFAULT_WARN_MS, escalateMs: DEFAULT_ESCALATE_MS, liveSession: false,
      enqueuedAt: new Date(NOW_MS - (DEFAULT_WARN_MS + 60000)).toISOString(),
    };
    ctx.bl577 = {
      ...(ctx.bl577 || {}),
      parcels: [
        { ...shared, id: 'p-12a', from: 'specifier', to: 'cleaner', type: 'note', role: 'cleaner', mailbox: 'new', snoozed: false },
        { ...shared, id: 'p-12b', from: 'specifier', to: 'cleaner', type: 'note', role: 'cleaner', mailbox: 'new', snoozed: true },
      ],
    };
  }, FEATURE);

  registry.defineScoped(/^only the unsnoozed parcel alarms$/, (ctx) => {
    const results = ctx.bl577.parcels.map((p) => {
      const ageMs = Number(bbEval(`(flow-watchdog-lib/parcel-age-ms ${cljMap({ 'enqueued-at': p.enqueuedAt, 'now-ms': NOW_MS })})`));
      const tier = keywordFromClj(bbEval(`(flow-watchdog-lib/decide-tier ${cljMap({
        'age-ms': ageMs, 'warn-ms': p.warnMs, 'escalate-ms': p.escalateMs,
        'highest-tier-alarmed': null, 'snoozed?': !!p.snoozed,
      })})`));
      return { id: p.id, tier };
    });
    const alarmed = results.filter((r) => r.tier !== 'none');
    if (alarmed.length !== 1 || alarmed[0].id !== 'p-12a') {
      throw new Error(`expected only p-12a to alarm, got: ${JSON.stringify(results)}`);
    }
    ctx.bl577.snoozeResults = results;
  }, FEATURE);

  registry.defineScoped(/^the snooze entry remains readable in the watchdog state file$/, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl577-state-'));
    bbEval(`(flow-watchdog-lib/write-state! "${tmpDir}" ${cljMap({ 'p-12b': raw('{:tier "warn" :snoozed true}') })})`);
    const stateAfterPrune = bbEval(`(flow-watchdog-lib/prune-progressed-entries (flow-watchdog-lib/read-state "${tmpDir}") #{"p-12b"})`);
    if (!stateAfterPrune.includes(':snoozed true')) {
      throw new Error(`expected the snooze entry to remain readable, got: ${stateAfterPrune}`);
    }
  }, FEATURE);

  // ── Scenario 13: an unconfirmed write is retried, never recorded as sent ─
  registry.defineScoped(/^an over-threshold parcel and an alarm channel whose write fails or is uncertain$/, (ctx) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl577-unconfirmed-'));
    fs.mkdirSync(path.join(tmpDir, 'swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'swarmforge', 'swarmforge.conf'),
      'config flow_watchdog_warn_ms 60000\nconfig flow_watchdog_escalate_ms 240000\n'
    );
    const newDir = path.join(tmpDir, 'cleaner', 'inbox', 'new');
    fs.mkdirSync(newDir, { recursive: true });
    const enqueuedAt = new Date(NOW_MS - 90000).toISOString();
    fs.writeFileSync(
      path.join(newDir, 'p13.handoff'),
      `id: p-13\nfrom: specifier\nto: cleaner\ntype: note\nenqueued_at: ${enqueuedAt}\n\nbody\n`
    );
    ctx.bl577 = { ...(ctx.bl577 || {}), unconfirmedFixtureRoot: tmpDir };
  }, FEATURE);

  registry.defineScoped(/^the parcel's tier is not recorded in the watchdog state file$/, (ctx) => {
    const r = ctx.bl577.unconfirmedResult;
    if (r.tier1 !== null) {
      throw new Error(`expected the tier NOT recorded after an unconfirmed emit-alarm!, got: ${r.tier1}`);
    }
    if (r.attempts1 !== 1) {
      throw new Error(`expected exactly one emit-alarm! attempt on the first sweep, got: ${r.attempts1}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a subsequent sweep re-attempts the alarm for that parcel$/, (ctx) => {
    const r = ctx.bl577.unconfirmedResult;
    if (r.attempts2 !== 2) {
      throw new Error(`expected the second sweep to retry the unconfirmed alarm, total attempts: ${r.attempts2}`);
    }
    if (r.tier2 !== null) {
      throw new Error(`expected the tier to still be unrecorded while unconfirmed, got: ${r.tier2}`);
    }
  }, FEATURE);

  registry.defineScoped(/^once the alarm channel confirms the write, the tier is recorded and no further re-attempt occurs$/, (ctx) => {
    const r = ctx.bl577.unconfirmedResult;
    if (r.tier3 !== 'warn') {
      throw new Error(`expected the tier recorded once emit-alarm! confirms the write, got: ${r.tier3}`);
    }
    if (r.attempts3 !== 3) {
      throw new Error(`expected the confirming sweep itself to be the third attempt, got: ${r.attempts3}`);
    }
    if (r.attempts4 !== 3) {
      throw new Error(`expected no further attempt once the tier is recorded and unchanged, got: ${r.attempts4}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
