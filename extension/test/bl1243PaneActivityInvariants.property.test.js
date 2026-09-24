'use strict';

// BL-1243's two declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "A tile is never painted ok on a signal it did not derive from
// its own pane: an unavailable or never-captured pane is never green."
//
//   The defect BL-1160 left open is a reader with no writer: every tile fell
//   through to the whole-poll aggregate, so all eight dots moved together and
//   a dead pane went green because the POLL was fresh. So the property is
//   stated as an implication over the REAL reader - if a tile paints ok, that
//   ok came from the pane's own signal - and the aggregate is drawn
//   adversarially, including 'ok', because an aggregate that is never green
//   cannot expose the defect at all.
//
//   Reach is by construction over the pane SHAPES that exist: busy, idle,
//   blank capture, and no capture at all, each with its own floor. Drawing
//   random strings instead would spend nearly every run on "idle", and the
//   textless shapes - the ones invariant 1 is actually about - would go
//   unexercised.
//
// Invariant 2 - "The per-tile signal performs no tmux capture and no poll
// beyond those the Live Screen snapshot already performs."
//
//   The operator's own stop condition: this ticket ships only if the signal is
//   CPU on data already paid for. Asserted behaviourally rather than by
//   reading the source - every child-process entry point is replaced with a
//   throw for the duration, so any reach for tmux fails the run rather than
//   merely looking absent to a grep.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const childProcess = require('node:child_process');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { derivePaneActivitySignal } = require('../out/bridge/residentPaneLive');

const FIXTURES = path.join(__dirname, '..', '..', 'specs', 'features', 'fixtures', 'BL-970');
const UI_SOURCE = path.join(__dirname, '..', 'src', 'bridge', 'residentSpyUiHtml.ts');

const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

