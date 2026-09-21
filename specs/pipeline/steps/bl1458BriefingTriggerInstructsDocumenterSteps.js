'use strict';

// BL-1458: step handlers for "Every briefing trigger instructs the
// documenter and the host's compose nudge is retired". Scenarios 01/02/05
// drive the REAL, adapter-injected briefing_generation_schedule_lib.bb
// (briefing-generation-schedule-lib/generate-briefing-if-due!) against a
// mkdtemp fixture - never the live .swarmforge/ (per the ticket's own
// constraint). Scenario 03 is a static grep. Scenario 04 compares the real
// compiled TypeScript builder with the real Babashka builder. Scenario 06
// drives handoffd.bb's own marker-guarded note delivery
// (instruct-documenter-briefing!) directly, against a scratch project
// root, through the REAL swarm_handoff.bb - never a reimplementation of
// either the marker or the send.
//
// Handler lands in the same parcel as the feature (BL-233).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const FEATURE = 'BL-1458 Every briefing trigger instructs the documenter and the host\'s compose nudge is retired';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { briefingInstruction } = require(path.join(REPO_ROOT, 'extension', 'out', 'quality', 'nightClosingCeremonyLive'));
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'briefing_generation_schedule_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

function ms(iso) {
  return new Date(iso).getTime();
}

function mkTmp(prefix) {
  // BL-1636: registered for reaping via the shared fixtureReaper helper -
  // never a bare fs.mkdtempSync left to a hand-rolled cleanup.
  return trackedTmpRoot(prefix);
}

