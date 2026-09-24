'use strict';

// BL-1697: step handlers for "the local parcel driver moves a coder
// parcel through a local aider seat". Drives the REAL driver
// (local_parcel_driver_cli.bb, one real bb process per tick) against a
// real throwaway git checkout with the real `seat` script (BL-1696) and
// a fake tmux (BL-377's own fakeTmux.js) - the test acts as the scripted
// stand-in model between ticks, since there is no real model to wait on.
// Scenario 06 (handoffd's own injection paths) runs the REAL daemon via
// its own dedicated shell test, never reimplemented here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { makeLocalParcelDriverFixture } = require('../../../extension/test/helpers/localParcelDriverFixture');

const FEATURE = 'BL-1697 the local parcel driver moves a coder parcel through a local aider seat';

const DRIVER_INJECTION_SKIP_TEST = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'swarmforge',
  'scripts',
  'test',
  'test_handoffd_driver_seat_injection_skip.sh'
);

const NO_NARRATION_MARKER = 'entire reply must be';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

// The stand-in model's behaviour per Scenario 02's own table, plus the
// happy-path and fix-turn-limit scenarios' own actions - keyed on the
// EXACT feature text so a step handler never re-parses free-form English.
const MODEL_BEHAVIOURS = {
  'commits an edit that makes the acceptance feature pass': (fx) => fx.modelFixesIt(),
  'commits an edit that leaves the acceptance failing on every turn': (fx, n) => fx.modelLeavesItBroken(n),
  'makes no commit': (fx) => fx.modelMakesNoCommit(),
  'commits a change to the acceptance feature and a passing edit': (fx, n) => fx.modelEditsTheSpecToo(n),
  'commits a passing edit and a change to a file it was not given': (fx, n) => fx.modelEditsOutsideItsFiles(n),
};

const ESCALATION_PRECONDITIONS = {
  'the acceptance feature for BL-9 already passes': (ctx) => {
    fs.writeFileSync(path.join(ctx.fixture.root, 'editable.txt'), 'MARKER_FIXED\n');
    git(ctx.fixture.root, ['commit', '-q', '-am', 'already fixed before any parcel']);
  },
  "the parcel commit conflicts with the coder's checkout": () => {
    /* handled by queueing a conflicting sender commit instead - see the step below */
  },
};

