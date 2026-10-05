'use strict';

// BL-1836 declared invariants (coder first authorship - BL-654):
//
// 1. Every briefing the closing ceremony puts on main is the documenter's own
//    commit, byte-identical; the ceremony composes none.
// 2. The ceremony never stops the swarm while a documenter commit adding only
//    the day's briefing exists and is not yet on main.
// 3. The ceremony reads docs/briefings/.sent.json in the shape the email
//    sweep writes (one shape, asserted on both sides, BL-897).
//
// 1 and 2 drive the REAL runner (runNightClosingCeremony) through random
// tick sequences over a modelled repo: main's briefing (absent, or some
// content), the documenter branch's newest briefing commit (none, a pure
// add, or one that also touches another path), its arrival tick, and the
// clock (before or past the hard deadline); half the draws are built so a
// pure add arrives on the deadline tick itself. The model's land dep obeys the
// real landDocumenterBriefing's contract (pure add only, never over a
// briefing main has); its main dep reports the modelled main. Generator
// reach is asserted: stops with a pure add that arrived on the deadline
// tick itself, landings before the deadline, and loud missing stops.
//
// 3 writes random ledgers with briefing_email_lib.bb's own writer (one bb
// process for every draw) and reads each with the runner's briefingSent.
//
// Non-vacuity: with the runner's landing step removed (landBriefingIfDue
// returning null), invariant 2 fails on the first pure add; with
// briefingSent reading a bare list again, invariant 3 fails. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const { runNightClosingCeremony, briefingSent } = require('../out/tools/night-closing-ceremony-run');

const DAY = '2099-01-01';
const T0 = new Date(2099, 0, 1, 12, 0, 0).getTime();
const DEADLINE = T0 + 60 * 60_000;

const anyScenario = fc.record({
  mainStart: fc.constantFrom(null, 'main-own'),
  docKind: fc.constantFrom('none', 'pure', 'impure'),
  // Tick index the documenter's commit appears at (may be past the last tick).
  docArrives: fc.nat({ max: 6 }),
  ticks: fc.integer({ min: 1, max: 6 }),
  // Index of the first tick at or past the deadline (>= ticks: never).
  deadlineAt: fc.nat({ max: 7 }),
});

// The state invariant 2 is about, built rather than hoped for: a pure add
// that first exists on the very tick the deadline passes, main empty.
const arrivesOnTheDeadline = fc.nat({ max: 5 }).map((at) => ({
  mainStart: null,
  docKind: 'pure',
  docArrives: at,
  ticks: at + 1,
  deadlineAt: at,
}));

const scenario = fc.oneof(anyScenario, arrivesOnTheDeadline);

function simulate(sc) {
  const repo = { main: sc.mainStart, doc: null };
  const writesToMain = [];
  const events = [];
  let state = {
    nightKey: DAY,
    phase: 'briefing',
    sequence: ['freeze-promotion', 'lean-packet'],
    startedAtMs: T0 - 1,
    drainDeadlineMs: T0 - 1,
    hardDeadlineMs: DEADLINE,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: true,
    hadInFlight: false,
  };
  const docContent = `# ${DAY}\n\nthe documenter's words\n`;
  const deps = {
    readConf: () => '',
    evaluate: () => ({ mode: 'ceremony', ceremonyDue: true, closureStopLocal: '06:00' }),
    readState: () => state,
    writeState: (_t, s) => {
      state = s;
    },
    scanInFlight: () => ({ count: 0, roles: [] }),
    scanHeld: () => [],
    readActiveRole: () => 'documenter',
    briefingSent: () => false,
    applyFreeze: () => {},
    rotateDocumenter: () => {},
    instructBriefing: () => {},
    nightStop: () => events.push({ kind: 'stop', main: repo.main, doc: repo.doc }),
    surface: (_t, code) => events.push({ kind: 'surface', code }),
    recordCnp: () => {},
    deliverLeanPacket: () => [],
    recordEmptyOutcome: () => [],
    workedAShift: () => true,
    // The real landDocumenterBriefing's contract: only a pure add, never
    // over a briefing main already has, content byte-identical.
    landDocumenterBriefing: () => {
      if (repo.main !== null || !repo.doc || !repo.doc.pure) return null;
      repo.main = repo.doc.content;
      writesToMain.push(repo.doc.content);
      events.push({ kind: 'land' });
      return 'a'.repeat(40);
    },
    mainHasBriefing: () => repo.main !== null,
  };
  for (let i = 0; i < sc.ticks && state.phase !== 'done'; i += 1) {
    if (sc.docKind !== 'none' && i === sc.docArrives) {
      repo.doc = { content: docContent, pure: sc.docKind === 'pure' };
    }
    const now = i >= sc.deadlineAt ? DEADLINE + i : T0 + i;
    events.push({ kind: 'tick', i, pastDeadline: now >= DEADLINE });
    const r = runNightClosingCeremony('/model', '/nonexistent.conf', now, deps, false, 'finish-shift');
    for (const a of r.actions) {
      assert.ok(['surface', 'night-stop'].includes(a.kind), `unexpected action ${a.kind}`);
    }
  }
  return { repo, writesToMain, events, state, docContent };
}

