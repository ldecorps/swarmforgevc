'use strict';

// BL-1003 declared invariant 1 (property authorship rests with the coder,
// first pass - BL-654): "the two sides return the same verdict for every
// capture in the shared fixture set, in BOTH directions... each direction
// comes from a different missing half of the definition." The fixture set
// is necessarily finite (7 captures); this property generalizes the claim
// generatively - random pane text, drawn from the SAME two shapes BL-970's
// own property runner (bl970_busy_gate_property_runner.bb) uses (idle
// footer text contaminated with false-busy shapes, and live status frames
// with random verbs/glyphs/ellipsis forms) - and asserts the REAL
// TypeScript isPaneActivelyProcessing (in-process) and the REAL Babashka
// chase_sweep_lib.bb actively-processing? agree on every draw. Proves the
// port is faithful across the open space the fixed fixture set cannot
// cover, not only on the 7 examples both sides happen to have been checked
// against.
//
// Deliberately NOT one bb subprocess call per fast-check draw: measured
// ~3-4s per call (dominated by load-file'ing chase_sweep_lib.bb), which
// made a naive per-draw design time out well under any reasonable run
// count. All draws are generated first, submitted to the real Babashka
// classifier in ONE batched call (bl1003_classify_pane_runner.bb, stdin
// JSON array in, JSON array of verdicts out), then compared - still a
// generative sweep against the real classifier, just batched for cost.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isPaneActivelyProcessing } = require('../out/panel/agentPaneState');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1003_classify_pane_runner.bb');

const DRAWS = 60;
const rng = (() => {
  // Small deterministic LCG, seeded from the wall clock at collection time -
  // varies run to run (matching this project's own bl970-style property
  // runner convention of a fresh random seed per run) without pulling in a
  // dependency; reach floors below are checked on every run regardless of
  // seed.
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
function randInt(n) {
  return Math.floor(rng() * n);
}
function randBool() {
  return randInt(2) === 0;
}
function randWord() {
  const len = 4 + randInt(8);
  let w = '';
  for (let i = 0; i < len; i += 1) {
    w += String.fromCharCode(97 + randInt(26));
  }
  return w;
}
function randNth(xs) {
  return xs[randInt(xs.length)];
}

const spinnerGlyphs = ['✻', '✽', '✶', '✳', '◐', '◓'];
const contaminationLines = [
  () => `  ⏵⏵ bypass permissions on · ${randWord()} still running`,
  () => `⏺ transcript detail line: ${randWord()} ${randWord()}`,
];

function buildFrameLine() {
  const twoWord = randBool();
  const ascii = randBool();
  const verb = twoWord ? `${randWord()} ${randWord()}` : randWord();
  const ellipsis = ascii ? '...' : '…';
  return `${randNth(spinnerGlyphs)} ${verb}${ellipsis} (${1 + randInt(120)}s · x)`;
}

// The footer (idle prompt + chrome) is always exactly 4 lines - the tail
// window is 20, so a frame line placed above at least 20 filler lines
// after it sits entirely outside the window (the BL-970 zone-layer case:
// a byte-perfect frame line quoted deep in scrollback must not false-busy
// a pane whose tail shows the idle prompt). Without this, a property
// sweep whose idle panes are all shorter than the tail window can never
// exercise the tail-window restriction at all - confirmed live: an
// earlier draft's contamination shapes were never frame-shaped, and
// removing the restriction entirely still passed every draw.
function buildIdlePane() {
  const scroll = [];
  const aboveWindowFrame = randInt(3) === 0;
  const n = aboveWindowFrame ? 22 + randInt(6) : 2 + randInt(6);
  for (let i = 0; i < n; i += 1) {
    if (aboveWindowFrame && i === 0) {
      scroll.push(buildFrameLine());
    } else {
      scroll.push(randInt(3) === 0 ? randNth(contaminationLines)() : `  transcript ${randWord()} ${randWord()}`);
    }
  }
  scroll.push('✻ Worked for 4m 12s');
  scroll.push('───────────────────── SwarmForge Coder ─');
  scroll.push('❯');
  scroll.push('  ⏵⏵ bypass permissions on (shift+tab to cycle)');
  return scroll.join('\n');
}

function buildBusyPane() {
  const frame = buildFrameLine();
  const preamble = [];
  const n = randInt(6);
  for (let i = 0; i < n; i += 1) {
    preamble.push(`⏺ ${randWord()} ${randWord()}`);
  }
  preamble.push(frame);
  preamble.push('───────────────────── SwarmForge Coder ─');
  preamble.push('❯');
  preamble.push('  ⏵⏵ bypass permissions on (shift+tab to cycle)');
  return preamble.join('\n');
}

test('BL-1003/BL-654 invariant 1: the TypeScript port agrees with the real Babashka classifier on random panes', () => {
  const draws = [];
  const kinds = [];
  for (let i = 0; i < DRAWS; i += 1) {
    const kind = randBool() ? 'idle' : 'busy';
    kinds.push(kind);
    draws.push(kind === 'idle' ? buildIdlePane() : buildBusyPane());
  }

  const out = execFileSync('bb', [RUNNER], { encoding: 'utf8', input: JSON.stringify(draws) });
  const babashkaVerdicts = JSON.parse(out);
  assert.equal(babashkaVerdicts.length, DRAWS, 'the runner must return one verdict per draw');

  const idleCount = kinds.filter((k) => k === 'idle').length;
  const busyCount = DRAWS - idleCount;
  assert.ok(idleCount >= 15, `generator coverage: idle draws reached only ${idleCount} of ${DRAWS} (floor 15)`);
  assert.ok(busyCount >= 15, `generator coverage: busy draws reached only ${busyCount} of ${DRAWS} (floor 15)`);

  const mismatches = [];
  draws.forEach((pane, i) => {
    const ts = isPaneActivelyProcessing(pane);
    const bb = babashkaVerdicts[i];
    if (ts !== bb) {
      mismatches.push(`draw ${i} (${kinds[i]}): TypeScript=${ts} Babashka=${bb}\n${pane}`);
    }
  });

  assert.equal(mismatches.length, 0, `${mismatches.length} of ${DRAWS} draws disagreed:\n\n${mismatches.join('\n\n')}`);
});

// Non-vacuity (staged-first restore, run 2026-08-20, recorded in the parcel
// commit): break 1 - the tail-window slice removed from the TypeScript
// side (whole text scanned) - RED on the first idle-contaminated draw
// whose quoted-marker-shaped line sits above the tail. break 2 - the
// structural pattern replaced by a bare substring test on the TypeScript
// side - RED on the first random-verb busy draw. Both restored, ALL
// PROPERTIES HOLD.
