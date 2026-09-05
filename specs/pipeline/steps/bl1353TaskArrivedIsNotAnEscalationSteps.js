'use strict';

// BL-1353: ordinary coordinator traffic does not wake the LLM Operator.
//
// The decision is a pure babashka function over a map (operator_lib.bb's
// tick-observed-events), so every scenario drives the REAL function through
// the REAL library - one `bb` process per scenario, no filesystem, no tmux.
// A handler that restated the expected event list in JS would assert nothing
// about the swarm's own code.
//
// Scenario 04 (a CRIT still wakes) exercises the OTHER path deliberately:
// BABYSITTER_ESCALATION arrives via the queue, never from the tick, so it is
// driven through babysitter-escalation-event + valid-event? rather than
// through the tick sweep - proving the retirement removed the tick source and
// left the escalation producer alone (invariant 1).
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Ordinary coordinator traffic does not wake the LLM Operator';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_lib.bb');

// The wake sources BL-653's how-to documents, as its table names them. The
// tick may manufacture only the two it raises itself; BABYSITTER_ESCALATION
// and the TELEGRAM_*/HUMAN_COMMAND human traffic arrive via the queue.
const DOCUMENTED_TICK_SOURCES = ['HUMAN_COMMAND', 'SWARM_CONTROL_LOST'];

function bb(expression) {
  const out = execFileSync(
    'bb',
    ['-e', `(require '[babashka.fs :as fs]) (load-file "${OPERATOR_LIB}") (prn ${expression})`],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return out.trim().split('\n').pop();
}

function bbJson(expression) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[babashka.fs :as fs] '[cheshire.core :as json]) (load-file "${OPERATOR_LIB}") (println (json/generate-string ${expression}))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim().split('\n').pop());
}

function state(ctx) {
  if (!ctx.bl1353) {
    ctx.bl1353 = { inboxFresh: false, claimed: false, hibernated: false };
  }
  return ctx.bl1353;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the operator runtime tick is running$/, (ctx) => {
    state(ctx).tickRunning = true;
  });

  scoped(/^a handoff landed in the coordinator inbox within the tick interval$/, (ctx) => {
    state(ctx).inboxFresh = true;
  });

  // The claim is what a GATE would have needed to observe. The ruling was to
  // RETIRE rather than gate, so this records the scenario's premise: even the
  // claimed case - the one a gate would have suppressed - raises nothing,
  // because the tick no longer reads the probe at all.
  scoped(/^the coordinator claimed it within its claim window$/, (ctx) => {
    state(ctx).claimed = true;
  });

  scoped(/^babysitterd has recorded a CRIT finding$/, (ctx) => {
    state(ctx).crit = { key: 'proc-coder', message: 'resident process gone' };
  });

  scoped(/^the swarm is hibernated with a drained backlog$/, (ctx) => {
    // The state where the probe is load-bearing: with the backlog drained,
    // fresh coordinator mail is the ONLY thing separating a relaunch from
    // staying down (BL-310).
    state(ctx).hibernated = true;
  });

  scoped(/^the operator runtime evaluates its tick sweep$/, (ctx) => {
    const s = state(ctx);
    s.events = bbJson(
      `(operator-lib/tick-observed-events {:reachable? true :command-file-exists? false :coordinator-inbox-fresh? ${s.inboxFresh}})`
    );
  });

  scoped(/^the manufactured tick event types are listed$/, (ctx) => {
    state(ctx).manufactured = bbJson('(vec (sort operator-lib/manufactured-tick-event-types))');
  });

  scoped(/^the closing pass evaluates whether to relaunch$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.hibernated, true, 'the relaunch up-trigger only fires on a hibernated swarm');
    // The probe's SECOND consumer, driven through the real decision.
    s.relaunches = bb(
      `(operator-lib/should-relaunch? {:already-hibernated? true :backlog-drained? true :fresh-coordinator-mail? ${s.inboxFresh}})`
    );
    s.relaunchesWithoutMail = bb(
      '(operator-lib/should-relaunch? {:already-hibernated? true :backlog-drained? true :fresh-coordinator-mail? false})'
    );
  });

  scoped(/^the operator runtime evaluates its pending queue$/, (ctx) => {
    const s = state(ctx);
    s.queued = bbJson(`(operator-lib/babysitter-escalation-event {:key "${s.crit.key}" :message "${s.crit.message}"})`);
    s.queuedValid = bb(
      `(operator-lib/valid-event? (operator-lib/babysitter-escalation-event {:key "${s.crit.key}" :message "${s.crit.message}"}))`
    );
  });

  scoped(/^no LLM Operator wake event is manufactured$/, (ctx) => {
    assert.deepEqual(state(ctx).events, [], 'ordinary coordinator traffic manufactured a wake');
  });

  scoped(/^they are exactly the wake sources the BL-653 model documents$/, (ctx) => {
    assert.deepEqual(state(ctx).manufactured, [...DOCUMENTED_TICK_SOURCES].sort());
  });

  scoped(/^it observes fresh coordinator mail and relaunches$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.inboxFresh, true, 'the scenario must have put fresh mail in the inbox');
    assert.equal(s.relaunches, 'true', 'fresh coordinator mail no longer reaches the closing pass');
    // Non-vacuous: the same call without fresh mail decides the other way, so
    // the assertion above is about the probe rather than a constant.
    assert.equal(s.relaunchesWithoutMail, 'false');
  });

  scoped(/^an LLM Operator wake event is dispatched$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.queued.type, 'BABYSITTER_ESCALATION');
    assert.equal(s.queued.detail, s.crit.message);
    assert.equal(s.queuedValid, 'true', 'the escalation is not a valid queue event');
    // Invariant 1: the live escalation producer covers what the retired tick
    // source stood in for, and it is NOT a tick-manufactured type.
    assert.equal(
      bb('(contains? operator-lib/manufactured-tick-event-types "BABYSITTER_ESCALATION")'),
      'false',
      'the escalation must arrive via the queue, never the tick'
    );
  });
}

module.exports = { registerSteps };