test(
  'BL-1836/BL-654 invariants 1 and 2: only the documenter\'s briefing reaches main, and no stop strands one',
  () => {
    const reach = { stopAfterDeadlineLand: 0, landBeforeDeadline: 0, loudStop: 0 };
    fc.assert(
      fc.property(scenario, (sc) => {
        const { writesToMain, events, docContent } = simulate(sc);
        // Invariant 1: the only write to main is the documenter's own content.
        for (const w of writesToMain) assert.equal(w, docContent);
        // Invariant 2: at every stop, a pure-add documenter commit is on main.
        for (const e of events.filter((x) => x.kind === 'stop')) {
          if (e.doc && e.doc.pure && sc.mainStart === null) assert.equal(e.main, e.doc.content);
        }
        const ticks = events.filter((x) => x.kind === 'tick');
        const lastTick = ticks[ticks.length - 1];
        const landIdx = events.findIndex((x) => x.kind === 'land');
        if (landIdx >= 0) {
          const tickOfLand = events.slice(0, landIdx).filter((x) => x.kind === 'tick').pop();
          if (tickOfLand.pastDeadline && events.some((x) => x.kind === 'stop')) reach.stopAfterDeadlineLand += 1;
          if (!tickOfLand.pastDeadline) reach.landBeforeDeadline += 1;
        }
        if (lastTick && events.some((x) => x.kind === 'surface' && x.code === 'closing-briefing-missing')) {
          reach.loudStop += 1;
        }
      }),
      // Seeded (2026-10-05 hotfix): unseeded, 400 draws fell below the
      // landed-before-the-deadline floor of 5 on 0.7% of runs (2 of 300 seeds;
      // mean 11.2, lowest 4) - QA's BL-1939 gather drew 4. Seed 1 draws 11
      // (the other two floors: 207 and 40).
      { numRuns: 400, seed: 1 }
    );
    assert.ok(reach.stopAfterDeadlineLand >= 5, `landed on the stopping tick: ${JSON.stringify(reach)}`);
    assert.ok(reach.landBeforeDeadline >= 5, `landed before the deadline: ${JSON.stringify(reach)}`);
    assert.ok(reach.loudStop >= 5, `loud stops: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  "BL-1836/BL-654 invariant 3: the ceremony reads the ledger the sweep's own writer produces",
  () => {
    const days = ['2099-01-01', '2099-01-02', '2099-01-03', '2026-09-30', '2026-10-01'];
    const draws = fc.sample(fc.record({ sent: fc.subarray(days), probe: fc.constantFrom(...days) }), 60);
    const root = mkTmpDir('bl1836-ledger-');
    const dirs = draws.map((_, i) => path.join(root, String(i), 'docs', 'briefings'));
    dirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));
    const lib = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'briefing_email_lib.bb');
    const calls = draws
      .map((d, i) => d.sent.map((day) => `(briefing-email-lib/record-briefing-sent! ${JSON.stringify(dirs[i])} "${day}.md")`).join(' '))
      .join('\n');
    execFileSync('bb', ['-e', `(load-file ${JSON.stringify(lib)})\n${calls}`], { stdio: 'pipe' });
    let positives = 0;
    draws.forEach((d, i) => {
      const expected = d.sent.includes(d.probe);
      if (expected) positives += 1;
      assert.equal(briefingSent(path.join(root, String(i)), d.probe), expected, JSON.stringify(d));
    });
    assert.ok(positives >= 10 && positives <= draws.length - 10, `positives: ${positives}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
