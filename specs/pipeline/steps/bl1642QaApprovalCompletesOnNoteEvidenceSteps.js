'use strict';

// BL-1642: step handlers for "A QA approval completes on note evidence
// without a no-op reason". Scenario 01 drives the REAL done_with_current.sh
// (-> done_with_current_task.bb -> forward_evidence_lib.bb) against a real
// git worktree + fixture mailbox, reusing BL-1609's own fixture builder
// (specs/pipeline/steps/bl1609ForwardingParcelNotCompletedWithNothingSentSteps.js's
// buildFixture, extended with QA/architect/documenter/master rows - never a
// second copy of that plumbing). Scenario 02 is a static source inspection
// (real file text, no fixture): the point of BL-1642's invariant 3 is that
// the production code itself calls one shared helper rather than each site
// keeping its own literal "QA" comparison, which only reading the real
// files can prove.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bl1609 = require('./bl1609ForwardingParcelNotCompletedWithNothingSentSteps');

const FEATURE = 'BL-1642 A QA approval completes on note evidence without a no-op reason';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const TICKET = 'BL-4242';
const OTHER_TICKET = 'BL-9999';
const COMMIT = '1234567890';

const ROLE_DEFS = [
  { role: 'QA', worktreeKey: 'QA', receiveMode: 'task' },
  { role: 'architect', worktreeKey: 'architect', receiveMode: 'task' },
  { role: 'documenter', worktreeKey: 'documenter', receiveMode: 'task' },
  { role: 'specifier', worktreeKey: 'master', receiveMode: 'task', masterResident: true },
  { role: 'coordinator', worktreeKey: 'master', receiveMode: 'task', masterResident: true },
];

function noteBody({ from, to, ticket, createdAt, name }) {
  return (
    `id: ${name}\nfrom: ${from}\nto: ${to}\nrecipient: ${to}\npriority: 50\ntype: note\n` +
    `message: ${ticket} approved and landed - bookkeep to done\n` +
    `created_at: ${createdAt}\n\n${ticket} approved and landed - bookkeep to done\n`
  );
}