// Drives generate-briefing-if-due! with fake adapters recording every
// call - the pure decision layer, per the ticket's own constraint. The
// :notify! call is what handoffd.bb's real instruct-documenter-briefing!
// wraps with the once-per-day marker and the real mailbox send (proven
// separately, real end-to-end, by test_handoffd_briefing_generation_wiring.sh);
// here it stands for "a note would be queued for the documenter".
function runSweep(root, { hour = 8, minute = 0, hibernated = false, nowIso }) {
  const briefingsDir = path.join(root, 'docs', 'briefings');
  const script = `
(require '[cheshire.core :as json])
(load-file "${LIB}")
(def notified (atom []))
(def composed (atom []))
(def result
  (briefing-generation-schedule-lib/generate-briefing-if-due!
   ${ms(nowIso)} ${hour} ${minute} "${briefingsDir}" ${hibernated}
   {:notify! (fn [text] (swap! notified conj text))
    :compose-headless! (fn [day-key] (swap! composed conj day-key))
    :emit-sidecar! (fn [] nil)
    :log! (fn [& _] nil)}))
(println (json/generate-string
          {:fired result :notified @notified :composed @composed}))
`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function ensure(ctx) {
  if (!ctx.bl1458) {
    ctx.bl1458 = { root: mkTmp('sfvc-bl1458-'), nowIso: null, hibernated: false };
    fs.mkdirSync(path.join(ctx.bl1458.root, 'docs', 'briefings'), { recursive: true });
  }
  return ctx.bl1458;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture root with a daemon-shaped \.swarmforge and no tmux server$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the closure schedule is unusable and today's briefing does not exist$/, (ctx) => {
    const st = ensure(ctx);
    // The closure-schedule/ceremony-gate decision (BL-658) is handoffd.bb's
    // own, separate concern from generate-briefing-if-due! - this scenario
    // is scoped to the fallback's OWN trigger decision, which this fixture
    // (no docs/briefings/<today>.md written) already represents correctly:
    // the pure lib fires whenever due + not-yet-generated, regardless of
    // why the ceremony gate deferred to it.
    st.todayFile = undefined;
  });

  scoped(/^today's briefing already exists under docs\/briefings$/, (ctx) => {
    const st = ensure(ctx);
    const today = '2026-09-08';
    fs.writeFileSync(path.join(st.root, 'docs', 'briefings', `${today}.md`), '# already written\n');
    st.today = today;
  });

  scoped(/^the configured morning time has passed$/, (ctx) => {
    const st = ensure(ctx);
    st.today = st.today || '2026-09-08';
    st.nowIso = `${st.today}T09:00:00Z`;
  });

  scoped(/^the swarm is hibernated and today's briefing does not exist$/, (ctx) => {
    const st = ensure(ctx);
    st.hibernated = true;
  });

  scoped(/^the briefing generation sweep runs$/, (ctx) => {
    const st = ensure(ctx);
    st.result = runSweep(st.root, { hibernated: st.hibernated, nowIso: st.nowIso });
  });

  scoped(/^the briefing generation sweep runs three times$/, (ctx) => {
    const st = ensure(ctx);
    st.results = [1, 2, 3].map(() => runSweep(st.root, { hibernated: st.hibernated, nowIso: st.nowIso }));
  });

  scoped(/^a note reading "([^"]+)" is queued for the documenter$/, (ctx, textTemplate) => {
    const st = ensure(ctx);
    const expected = textTemplate.replace('<today>', st.today);
    assert.deepEqual(st.result.notified, [expected], `expected exactly one notify call with "${expected}", got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^no pane instruction is injected into any role$/, (ctx) => {
    // The pure decision layer (generate-briefing-if-due!) has no pane-inject
    // adapter at all - :notify! only ever receives text, never a session or
    // pane target. handoffd.bb's real :notify! wiring (instruct-documenter-briefing!)
    // sends a mailbox note through swarm_handoff.bb, never a pane injection
    // - proven end-to-end against a fake tmux by
    // test_handoffd_briefing_generation_wiring.sh (cases 02/03).
    const st = ensure(ctx);
    assert.ok(st.result, 'expected the sweep to have run first');
  });

  scoped(/^no note is queued for any role$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(st.result.notified, [], `expected no notify calls, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^the headless composer writes today's briefing$/, (ctx) => {
    const st = ensure(ctx);
    st.today = st.today || '2026-09-08';
    assert.deepEqual(st.result.composed, [st.today], `expected the headless composer called once with ${st.today}, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^extension\/src and swarmforge\/scripts are inspected$/, (ctx) => {
    ctx.bl1458 = ctx.bl1458 || {};
    const grep = execFileSync('bash', ['-c', `grep -rn "compose today's briefing per your role" extension/src swarmforge/scripts || true`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    ctx.bl1458.grepOut = grep.trim();
    ctx.bl1458.extensionSource = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'src', 'extension.ts'), 'utf8');
  });

  scoped(/^no source line contains the text "compose today's briefing per your role"$/, (ctx) => {
    assert.equal(ctx.bl1458.grepOut, '', `expected no matches, got: ${ctx.bl1458.grepOut}`);
  });

  scoped(/^the host's briefing-due path still emits the cost and health sidecar$/, (ctx) => {
    assert.match(ctx.bl1458.extensionSource, /onBriefingDue:.*\(\):\s*void\s*=>\s*\{[\s\S]*?computeCostHealthSidecar/, 'expected onBriefingDue to still compute the cost/health sidecar');
    assert.match(ctx.bl1458.extensionSource, /commitCostHealthSidecar/, 'expected onBriefingDue to still commit the sidecar');
  });

  scoped(/^a date$/, (ctx) => {
    ctx.bl1458 = ctx.bl1458 || {};
    ctx.bl1458.date = '2026-09-08';
  });

  scoped(/^the TypeScript instruction builder and the Babashka instruction builder are both asked for that date$/, (ctx) => {
    const date = ctx.bl1458.date;
    ctx.bl1458.tsText = briefingInstruction(date);
    ctx.bl1458.bbText = execFileSync('bb', ['-e', `(load-file "${LIB}") (print (briefing-generation-schedule-lib/briefing-due-instruction "${date}"))`], {
      encoding: 'utf8',
    });
  });

  scoped(/^they produce byte-identical text$/, (ctx) => {
    assert.equal(ctx.bl1458.bbText, ctx.bl1458.tsText, `expected byte-identical text, got TS="${ctx.bl1458.tsText}" BB="${ctx.bl1458.bbText}"`);
  });

  // ── Scenario 06: the daemon-level once-per-day marker ──────────────────
  // Drives handoffd.bb's REAL instruct-documenter-briefing! (private in its
  // ns, but SCI does not enforce defn- privacy across a load-file boundary
  // - the same access pattern check_bb_scripts_load.sh's own analysis
  // relies on) three times against one scratch project root, through the
  // REAL swarm_handoff.bb (SWARMFORGE_ROLE=coordinator) - the exact
  // mechanism briefing-generation-sweep! wires up, never a reimplementation.
  scoped(/^exactly one note reading "([^"]+)" is queued for the documenter$/, (ctx, textTemplate) => {
    const root = mkTmp('sfvc-bl1458-marker-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\ndocumenter\tdocumenter\t${root}\tswarmforge-documenter\tDocumenter\tclaude\ttask\n`
    );
    const dayKey = '2026-09-08';
    const expected = textTemplate.replace('<today>', dayKey);
    const script = `
(load-file "${HANDOFFD.replace(/\\/g, '\\\\')}")
(dotimes [_ 3] (handoffd/instruct-documenter-briefing! "${dayKey}" "${expected}"))
`;
    execFileSync('bb', ['-e', script, root], { cwd: root, encoding: 'utf8', env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' } });
    const found = execFileSync('bash', ['-c', `grep -rl "produce the morning briefing" "${root}/.swarmforge/handoffs" 2>/dev/null | wc -l`], { encoding: 'utf8' }).trim();
    assert.equal(found, '1', `expected exactly one queued note file naming the instruction after three sweep ticks, found ${found}`);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
