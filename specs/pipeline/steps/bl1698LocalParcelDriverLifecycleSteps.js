'use strict';

// BL-1698: step handlers for "the local parcel driver survives a
// restart, releases its hold and handles merge-only mail". Reuses
// BL-1697's own fixture (makeLocalParcelDriverFixture) - the real driver
// via one bb CLI process per tick, a fake tmux, a real throwaway git
// checkout with the real `seat` script. Scenario 06 (QA bounce D1,
// 2026-09-25) drives babysitterd's OWN nudge pass -
// babysitter_nudge_lib.bb's nudge-resident! - through
// test_babysitter_nudge_driver_seat_skip.sh, its live consumer; the
// earlier version of this scenario reused
// test_handoffd_driver_seat_injection_skip.sh, which drives handoffd's
// wake path instead and stayed green whatever babysitter_nudge_lib.bb
// did (that daemon test still exists, and still proves the same
// property for handoffd's own call site).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { makeLocalParcelDriverFixture } = require('../../../extension/test/helpers/localParcelDriverFixture');

const FEATURE = 'BL-1698 the local parcel driver survives a restart, releases its hold and handles merge-only mail';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DRIVER_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');

const BABYSITTER_NUDGE_DRIVER_SKIP_TEST = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_babysitter_nudge_driver_seat_skip.sh'
);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function statePath(root) {
  return path.join(root, '.swarmforge', 'local-driver', 'coder.json');
}

// Drives ticks until the parcel reaches a terminal state (no state file,
// or escalated) or a bound is hit. The first tick always carries the
// `resume` flag (BL-1698's own "driver starts again" semantics); the
// stand-in model's deferred action (set by the shared "the stand-in
// model ..." step) fires once, the first time the driver is genuinely
// waiting on a model turn (phase "awaiting-model") - never eagerly, the
// same "acts between ticks" discipline BL-1697's own driveToEnd uses.
function driveResumeToEnd(ctx) {
  const { fixture, modelAction } = ctx;
  let modelActed = false;
  let result = fixture.driveOneTick({ resume: true });
  ctx.firstTickResult = result;
  for (let tick = 0; tick < 8; tick += 1) {
    const state = fixture.readDriverState();
    if (!state || state.escalated) {
      return { state, result };
    }
    if (state.phase === 'awaiting-model' && modelAction && !modelActed) {
      modelAction(fixture);
      modelActed = true;
    }
    result = fixture.driveOneTick(3);
  }
  throw new Error('driver did not reach a terminal state within the tick bound');
}

