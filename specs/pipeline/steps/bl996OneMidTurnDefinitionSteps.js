'use strict';

// BL-996: step handlers for "One definition of a mid-turn pane". Drives the
// three REAL Babashka classifiers (chase_sweep_lib.bb's actively-processing?
// - the BL-970 chokepoint, babysitterd_sweep_lib.bb's classify-pane-busy?,
// loop_detect_lib.bb's classify-pane-loop-signal) via
// bl996_classify_pane_runner.bb - mirrors every other acceptance step
// file's execFileSync-a-real-bb-CLI pattern. Every scenario is scoped to
// this feature's own title (registry.defineScoped) - "one definition"-style
// generic step text risks collision with unrelated tickets' step files,
// the exact BL-993/BL-425 lesson this session already hit once.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'specs', 'features', 'fixtures', 'BL-996');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl996_classify_pane_runner.bb');

const FEATURE = 'One definition of a mid-turn pane';

function classify(fixturePath) {
  const out = execFileSync('bb', [RUNNER, fixturePath], { encoding: 'utf8' });
  return JSON.parse(out);
}

const CONSUMER_VERDICT = {
  'the wake gate': (v) => v.wakeGate,
  'the babysitter health check': (v) => v.babysitter,
  'the endless-loop detector': (v) => v.loop === 'busy',
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── idle-pane-with-a-quoted-marker-01 ────────────────────────────────
  scoped(/^a pane resting at the idle prompt whose scrollback quotes the busy footer$/, (ctx) => {
    ctx.fixturePath = path.join(FIXTURE_DIR, 'idle-with-quoted-marker.txt');
  });

  // ── live-mid-turn-pane-02 ─────────────────────────────────────────────
  scoped(/^a pane rendering a live turn-status frame$/, (ctx) => {
    ctx.fixturePath = path.join(FIXTURE_DIR, 'live-turn-status-frame.txt');
  });

  // Also matches scenarios 03/04's own "the endless-loop detector
  // classifies that pane" text (one of the three alternatives below) - a
  // SEPARATE, narrower registration for that exact text would never fire:
  // registry.resolve is first-match-within-scope, and this broader pattern
  // is registered first (confirmed live: a second registration below this
  // one left ctx.signal unset and scenarios 03/04 failed with "got
  // undefined" until this was consolidated).
  scoped(/^(the wake gate|the babysitter health check|the endless-loop detector) classifies that pane$/, (ctx, consumer) => {
    ctx.consumer = consumer;
    ctx.verdicts = classify(ctx.fixturePath);
    ctx.busy = CONSUMER_VERDICT[consumer](ctx.verdicts);
    ctx.signal = ctx.verdicts.loop;
  });

  scoped(/^the pane is classified idle$/, (ctx) => {
    if (ctx.busy) {
      throw new Error(`expected "${ctx.consumer}" to classify idle; verdicts were ${JSON.stringify(ctx.verdicts)}`);
    }
  });

  scoped(/^the pane is classified busy$/, (ctx) => {
    if (!ctx.busy) {
      throw new Error(`expected "${ctx.consumer}" to classify busy; verdicts were ${JSON.stringify(ctx.verdicts)}`);
    }
  });

  // ── circuit-breaker-is-not-held-open-03 ──────────────────────────────
  scoped(/^a pane spinning on repeated NO_TASK whose scrollback quotes the busy footer$/, (ctx) => {
    ctx.fixturePath = path.join(FIXTURE_DIR, 'no-task-spin-with-quoted-marker.txt');
  });

  scoped(/^the signal is a no-task spin$/, (ctx) => {
    if (ctx.signal !== 'no-task-spin') {
      throw new Error(`expected signal "no-task-spin", got "${ctx.signal}"`);
    }
  });

  scoped(/^the strike is recorded$/, (ctx) => {
    // The real strike-accumulation function (loop_detect_lib.bb's own
    // next-loop-state) is already unit-tested against this exact signal;
    // this step confirms the FULL path (classify -> advance state) rather
    // than re-deriving the strike arithmetic here.
    const out = execFileSync(
      'bb',
      ['-e', `(load-file "swarmforge/scripts/loop_detect_lib.bb") (println (:strikes (loop-detect-lib/next-loop-state nil :${ctx.signal})))`],
      { encoding: 'utf8', cwd: REPO_ROOT }
    ).trim();
    if (out !== '1') {
      throw new Error(`expected the strike count to advance to 1, got "${out}"`);
    }
  });

  // ── deliberate-exclusions-survive-04 ─────────────────────────────────
  scoped(/^a pane spinning on repeated NO_TASK while showing a model API wait line$/, (ctx) => {
    ctx.fixturePath = path.join(FIXTURE_DIR, 'no-task-spin-with-api-wait-line.txt');
  });
}

module.exports = { registerSteps };