// Drives ticks until the parcel reaches a terminal state (no state file,
// or escalated) or a bound is hit - the model action (if any) runs
// between every gate-check tick, exactly as a real model turn would sit
// between the driver typing a request and the driver checking the result.
function driveToEnd(ctx) {
  const { fixture, fixTurnsLimit, modelAction } = ctx;
  let result = fixture.driveOneTick(fixTurnsLimit);
  ctx.instructionResult = result;
  for (let tick = 0; tick < 6; tick += 1) {
    const statePath = path.join(fixture.root, '.swarmforge', 'local-driver', 'coder.json');
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
    if (!state || state.escalated) {
      return { state, result };
    }
    if (modelAction) {
      modelAction(fixture, tick);
    }
    result = fixture.driveOneTick(fixTurnsLimit);
  }
  throw new Error('driver did not reach a terminal state within the tick bound');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a throwaway project whose coder seat is an aider seat under the driver$/, (ctx) => {
    ctx.fixture = makeLocalParcelDriverFixture();
    ctx.fixTurnsLimit = 3;
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      ctx.fixture.cleanup();
    });
  });

  scoped(/^an active ticket BL-9 whose acceptance feature fails before any edit$/, (ctx) => {
    ctx.fixture.writeTicket({ editablePaths: ['editable.txt'] });
  });

  scoped(/^a git_handoff parcel for BL-9 waits in the coder's inbox$/, (ctx) => {
    ctx.senderSha = ctx.fixture.makeSenderCommit();
    ctx.fixture.queueParcel(ctx.senderSha);
  });

  // ── Scenario 01 / 02 shared Given ───────────────────────────────────
  scoped(/^the stand-in model (.+)$/, (ctx, behaviour) => {
    const action = MODEL_BEHAVIOURS[behaviour];
    assert.ok(action, `unknown <behaviour>: ${behaviour}`);
    ctx.modelAction = action;
  });

  scoped(/^the driver runs the parcel to the end$/, (ctx) => {
    const outcome = driveToEnd(ctx);
    ctx.finalState = outcome.state;
    ctx.lastResult = outcome.result;
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the coder's checkout holds a merge of the parcel commit followed by the model's commit$/, (ctx) => {
    const log = git(ctx.fixture.root, ['log', '--format=%H %P']).split('\n');
    // The tip (model's commit) has exactly one parent, and that parent's
    // own parents include the sender's commit - i.e. a real merge sits
    // between them.
    const [tipLine, mergeLine] = log;
    const [, tipParent] = tipLine.split(' ');
    assert.ok(tipParent, 'expected the model commit to have a parent');
    const [mergeSha, ...mergeParents] = mergeLine.split(' ');
    assert.equal(tipParent, mergeSha, "expected the model's commit to sit directly on the merge");
    assert.ok(
      mergeParents.includes(ctx.senderSha),
      `expected the merge to name the sender commit ${ctx.senderSha} as a parent, got: ${mergeParents}`
    );
  });

  scoped(/^a git_handoff for BL-9 naming the model's commit is queued to the next pipeline role$/, (ctx) => {
    const calls = ctx.fixture.recordedCalls().filter((c) => c.script === 'swarm_handoff.sh');
    assert.equal(calls.length, 1, `expected exactly one swarm_handoff.sh call, got: ${JSON.stringify(calls)}`);
    const draftText = calls[0].argv[0].replace(/\x1e/g, '\n');
    assert.match(draftText, /type: git_handoff/);
    assert.match(draftText, /task: BL-9/);
    const modelSha = git(ctx.fixture.root, ['rev-parse', '--short=10', 'HEAD']);
    assert.match(draftText, new RegExp(`commit: ${modelSha}`));
  });

  scoped(/^the parcel is completed$/, (ctx) => {
    const inProcess = fs.readdirSync(path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    assert.deepEqual(inProcess, [], `expected an empty in_process dir, got: ${JSON.stringify(inProcess)}`);
    const completedDir = path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'completed');
    assert.ok(fs.existsSync(completedDir) && fs.readdirSync(completedDir).length === 1, 'expected one completed parcel');
  });

  // ── Scenario 01 / 04 / 05 shared: spec writability ───────────────────
  scoped(/^the ticket's spec files are writable again$/, (ctx) => {
    for (const p of [ctx.fixture.ticketPath, ctx.fixture.featurePath]) {
      assert.ok((fs.statSync(p).mode & 0o200) !== 0, `expected ${p} to be writable again`);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^exactly one question is raised for the coder naming BL-9 and "([^"]+)"$/, (ctx, condition) => {
    const calls = ctx.fixture.recordedCalls().filter((c) => c.script === 'role_ask.bb');
    assert.equal(calls.length, 1, `expected exactly one role_ask.bb call, got: ${JSON.stringify(calls)}`);
    const questionArg = calls[0].argv[calls[0].argv.length - 1];
    assert.equal(questionArg, `BL-9: ${condition}`, `expected the question to name BL-9 and "${condition}"`);
  });

  scoped(/^no git_handoff for BL-9 is queued and the parcel stays in process$/, (ctx) => {
    const handoffCalls = ctx.fixture.recordedCalls().filter((c) => c.script === 'swarm_handoff.sh');
    assert.equal(handoffCalls.length, 0, `expected no swarm_handoff.sh call, got: ${JSON.stringify(handoffCalls)}`);
    const inProcess = fs.readdirSync(path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    assert.equal(inProcess.length, 1, `expected the parcel to remain in_process, got: ${JSON.stringify(inProcess)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the pack sets the seat fix-turn limit to (\d+)$/, (ctx, limit) => {
    ctx.fixTurnsLimit = Number(limit);
  });

  scoped(
    /^the pane received the instruction once and a fix request twice before the question was raised$/,
    (ctx) => {
      const instructionCount = ctx.fixture.tmux
        .calls()
        .filter((c) => c.join(' ').includes('implement BL-9')).length;
      const fixRequestCount = ctx.fixture.tmux
        .calls()
        .filter((c) => c.join(' ').includes('did not pass the gate')).length;
      assert.equal(instructionCount, 1, `expected exactly one instruction, got ${instructionCount}`);
      assert.equal(fixRequestCount, 2, `expected exactly two fix requests, got ${fixRequestCount}`);
    }
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the parcel is set up so that (.+)$/, (ctx, precondition) => {
    const setup = ESCALATION_PRECONDITIONS[precondition];
    assert.ok(setup, `unknown <precondition>: ${precondition}`);
    if (precondition.includes('conflicts')) {
      // Replace the already-queued clean parcel with a conflicting one -
      // this step always runs after the Background's own clean queueParcel.
      fs.rmSync(path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'new'), {
        recursive: true,
        force: true,
      });
      fs.mkdirSync(path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
      const conflictSha = ctx.fixture.makeSenderCommit({ conflict: true });
      ctx.fixture.queueParcel(conflictSha);
    } else {
      setup(ctx);
    }
  });

  scoped(/^the pane never received the instruction and no merge is in progress$/, (ctx) => {
    const instructionSent = ctx.fixture.tmux.calls().some((c) => c.join(' ').includes('implement BL-9'));
    assert.equal(instructionSent, false, 'expected the instruction never to have been typed');
    assert.equal(ctx.fixture.hasMergeInProgress(), false, 'expected no merge left in progress');
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^the driver sends the model its instruction$/, (ctx) => {
    ctx.lastResult = ctx.fixture.driveOneTick(ctx.fixTurnsLimit);
  });

  scoped(/^the ticket file and its acceptance feature have no write permission$/, (ctx) => {
    for (const p of [ctx.fixture.ticketPath, ctx.fixture.featurePath]) {
      assert.equal(fs.statSync(p).mode & 0o222, 0, `expected ${p} to have no write permission`);
    }
  });

  scoped(/^the chat was given the ticket and the acceptance feature read-only before the instruction$/, (ctx) => {
    const calls = ctx.fixture.tmux.calls();
    const joined = calls.map((c) => c.join(' '));
    const readOnlyTicketIdx = joined.findIndex((c) => c.includes('/read-only') && c.includes('BL-9.yaml'));
    const readOnlyFeatureIdx = joined.findIndex((c) => c.includes('/read-only') && c.includes('BL-9-thing.feature'));
    const instructionIdx = joined.findIndex((c) => c.includes('implement BL-9'));
    assert.ok(readOnlyTicketIdx >= 0, 'expected a /read-only call for the ticket');
    assert.ok(readOnlyFeatureIdx >= 0, 'expected a /read-only call for the acceptance feature');
    assert.ok(instructionIdx >= 0, 'expected the instruction to have been sent');
    assert.ok(readOnlyTicketIdx < instructionIdx, 'expected the ticket to be marked read-only before the instruction');
    assert.ok(
      readOnlyFeatureIdx < instructionIdx,
      'expected the feature to be marked read-only before the instruction'
    );
  });

  scoped(/^the instruction text contains no aider no-narration suffix$/, (ctx) => {
    const instructionCall = ctx.fixture.tmux
      .calls()
      .find((c) => c.join(' ').includes('implement BL-9'));
    assert.ok(instructionCall, 'expected to find the instruction send-keys call');
    const text = instructionCall[instructionCall.length - 1];
    assert.ok(!text.includes(NO_NARRATION_MARKER), `expected no no-narration suffix, got: ${text}`);
  });

  // ── Scenario 06 ──────────────────────────────────────────────────────
  // Runs the REAL daemon through its own dedicated shell test rather than
  // reimplementing the daemon-spawn/wait/inspect dance here - the same
  // "drive the real thing" discipline, applied to the one scenario whose
  // subject (handoffd's own cycle loop) cannot be driven through the
  // per-tick CLI the other five scenarios use.
  scoped(/^handoffd sends its (new-mail wake|chase poke|in-process resume) to every seat with work$/, (ctx) => {
    ctx.injectionResult = spawnSync('bash', [DRIVER_INJECTION_SKIP_TEST], { encoding: 'utf8', timeout: 30000 });
  });

  scoped(/^the coder's aider pane received no text from it$/, (ctx) => {
    assert.equal(
      ctx.injectionResult.status,
      0,
      `expected the injection-skip test to pass:\n${ctx.injectionResult.stdout}\n${ctx.injectionResult.stderr}`
    );
    assert.match(ctx.injectionResult.stdout, /01: the coder \(driver\) seat's aider pane received no typed text/);
  });

  scoped(/^a Claude seat with work received the same text as before this ticket$/, (ctx) => {
    assert.match(ctx.injectionResult.stdout, /02: a Claude seat with work still received its wake/);
  });
}

module.exports = { registerSteps };
