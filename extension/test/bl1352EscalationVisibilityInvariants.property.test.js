'use strict';

// BL-1352's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The status surface never reads healthy while a past-threshold
//                role question sits unescalated - a transport that cannot
//                deliver is reported as a fault, never as silence.
//   invariant 2  Transport state is logged on change only - N consecutive
//                ticks in one state produce one line, so the operator log can
//                never be flooded past usefulness.
//
// Both drive the REAL swarmforge/scripts/role_ask_escalation_lib.bb. Invariant
// 1 also drives the REAL `./swarm status` renderer, because the whole defect
// was a state that existed and no surface showed - proving it against the
// decision alone would reproduce the defect inside the test.
//
// GENERATOR REACH (by construction, and it took a bounce to get right). The
// four combinations of transport x waiting are the corners, so ALL FOUR are
// enumerated by the enclosing loops - the transport and whether anything is
// waiting are both chosen, never drawn. Only WHICH roles are waiting is
// generated.
//
// The first version drew the waiting set from fc.uniqueArray(maxLength: 3) at
// numRuns 5, so the empty-array case arrived by luck: the cleaner measured a
// ~33% failure rate on `never exercised the configuredIdle case` (bounce D1,
// 2026-09-03). A reach floor that itself fails a third of the time is the
// mirror image of a vacuous one, and it ships an intermittent red to roles who
// did not cause it and do not own fixing it.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ESCALATION_LIB = path.join(SCRIPTS, 'role_ask_escalation_lib.bb');
const STATUS_BB = path.join(SCRIPTS, 'swarm_status.bb');
const FIXTURE_PREFIX = 'bl1352-property-';
const ROLES = ['specifier', 'coordinator', 'coder', 'documenter'];

function bb(expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${ESCALATION_LIB}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const strip = (s) => String(s).replace(/^:/, '');

function health(transport, waiting) {
  return bb(`(role-ask-escalation-lib/escalation-transport-state
    {:transport :${transport} :waiting-roles ${JSON.stringify(waiting)}})`);
}

function renderedStatus(transport, waiting, h) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'operator', 'status.json'),
      JSON.stringify({
        ask_escalation: { transport, state: strip(h.state), detail: h.detail, waiting_roles: waiting },
      }),
    );
    const r = spawnSync('bb', [STATUS_BB, root], { encoding: 'utf8' });
    return `${r.stdout || ''}${r.stderr || ''}`;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('BL-1352/BL-654 invariant 1: nothing reads healthy while a question sits undelivered', () => {
  const reach = { configuredWaiting: 0, configuredIdle: 0, unconfiguredWaiting: 0, unconfiguredIdle: 0 };

  for (const transport of ['configured', 'unconfigured']) {
    // Both arms run for both transports: idle is a CASE, not a draw.
    for (const idle of [true, false]) {
      fc.assert(
        fc.property(
          idle
            ? fc.constant([])
            : fc.uniqueArray(fc.constantFrom(...ROLES), { minLength: 1, maxLength: 3 }),
          (waiting) => {
        assert.equal(waiting.length === 0, idle, 'the generator produced the wrong arm');
        const h = health(transport, waiting);
        const state = strip(h.state);
        const key = `${transport}${waiting.length ? 'Waiting' : 'Idle'}`;
        reach[key] += 1;

        if (transport === 'unconfigured' && waiting.length > 0) {
          assert.equal(state, 'fault', `an undeliverable question did not read as a fault: ${JSON.stringify(h)}`);
          // Every waiting role is named, not just the first: a fault that
          // names one of two gets half-fixed.
          for (const role of waiting) {
            assert.ok(h.detail.includes(role), `the fault does not name ${role}: ${h.detail}`);
          }
        } else if (transport === 'unconfigured') {
          // Nothing waiting: worth saying, not worth a red. A signal that is
          // permanently on stops being read, which is how the last one died.
          assert.equal(state, 'warn-unconfigured', JSON.stringify(h));
        } else {
          assert.equal(state, 'ok', JSON.stringify(h));
        }

        // And the SURFACE agrees - the defect was a state nothing rendered.
        const status = renderedStatus(transport, waiting, h);
        assert.match(status, /Ask escalation/, `the status surface omits the row entirely:\n${status}`);
        if (state === 'fault') {
          assert.match(status, /FAULT/, `a fault did not render as a fault:\n${status}`);
          for (const role of waiting) {
            assert.ok(status.includes(role), `the rendered fault does not name ${role}:\n${status}`);
          }
        } else {
          assert.doesNotMatch(status, /FAULT/, `a non-fault rendered as a fault:\n${status}`);
        }
        return true;
          }),
        { numRuns: 4 },
      );
    }
  }

  for (const [key, count] of Object.entries(reach)) {
    assert.ok(count > 0, `never exercised the ${key} case`);
  }
});

test('BL-1352/BL-654 invariant 2: N ticks in one state produce exactly one line', () => {
  const reach = { held: 0, changed: 0 };

  fc.assert(
    fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 0, max: 6 }), (ticks, changeAt) => {
      // A sequence of transport states: `changeAt` ticks in the first state,
      // then the rest in the other. changeAt 0 or >= ticks means it never
      // changes, which is the flooding case the invariant is about.
      const states = [];
      for (let i = 0; i < ticks; i += 1) {
        states.push(changeAt > 0 && i >= changeAt ? 'ok' : 'fault');
      }
      const changes = new Set(states).size - 1;
      if (changes === 0) reach.held += 1;
      else reach.changed += 1;

      let last = null;
      let lines = 0;
      for (const s of states) {
        const due = bb(`(role-ask-escalation-lib/transport-log-due? ${last ? `{:state "${last}"}` : 'nil'} {:state :${s}})`);
        if (due) {
          lines += 1;
          last = s;
        }
      }

      // One line for the first observation, plus one per change - never one
      // per tick, however many ticks there are.
      assert.equal(lines, 1 + changes, `${ticks} ticks with ${changes} change(s) produced ${lines} lines`);
      assert.ok(lines <= ticks, 'more lines than ticks, which is impossible');
      return true;
    }),
    { numRuns: 10 },
  );

  assert.ok(reach.held > 0, 'never exercised a held state - the flooding case went untested');
  assert.ok(reach.changed > 0, 'never exercised a state change');
});
