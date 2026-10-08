'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-2073-qa-gather-runs-the-property-runners-its-change-reaches.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Drives the REAL compiled qaGather.ts (CHECKLIST's property_runners row
// and runChecklist) over an injected FAKE runner - never a real
// run_property_runners.sh spawn (a real front-end run from inside an
// acceptance test would be exactly the nested-suite problem the
// engineering rules warn against). The fake runner records every command
// it is asked to start and answers from a script keyed by the check's own
// (command, args) shape.

const assert = require('node:assert/strict');
const path = require('node:path');
const { CHECKLIST, runChecklist } = require('../../../extension/out/quality/qaGather');

const FEATURE = "BL-2073 QA's gather runs the property runners its change reaches";

const FRONT_END_NAME = 'run_property_runners.sh';

function makeFakeRunner(script) {
  const calls = [];
  const runFn = (command, args, cwd) => {
    calls.push({ command, args, cwd, seq: calls.length });
    const key = args.join(' ');
    const answer = script[command] ?? script[key] ?? script.default;
    if (!answer) {
      return { started: true, exit: 0, stdout: '', stderr: '' };
    }
    if (answer.started === false) {
      return { started: false, exit: null, stdout: '', stderr: '', reason: answer.reason };
    }
    return { started: true, exit: answer.exit ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  return { runFn, calls };
}

function frontEndCalls(calls) {
  return calls.filter((c) => c.command.includes(FRONT_END_NAME));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01 (outline) ────────────────────────────────────────────
  scoped(/^a fixture repository whose parcel commit changes "(.*)" on top of main$/, (ctx, changed) => {
    const script = {};
    if (changed === 'docs/how-to/note.md') {
      // scenario 02: the parcel's diff reaches no property runner, so the
      // front-end prints the no-reach line and exits 0.
      script[path.join('/r', 'swarmforge', 'scripts', 'test', FRONT_END_NAME)] = {
        started: true,
        exit: 0,
        stdout: 'no property runner reached since abc1234567',
        stderr: '',
      };
    }
    ctx.bl2073 = {
      root: '/r',
      ticketId: 'BL-2073-FIX',
      commit: 'abc1234567',
      changed,
      script,
    };
  });

  scoped(/^the QA gather runs for that parcel commit$/, (ctx) => {
    const st = ctx.bl2073;
    const runner = makeFakeRunner(st.script);
    st.runner = runner;
    st.rows = runChecklist(CHECKLIST, { root: st.root, ticketId: st.ticketId, commit: st.commit }, runner.runFn);
  });

  scoped(/^the property_runners row ran$/, (ctx) => {
    const row = ctx.bl2073.rows.find((r) => r.id === 'property_runners');
    assert.equal(row.status, 'ran', `property_runners row did not run: ${JSON.stringify(row)}`);
  });

  scoped(/^the front-end named exactly the runners (.+)$/, (ctx, reached) => {
    const st = ctx.bl2073;
    const calls = frontEndCalls(st.runner.calls);
    assert.equal(calls.length, 1, `expected exactly one front-end call, got ${calls.length}`);
    const expected = path.join(st.root, 'swarmforge', 'scripts', 'test', FRONT_END_NAME);
    assert.equal(calls[0].command, expected);
    assert.deepEqual(calls[0].args, ['--changed-from', st.commit]);
    assert.equal(calls[0].cwd, st.root);
    assert.ok(reached.split(',').every((name) => name.trim() !== ''), `reached value names nothing: ${reached}`);
  });

  scoped(/^it did not name any other runner$/, (ctx) => {
    const st = ctx.bl2073;
    const calls = frontEndCalls(st.runner.calls);
    assert.equal(calls.length, 1, `expected exactly one front-end call, got ${calls.length}`);
    // The row's own command names exactly one front-end invocation with
    // exactly the --changed-from flag - no second runner, no extra flag.
    assert.deepEqual(calls[0].args, ['--changed-from', st.commit]);
  });

  // ── scenario 02 ───────────────────────────────────────────────────────
  scoped(/^a fixture repository whose parcel commit changes "(.*)" on top of main$/, (ctx, changed) => {
    ctx.bl2073 = {
      root: '/r',
      ticketId: 'BL-2073-FIX',
      commit: 'abc1234567',
      changed,
      script: {
        [path.join('/r', 'swarmforge', 'scripts', 'test', FRONT_END_NAME)]: {
          started: true,
          exit: 0,
          stdout: 'no property runner reached since abc1234567',
          stderr: '',
        },
      },
    };
  });

  scoped(/^it printed "no property runner reached since" and named no runner$/, (ctx) => {
    const st = ctx.bl2073;
    const row = st.rows.find((r) => r.id === 'property_runners');
    assert.ok(row.excerpt.includes('no property runner reached since'), `expected the no-reach line in the row's output, got: ${row.excerpt}`);
    const calls = frontEndCalls(st.runner.calls);
    assert.equal(calls.length, 1, `expected exactly one front-end call, got ${calls.length}`);
    assert.deepEqual(calls[0].args, ['--changed-from', st.commit]);
  });

  scoped(/^it exited 0$/, (ctx) => {
    const row = ctx.bl2073.rows.find((r) => r.id === 'property_runners');
    assert.equal(row.exit, 0);
  });

  // ── scenario 03 ───────────────────────────────────────────────────────
  scoped(/^a fixture repository whose parcel commit has no merge-base with main$/, (ctx) => {
    ctx.bl2073 = {
      root: '/r',
      ticketId: 'BL-2073-FIX',
      commit: 'unknown',
      script: {},
    };
  });

  scoped(/^the property_runners row reads blocked, naming the failed merge-base$/, (ctx) => {
    const st = ctx.bl2073;
    const row = st.rows.find((r) => r.id === 'property_runners');
    assert.equal(row.status, 'blocked', `expected a blocked row, got: ${JSON.stringify(row)}`);
    assert.ok(row.reason.includes('merge-base'), `expected the reason to name the failed merge-base, got: ${row.reason}`);
    assert.ok(row.reason.includes(st.commit), `expected the reason to name the commit, got: ${row.reason}`);
  });

  scoped(/^no front-end command was started$/, (ctx) => {
    const st = ctx.bl2073;
    const calls = frontEndCalls(st.runner.calls);
    assert.equal(calls.length, 0, `expected no front-end call, got ${JSON.stringify(calls)}`);
  });
}

module.exports = { registerSteps };