// The browser's own resolver, lifted from the UI source. A hand-written copy
// would be a second rule that could drift from the one that paints the dot.
function loadResolver() {
  const source = fs.readFileSync(UI_SOURCE, 'utf8');
  const fn = /function resolvePaneStatusKind\(pane, aggregateKind\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(fn, 'resolvePaneStatusKind has moved or been renamed');
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}\nreturn resolvePaneStatusKind;`)();
}

const SHAPES = {
  busy: () => ({ available: true, paneText: fixture('midturn-esc-footer.txt') }),
  idle: () => ({ available: true, paneText: fixture('idle-real-qa-4-shells.txt') }),
  blank: () => ({ available: true, paneText: fixture('empty-capture.txt') }),
  uncaptured: () => ({ available: false }),
};
const SHAPE_FLOOR = 12;
const AGGREGATES = ['ok', 'stale', 'err'];

describe('BL-1243 invariant 1: green never comes from anywhere but the pane', () => {
  const resolve = loadResolver();

  it('paints ok only when the pane own signal says ok', () => {
    const coverage = {};
    // BL-1691: the outer shape loop was already constructed; the INNER
    // aggregate draw was still sampled (fc.constantFrom over 3 values).
    // Nested: shape x aggregate, runsPerCell(SHAPE_FLOOR, AGGREGATES.length)
    // per cell (12/3 = 4) - the same 4 the pre-existing floors below
    // already named, now reached by construction rather than hoped for.
    const AGGREGATE_RUNS = runsPerCell(SHAPE_FLOOR, AGGREGATES.length);
    for (const shape of Object.keys(SHAPES)) {
      for (const aggregate of AGGREGATES) {
        fc.assert(
          fc.property(fc.constant(aggregate), (aggregate) => {
            coverage[shape] = (coverage[shape] || 0) + 1;
            coverage[`aggregate:${aggregate}`] = (coverage[`aggregate:${aggregate}`] || 0) + 1;

            const base = SHAPES[shape]();
            const pane = { ...base, activitySignal: derivePaneActivitySignal(base.paneText) };
            const painted = resolve(pane, aggregate);

            // BL-1243 scenario 06: a FAILED poll outranks every per-pane signal,
            // because the view is repainting the last snapshot and none of those
            // signals is current any more.
            if (aggregate === 'err') {
              coverage['aggregate:err:checked'] = (coverage['aggregate:err:checked'] || 0) + 1;
              assert.equal(painted, 'err', `a ${shape} pane was painted ${painted} while the poll was failing`);
              return true;
            }
            if (painted === 'ok') {
              assert.equal(
                pane.activitySignal,
                'ok',
                `a ${shape} pane painted ok on a signal it did not derive from itself (aggregate ${aggregate})`
              );
            }
            if (shape === 'blank' || shape === 'uncaptured') {
              assert.notEqual(painted, 'ok', `a ${shape} pane went green`);
            }
            return true;
          }),
          { numRuns: AGGREGATE_RUNS }
        );
      }
    }
    assertReachFloor(coverage, Object.keys(SHAPES), SHAPE_FLOOR, 'pane shape');
    // An aggregate that is never 'ok' cannot expose the defect this invariant
    // is about, so the green aggregate carries its own floor.
    assertReachFloor(coverage, ['aggregate:ok'], AGGREGATE_RUNS, 'green aggregate draws');
    // ...and the failed-poll clause must actually have been exercised too.
    assertReachFloor(coverage, ['aggregate:err:checked'], AGGREGATE_RUNS, 'failed-poll draws');
  });

  it('lets two panes under one aggregate disagree, which is the whole point', () => {
    const coverage = {};
    fc.assert(
      fc.property(fc.constantFrom(...AGGREGATES), (aggregate) => {
        coverage.draw = (coverage.draw || 0) + 1;
        if (aggregate === 'err') {
          // A failed poll paints every tile err by design (scenario 06), so
          // "they must differ" is not a claim about this case.
          return true;
        }
        const busy = SHAPES.busy();
        const idle = SHAPES.idle();
        const paint = (p) => resolve({ ...p, activitySignal: derivePaneActivitySignal(p.paneText) }, aggregate);
        assert.notEqual(paint(busy), paint(idle), `both tiles painted alike under aggregate ${aggregate}`);
        return true;
      }),
      { numRuns: 30 }
    );
    assertReachFloor(coverage, ['draw'], 30, 'same-poll comparisons');
  });
});

describe('BL-1243 invariant 2: the signal costs no capture and no poll', () => {
  it('touches no child process, for any pane text at all', () => {
    const spawnEntryPoints = ['spawnSync', 'execFileSync', 'execSync', 'spawn', 'execFile', 'exec', 'fork'];
    const saved = {};
    for (const name of spawnEntryPoints) {
      saved[name] = childProcess[name];
      childProcess[name] = () => {
        throw new Error(`BL-1243: the per-pane signal reached for child_process.${name}`);
      };
    }
    const coverage = {};
    // BL-1691: text/blank/absent constructed as three cells, each with a
    // generator that guarantees its own shape - the real fixture files
    // (non-blank pane captures) for 'text' (empty-capture.txt excluded -
    // it is itself blank, the fixture SHAPES's own 'blank' member), a
    // fixed empty string for 'blank', a fixed undefined for 'absent'.
    const INPUT_SHAPE_GENERATORS = {
      text: () => fc.constantFrom(...fs.readdirSync(FIXTURES).map((n) => fixture(n)).filter((t) => t.trim())),
      blank: () => fc.constant(''),
      absent: () => fc.constant(undefined),
    };
    const INPUT_SHAPES = Object.keys(INPUT_SHAPE_GENERATORS);
    const PER_SHAPE_RUNS = runsPerCell(200, INPUT_SHAPES.length);
    try {
      for (const shape of INPUT_SHAPES) {
        fc.assert(
          fc.property(INPUT_SHAPE_GENERATORS[shape](), (text) => {
            const actualShape = text === undefined ? 'absent' : text.trim() ? 'text' : 'blank';
            assert.equal(actualShape, shape, `the ${shape} cell's own generator produced a ${actualShape} value`);
            coverage[shape] = (coverage[shape] || 0) + 1;
            const signal = derivePaneActivitySignal(text);
            assert.ok(
              signal === undefined || ['ok', 'stale', 'err'].includes(signal),
              `the signal left the palette: ${signal}`
            );
            return true;
          }),
          { numRuns: PER_SHAPE_RUNS }
        );
      }
    } finally {
      for (const name of spawnEntryPoints) {
        childProcess[name] = saved[name];
      }
    }
    // All three input shapes, or the "no capture" claim is only proven for
    // whichever one the draw happened to favour.
    assertReachFloor(coverage, INPUT_SHAPES, PER_SHAPE_RUNS, 'input shape');
  });

  it('is a pure function: the same pane text always answers the same way', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        assert.equal(derivePaneActivitySignal(text), derivePaneActivitySignal(text));
        return true;
      }),
      { numRuns: 60 }
    );
  });
});