function countMergeCommits(root) {
  const log = git(root, ['log', '--format=%P']);
  return log
    .split('\n')
    .filter((l) => l.length > 0)
    .filter((l) => l.trim().split(/\s+/).length > 1).length;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a throwaway project whose coder seat is an aider seat under the driver$/, (ctx) => {
    ctx.fixture = makeLocalParcelDriverFixture();
    ctx.fixture.installDeliverRoleAnswerStub();
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => ctx.fixture.cleanup());
  });

  scoped(/^an active ticket BL-9 whose acceptance feature fails before any edit$/, (ctx) => {
    ctx.fixture.writeTicket({ editablePaths: ['editable.txt'] });
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the driver's record for BL-9 says it stopped (.+)$/, (ctx, after) => {
    const { fixture } = ctx;
    ctx.senderSha = fixture.makeSenderCommit();
    fixture.queueParcel(ctx.senderSha);
    // Move the queued parcel straight to in_process, as `seat next`
    // would - the resumed driver reads it from there, never re-serving
    // via the daemon's own queue.
    const newDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'new');
    const procDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(procDir, { recursive: true });
    for (const f of fs.readdirSync(newDir)) {
      fs.renameSync(path.join(newDir, f), path.join(procDir, f));
    }
    git(fixture.root, ['merge', '--no-ff', ctx.senderSha, '-m', 'merge sender']);
    const postMergeHead = git(fixture.root, ['rev-parse', 'HEAD']);

    if (after === 'after the merge and before the chat set') {
      fixture.writeDriverState({
        phase: 'post-merge',
        ticket: 'BL-9',
        senderRole: 'specifier',
        postMergeHead,
      });
    } else if (after === 'during the model turn with the spec unwritable') {
      const specFiles = [fixture.ticketPath, fixture.featurePath];
      fixture.writeDriverState({
        phase: 'awaiting-model',
        ticket: 'BL-9',
        senderRole: 'specifier',
        postMergeHead,
        specFiles,
        specHashesBefore: Object.fromEntries(
          specFiles.map((p) => [p, execFileSync('sha256sum', [p]).toString().split(' ')[0]])
        ),
        editablePaths: ['editable.txt'],
        fixTurnsUsed: 0,
        fixTurnsLimit: 3,
        acceptancePath: fixture.featurePath,
      });
      for (const p of specFiles) fs.chmodSync(p, 0o444);
    } else {
      throw new Error(`BL-1698: unrecognized <after> value "${after}"`);
    }
  });

  scoped(/^the stand-in model commits an edit that makes the acceptance feature pass$/, (ctx) => {
    ctx.modelAction = (fixture) => {
      fs.writeFileSync(path.join(fixture.root, 'editable.txt'), 'MARKER_FIXED\n');
      git(fixture.root, ['commit', '-q', '-am', 'model: fix it']);
    };
  });

  scoped(/^the driver starts again$/, (ctx) => {
    const outcome = driveResumeToEnd(ctx);
    ctx.finalState = outcome.state;
  });

  scoped(/^the ticket's spec files are writable before any other step runs$/, (ctx) => {
    // Isolates the sweep itself (requirement 1's own safety net) from
    // whatever this scenario's row later does to the files (row "after
    // the merge" locks them again later in the SAME resumed flow, as
    // part of setting up the chat for the model's own turn - a real
    // regression there would not read back as "never restored").
    const before = fs.statSync(ctx.fixture.ticketPath).mode & 0o200;
    execFileSync('bb', ['-e', `(load-file "${DRIVER_LIB}") (local-parcel-driver-lib/resume-writable-sweep! "${ctx.fixture.root}")`]);
    const after = fs.statSync(ctx.fixture.ticketPath).mode & 0o200;
    assert.ok(after !== 0, `expected the ticket file to be writable after the sweep (before=${before}, after=${after})`);
  });

  scoped(/^the parcel commit is merged exactly once$/, (ctx) => {
    const merges = countMergeCommits(ctx.fixture.root);
    assert.equal(merges, 1, `expected exactly one merge commit in history, got ${merges}`);
  });

  scoped(/^the pane received the instruction (once|never again)$/, (ctx, instructions) => {
    const instructionCount = ctx.fixture.tmux.calls().filter((c) => c.join(' ').includes('implement BL-9')).length;
    const expected = instructions === 'once' ? 1 : 0;
    assert.equal(
      instructionCount,
      expected,
      `expected the instruction to have been sent ${expected} time(s), got ${instructionCount}`
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

  // ── Scenario 02 ──────────────────────────────────────────────────────
  // Mirrors what run-gate!'s own fix-turns-exhausted escalation actually
  // leaves behind (specFiles, postMergeHead, etc all present) - "acceptance
  // still failing" is green-gate-decision's own reason text, i.e. this
  // models a POST-chat-setup escalation, never a bare pre-chat one.
  scoped(/^the driver escalated BL-9 with "([^"]+)" and holds it$/, (ctx, reason) => {
    const { fixture } = ctx;
    ctx.senderSha = fixture.makeSenderCommit();
    fixture.queueParcel(ctx.senderSha);
    const newDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'new');
    const procDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(procDir, { recursive: true });
    for (const f of fs.readdirSync(newDir)) {
      fs.renameSync(path.join(newDir, f), path.join(procDir, f));
    }
    git(fixture.root, ['merge', '--no-ff', ctx.senderSha, '-m', 'merge sender']);
    const postMergeHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const specFiles = [fixture.ticketPath, fixture.featurePath];
    for (const p of specFiles) fs.chmodSync(p, 0o444);
    fixture.writeDriverState({
      escalated: true,
      ticket: 'BL-9',
      reason,
      senderRole: 'specifier',
      postMergeHead,
      specFiles,
      specHashesBefore: Object.fromEntries(
        specFiles.map((p) => [p, execFileSync('sha256sum', [p]).toString().split(' ')[0]])
      ),
      editablePaths: ['editable.txt'],
      fixTurnsUsed: 3,
      fixTurnsLimit: 3,
      acceptancePath: fixture.featurePath,
    });
  });

  scoped(/^the human's answer to that question is waiting for the coder$/, (ctx) => {
    ctx.fixture.writeWaitingAnswer('use MARKER_FIXED as the sentinel');
  });

  scoped(/^the driver runs its next pass$/, (ctx) => {
    const outcome = driveResumeToEnd(ctx);
    ctx.finalState = outcome.state;
  });

  scoped(/^the answer is consumed through the role-answer delivery path$/, (ctx) => {
    const answerPath = path.join(ctx.fixture.root, '.swarmforge', 'operator', 'role-answers', 'coder.json');
    const answer = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
    assert.ok(answer.consumedAt, `expected the answer to be marked consumed, got: ${JSON.stringify(answer)}`);
  });

  scoped(/^the pane received one fix request carrying the answer text$/, (ctx) => {
    const calls = ctx.fixture.tmux.calls().filter((c) => c.join(' ').includes('use MARKER_FIXED as the sentinel'));
    assert.equal(calls.length, 1, `expected exactly one fix request carrying the answer text, got ${calls.length}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the operator releases the coder's hold with "([^"]+)"$/, (ctx, mode) => {
    ctx.releaseResult = ctx.fixture.releaseHold(mode);
  });

  scoped(/^the hold ends as "([^"]+)"$/, (ctx, expected) => {
    assert.equal(ctx.releaseResult.status, 0, `expected the release CLI to exit 0, got:\n${ctx.releaseResult.stderr}`);
    const parsed = JSON.parse(ctx.releaseResult.stdout.trim());
    if (expected === 'parcel completed, no git_handoff queued') {
      assert.equal(parsed.result, 'completed', `expected a completed result, got: ${JSON.stringify(parsed)}`);
      assert.equal(ctx.fixture.readDriverState(), null, 'expected the driver record to be cleared');
      const handoffCalls = ctx.fixture.recordedCalls().filter((c) => c.script === 'swarm_handoff.sh');
      assert.equal(handoffCalls.length, 0, 'expected no git_handoff to be queued');
    } else if (expected === 'record cleared, served afresh on the next pass') {
      assert.equal(parsed.result, 'cleared', `expected a cleared result, got: ${JSON.stringify(parsed)}`);
      assert.equal(ctx.fixture.readDriverState(), null, 'expected the driver record to be cleared');
    } else {
      throw new Error(`BL-1698: unrecognized <result> "${expected}"`);
    }
  });

  scoped(/^the pane received no new text$/, (ctx) => {
    const before = ctx.tmuxCallCountBeforeRelease || 0;
    assert.equal(
      ctx.fixture.tmux.calls().length,
      before,
      'expected no additional pane text from the release'
    );
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the coder's next mail is (.+)$/, (ctx, mail) => {
    const { fixture } = ctx;
    ctx.mergedCommit = fixture.makeSenderCommit();
    ctx.tmuxCallCountBeforeRelease = fixture.tmux.calls().length;
    if (mail === 'a QA merge-up note naming a QA-approved commit') {
      const shortSha = ctx.mergedCommit.slice(0, 10);
      fixture.queueNoteMail(`BL-9 QA-approved ${shortSha} - merge your branch up to QA's`, { from: 'QA' });
    } else if (mail === 'a non-forwarding git_handoff reverse copy from the cleaner') {
      fixture.queueNonForwardingParcel(ctx.mergedCommit, { from: 'cleaner' });
    } else if (mail === 'a note from the specifier reading "BL-9 amended, merge main"') {
      fixture.queueNoteMail('BL-9 amended, merge main', { from: 'specifier' });
    } else {
      throw new Error(`BL-1698: unrecognized <mail> "${mail}"`);
    }
  });

  scoped(/^the checkout holds a merge of that mail's commit$/, (ctx) => {
    const log = git(ctx.fixture.root, ['log', '--format=%H %P']).split('\n');
    const [tipSha, ...tipParents] = log[0].split(' ');
    assert.ok(
      tipParents.includes(ctx.mergedCommit),
      `expected the checkout tip (${tipSha}) to be a merge naming ${ctx.mergedCommit} as a parent, got parents: ${tipParents}`
    );
  });

  scoped(/^the mail is completed with no git_handoff queued and no text typed into the pane$/, (ctx) => {
    const handoffCalls = ctx.fixture.recordedCalls().filter((c) => c.script === 'swarm_handoff.sh');
    assert.equal(handoffCalls.length, 0, `expected no swarm_handoff.sh call, got: ${JSON.stringify(handoffCalls)}`);
    const inProcess = fs.readdirSync(path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    assert.deepEqual(inProcess, [], `expected an empty in_process dir, got: ${JSON.stringify(inProcess)}`);
    const newTmuxCalls = ctx.fixture.tmux.calls().length - (ctx.tmuxCallCountBeforeRelease || 0);
    assert.equal(newTmuxCalls, 0, `expected no new pane text, got ${newTmuxCalls} new call(s)`);
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^exactly one question is raised for the coder quoting the note's sender and text$/, (ctx) => {
    const calls = ctx.fixture.recordedCalls().filter((c) => c.script === 'role_ask.bb');
    assert.equal(calls.length, 1, `expected exactly one role_ask.bb call, got: ${JSON.stringify(calls)}`);
    const questionArg = calls[0].argv[calls[0].argv.length - 1];
    assert.equal(questionArg, 'specifier: BL-9 amended, merge main', `unexpected question text: ${questionArg}`);
  });

  // ── Scenario 06 (QA bounce D1: drives babysitterd's own nudge pass) ──
  scoped(/^babysitterd finds both the coder's aider pane and a Claude seat's pane idle with work$/, () => {
    /* fixture is the dedicated shell test's own throwaway tmux/roles.tsv
       setup - nothing to arrange here; it IS the "idle with work" state. */
  });

  scoped(/^babysitterd runs its nudge pass$/, (ctx) => {
    ctx.nudgeResult = spawnSync('bash', [BABYSITTER_NUDGE_DRIVER_SKIP_TEST], { encoding: 'utf8', timeout: 30000 });
  });

  scoped(/^the coder's aider pane received no text from it$/, (ctx) => {
    assert.equal(
      ctx.nudgeResult.status,
      0,
      `expected the babysitter nudge driver-skip test to pass:\n${ctx.nudgeResult.stdout}\n${ctx.nudgeResult.stderr}`
    );
    assert.match(
      ctx.nudgeResult.stdout,
      /01: the coder \(driver\) seat's aider pane received no typed text from babysitterd's nudge pass/
    );
    assert.match(ctx.nudgeResult.stdout, /03: no tmux send-keys ever reached the coder \(driver\) seat's pane/);
  });

  scoped(/^the Claude seat's pane received the same nudge as before this ticket$/, (ctx) => {
    assert.match(ctx.nudgeResult.stdout, /02: a Claude seat with work still received its wake/);
    assert.match(ctx.nudgeResult.stdout, /04: the cleaner \(non-driver\) seat's pane received a real tmux send-keys/);
  });
}

module.exports = { registerSteps };