function ensureState(ctx) {
  if (!ctx.bl1642) ctx.bl1642 = { fx: bl1609.buildFixture(ROLE_DEFS) };
  return ctx.bl1642;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with QA, architect and documenter worktrees and master-resident specifier and coordinator rows, per BL-1609's fixture$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  scoped(/^each worktree carries its own mailbox with empty outbox and sent directories$/, (ctx) => {
    const state = ensureState(ctx);
    for (const dirs of Object.values(state.fx.dirsByRole)) {
      assert.deepEqual(fs.readdirSync(dirs.outbox), []);
      assert.deepEqual(fs.readdirSync(dirs.sent), []);
    }
  });

  // ── Given the <role> holds <holding>, dequeued a minute ago ──────────────
  scoped(
    /^the (QA|architect) holds (a forwarding git_handoff for BL-4242 in in_process|a non-forwarding git_handoff for BL-4242 in in_process), dequeued a minute ago$/,
    (ctx, role, holding) => {
      const state = ensureState(ctx);
      const dequeuedAt = bl1609.isoSecondsAgo(60);
      state.role = role;
      state.dequeuedAt = dequeuedAt;
      const dirs = state.fx.dirsByRole[role];
      const nonForwarding = holding.startsWith('a non-forwarding');
      const filePath = path.join(dirs.inProcess, '50_x1.handoff');
      fs.writeFileSync(
        filePath,
        bl1609.forwardingHandoffBody({ role, ticket: TICKET, commit: COMMIT, dequeuedAt, nonForwarding, name: 'x1' })
      );
      state.itemPath = filePath;
    }
  );

  // ── And <evidence> ────────────────────────────────────────────────────────
  scoped(/^no note or git_handoff naming BL-4242 exists in its outbox or sent mailbox$/, () => {
    // Nothing to add - the fixture's outbox/sent start empty.
  });

  scoped(
    /^a note(?: to the (\w+))? naming (?:only )?(BL-4242|BL-9999) created (after the dequeue|before the inbound itself was queued) sits in its (outbox|sent mailbox)$/,
    (ctx, toMaybe, ticket, timing, mailbox) => {
      const state = ensureState(ctx);
      const to = toMaybe || 'coordinator';
      const dirKey = mailbox.startsWith('sent') ? 'sent' : 'outbox';
      const dirs = state.fx.dirsByRole[state.role];
      // "before the inbound itself was queued" predates its dequeue a
      // fortiori (queued always happens at or before its own dequeue) -
      // 120s ago is before the 60s-ago dequeue either way this note is
      // read against.
      const createdAt = timing === 'after the dequeue' ? bl1609.isoSecondsAgo(30) : bl1609.isoSecondsAgo(120);
      fs.writeFileSync(
        path.join(dirs[dirKey], '90_note.handoff'),
        noteBody({ from: state.role, to, ticket, createdAt, name: 'note' })
      );
    }
  );

  // ── When the <role> runs done_with_current <invocation> ──────────────────
  scoped(/^the (QA|architect) runs done_with_current (with no reason|with a reason)$/, (ctx, role, invocation) => {
    const state = ensureState(ctx);
    const wt = state.fx.wtByRole[role];
    const doneSh = state.fx.doneShByRole[role];
    const args = invocation === 'with no reason' ? [] : ['--no-op', 'evidence-only rebase'];
    state.result = bl1609.runDone(doneSh, wt, role, args);
  });

  // ── Then the outcome is <outcome> ────────────────────────────────────────
  scoped(/^the outcome is completed plainly, with no no_op_reason header on the completed file$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    const dirs = state.fx.dirsByRole[state.role];
    const completedPath = path.join(dirs.completed, path.basename(state.itemPath));
    assert.ok(fs.existsSync(completedPath), `expected ${completedPath} in completed/`);
    assert.doesNotMatch(fs.readFileSync(completedPath, 'utf8'), /^no_op_reason:/m, 'no_op_reason must not be stamped');
  });

  scoped(/^the outcome is refused naming BL-4242 and the two ways out, with nothing moved$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.result.status, 0, `expected a refusal: ${state.result.output}`);
    assert.match(state.result.output, /BL-4242/, `refusal must name BL-4242: ${state.result.output}`);
    assert.match(state.result.output, /--no-op/, `refusal must mention --no-op: ${state.result.output}`);
    assert.match(state.result.output, /send the forward/i, `refusal must mention sending the forward: ${state.result.output}`);
    assert.ok(fs.existsSync(state.itemPath), 'expected the inbound to still be in place');
    assert.doesNotMatch(fs.readFileSync(state.itemPath, 'utf8'), /^completed_at:/m, 'completed_at must not be stamped');
  });

  scoped(/^the outcome is completed with the reason recorded on the completed file$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.result.status, 0, `expected completion, got: ${state.result.output}`);
    const dirs = state.fx.dirsByRole[state.role];
    const completedPath = path.join(dirs.completed, path.basename(state.itemPath));
    const text = fs.readFileSync(completedPath, 'utf8');
    assert.match(text, /^no_op_reason: evidence-only rebase$/m, `expected no_op_reason on the completed file: ${text}`);
  });

  // ── Scenario 02: static source inspection, no fixture ────────────────────
  scoped(
    /^done_with_current_task\.bb, done_with_current_batch\.bb and forward_evidence_lib\.bb are inspected$/,
    (ctx) => {
      ctx.bl1642Source = {
        task: fs.readFileSync(path.join(SCRIPTS_DIR, 'done_with_current_task.bb'), 'utf8'),
        batch: fs.readFileSync(path.join(SCRIPTS_DIR, 'done_with_current_batch.bb'), 'utf8'),
        lib: fs.readFileSync(path.join(SCRIPTS_DIR, 'forward_evidence_lib.bb'), 'utf8'),
      };
    }
  );

  scoped(
    /^the forward gate and the BL-1566 hold gate call the same seat-stage helper to decide whether this seat is the QA stage$/,
    (ctx) => {
      const { task, lib } = ctx.bl1642Source;
      assert.match(lib, /\(defn qa-stage\?/, 'forward_evidence_lib.bb must define the shared qa-stage? helper');
      const forwardGateBody = task.slice(task.indexOf('(defn- forward-gate!'), task.indexOf('(defn- qa-hold-gate!'));
      const holdGateBody = task.slice(task.indexOf('(defn- qa-hold-gate!'), task.indexOf('(defn -main'));
      assert.match(
        forwardGateBody,
        /forward-evidence-lib\/qa-stage\?/,
        'forward-gate! must call the shared qa-stage? helper'
      );
      assert.match(
        holdGateBody,
        /forward-evidence-lib\/qa-stage\?/,
        'qa-hold-gate! must call the shared qa-stage? helper'
      );
    }
  );

  scoped(/^neither gate compares the raw role name to the literal "QA"$/, (ctx) => {
    const { task, batch } = ctx.bl1642Source;
    for (const [name, text] of [
      ['done_with_current_task.bb', task],
      ['done_with_current_batch.bb', batch],
    ]) {
      assert.doesNotMatch(
        text,
        /\(=\s*"QA"\s*\(handoff-lib\/current-role\)\)/,
        `${name} must not compare current-role to the literal "QA"`
      );
    }
  });
}

module.exports = { registerSteps };
