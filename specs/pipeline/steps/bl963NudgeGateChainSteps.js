'use strict';

// BL-963: step handlers for "open-slot nudge consults the promotion gate
// chain". Drives the REAL chase_sweep_lib.bb pure decision surface
// (nudge-eligible-candidates -> top-open-slot-candidate ->
// decide-open-slot-nudge? -> decide-open-slot-escalation) over scratch
// backlog trees via small bb subprocess calls - the sweep-lib test-runner
// shape the ticket's qa_e2e names, never a JS reimplementation of any gate.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

const FEATURE = 'BL-963 open-slot nudge consults the promotion gate chain';

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function ticketYaml(id, { priority, approval = 'approved', deps = [] }) {
  return (
    `id: ${id}\n` +
    `title: "fixture"\n` +
    `type: feature\n` +
    `priority: ${priority}\n` +
    `human_approval: ${approval}\n` +
    `depends_on: [${deps.join(', ')}]\n`
  );
}

function writePaused(ctx, name, yaml) {
  fs.writeFileSync(path.join(ctx.pausedDir, name), yaml);
}

// One bb call running the REAL decision surface end to end over the
// fixture's paused/ dir, for `ticks` consecutive nudge-worthy sweeps.
// Prints EDN: {:fired bool :named id-or-nil :approved bool :states [..]}.
function runSweepDecision(ctx, ticks = 1) {
  const expr = `
(require '[babashka.fs :as fs] '[clojure.string :as str])
(load-file ${JSON.stringify(CHASE_SWEEP_LIB)})
(let [candidates (chase-sweep-lib/read-paused-candidates ${JSON.stringify(ctx.pausedDir)})
      eligible (chase-sweep-lib/nudge-eligible-candidates
                candidates {:active-count 1 :max-depth 3 :active-epics nil
                            :done-ids #{"BL-9001"}})
      fired (chase-sweep-lib/decide-open-slot-nudge? 1 3 (count eligible) {})
      named (chase-sweep-lib/top-open-slot-candidate eligible)
      states (loop [k 0 prev nil acc []]
               (if (= k ${ticks})
                 acc
                 (let [{:keys [state]} (chase-sweep-lib/decide-open-slot-escalation prev (:id named) 3)]
                   (recur (inc k) state (conj acc state)))))]
  (prn {:fired fired
        :named (:id named)
        :approved (boolean (:approved? named))
        :message (when named (chase-sweep-lib/open-slot-nudge-message named))
        :state-ids (vec (keep :candidate-id states))}))
`;
  const out = execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
  const edn = out.trim();
  return {
    fired: /:fired true/.test(edn),
    named: (edn.match(/:named "([^"]+)"/) || [])[1] ?? null,
    approved: /:approved true/.test(edn),
    message: (edn.match(/:message "([^"]+)"/) || [])[1] ?? null,
    stateIds: [...edn.matchAll(/"(BL-\d+)"/g)].map((m) => m[1]),
    raw: edn,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a scratch backlog with an open active slot under the effective depth cap$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl963-');
    trackedRoots.push(ctx.root);
    ctx.pausedDir = path.join(ctx.root, 'backlog', 'paused');
    fs.mkdirSync(ctx.pausedDir, { recursive: true });
  });

  scoped(
    /^the top-ranked paused ticket is refused by the evaluate chain for an unsatisfied depends_on$/,
    (ctx) => {
      // priority 1 = best rank (lower-first); BL-8888 resolves nowhere.
      writePaused(ctx, 'BL-201-refused.yaml', ticketYaml('BL-201', { priority: 1, deps: ['BL-8888'] }));
      ctx.refusedId = 'BL-201';
    }
  );

  scoped(/^a lower-ranked paused ticket is allowed by the evaluate chain$/, (ctx) => {
    writePaused(ctx, 'BL-202-allowed.yaml', ticketYaml('BL-202', { priority: 50, deps: ['BL-9001'] }));
    ctx.allowedId = 'BL-202';
  });

  // Scenario 05 (bounce D1): pending approval AND dep-blocked at once -
  // evaluate reports only human_approval (first-failing-gate-wins), and the
  // pre-fix filter surfaced it as awaiting approval though approving it
  // promotes nothing. Same shared Thens as scenario 01.
  scoped(
    /^the top-ranked paused ticket is refused by the evaluate chain for both a pending human_approval and an unsatisfied depends_on$/,
    (ctx) => {
      writePaused(
        ctx,
        'BL-207-overlap.yaml',
        ticketYaml('BL-207', { priority: 1, approval: 'pending', deps: ['BL-8888'] })
      );
      ctx.refusedId = 'BL-207';
    }
  );

  scoped(
    /^the only paused ticket not refused for another reason is refused solely by the human_approval gate$/,
    (ctx) => {
      writePaused(ctx, 'BL-203-pending.yaml', ticketYaml('BL-203', { priority: 5, approval: 'pending' }));
      writePaused(ctx, 'BL-204-dep-refused.yaml', ticketYaml('BL-204', { priority: 1, deps: ['BL-8888'] }));
      ctx.pendingId = 'BL-203';
    }
  );

  scoped(
    /^every paused ticket is refused by the evaluate chain for a reason other than human_approval$/,
    (ctx) => {
      writePaused(ctx, 'BL-205-dep-refused.yaml', ticketYaml('BL-205', { priority: 1, deps: ['BL-8888'] }));
      writePaused(ctx, 'BL-206-dep-refused.yaml', ticketYaml('BL-206', { priority: 2, deps: ['BL-7777'] }));
    }
  );

  scoped(/^the open-slot sweep decides its nudge$/, (ctx) => {
    ctx.result = runSweepDecision(ctx, 1);
  });

  scoped(/^the open-slot sweep decides its nudge on three consecutive ticks$/, (ctx) => {
    ctx.result = runSweepDecision(ctx, 3);
  });

  scoped(/^a nudge fires naming the allowed ticket$/, (ctx) => {
    assert.ok(ctx.result.fired, `expected the nudge to fire, got: ${ctx.result.raw}`);
    assert.equal(ctx.result.named, ctx.allowedId, `expected ${ctx.allowedId} named, got: ${ctx.result.raw}`);
  });

  scoped(/^the gate-refused ticket is not named$/, (ctx) => {
    assert.notEqual(ctx.result.named, ctx.refusedId, `expected ${ctx.refusedId} to never be named, got: ${ctx.result.raw}`);
  });

  scoped(/^a nudge fires naming that ticket flagged awaiting approval$/, (ctx) => {
    assert.ok(ctx.result.fired, `expected the nudge to fire, got: ${ctx.result.raw}`);
    assert.equal(ctx.result.named, ctx.pendingId, `expected ${ctx.pendingId} named, got: ${ctx.result.raw}`);
    assert.equal(ctx.result.approved, false);
    assert.ok(
      (ctx.result.message || '').includes('awaiting approval'),
      `expected the awaiting-approval flag in the message, got: ${ctx.result.message}`
    );
  });

  scoped(/^no open-slot nudge fires$/, (ctx) => {
    assert.ok(!ctx.result.fired, `expected NO nudge with every candidate gate-refused, got: ${ctx.result.raw}`);
  });

  scoped(/^no escalation state is recorded for the gate-refused ticket$/, (ctx) => {
    assert.ok(
      !ctx.result.stateIds.includes(ctx.refusedId),
      `expected no escalation state for ${ctx.refusedId}, got states: ${ctx.result.raw}`
    );
  });
}

module.exports = { registerSteps };
