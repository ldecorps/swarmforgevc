'use strict';

// BL-713 (slice A of BL-712): the Cursor seat driver — a testable module that
// maps a role seat's lifecycle onto an agent session, and decides ONLY from
// structured session signals.
//
// Every side effect the driver can perform goes through an injected seam
// (runHelper / writeFile / openSession / sendTask / composePromptBundle /
// now), so these tests observe the complete effect set rather than a sampled
// one. That is what lets scenario cursor-seat-03's "it writes nothing directly
// into another role's inbox" be an assertion about every write the run made,
// not about the one write the test happened to look for.

const assert = require('node:assert/strict');

const {
  CURSOR_SEAT_SPIKE_ESCAPE_ENV,
  CURSOR_SEAT_SPIKE_ESCAPE_VALUE,
  MODEL_STEWARD_REGISTRY_RELATIVE_PATH,
  identityKey,
  readIdentityStatus,
  resolvePackPosture,
  admitCursorIdentity,
  roleWorktreePath,
  decideNextStep,
  buildSeatHandoffDraft,
  parseReadyForNextOutput,
  renderTranscript,
  runSeatOnce,
} = require('../out/swarm/cursorSeatDriver');

// ── fixtures ──────────────────────────────────────────────────────────────

const CERTIFIED = { provider: 'cursor', model: 'composer-1' };
const CANDIDATE = { provider: 'cursor', model: 'auto' };

const REGISTRY = {
  models: {
    'cursor/composer-1': { provider: 'cursor', model: 'composer-1', status: 'certified' },
    'cursor/auto': { provider: 'cursor', model: 'auto', status: 'candidate' },
  },
};

const SPIKE_ENV = { [CURSOR_SEAT_SPIKE_ESCAPE_ENV]: CURSOR_SEAT_SPIKE_ESCAPE_VALUE };

// A recording deps set. Nothing here reads a pane, a tmux socket, or a
// terminal: the driver is handed structured values and its own seams.
function makeDeps(overrides = {}) {
  const calls = {
    helpers: [],
    writes: [],
    sessions: [],
    tasksSent: [],
    composed: [],
  };
  const deps = {
    readRegistry: () => REGISTRY,
    composePromptBundle: async (role) => {
      calls.composed.push(role);
      return `SYSTEM PROMPT BUNDLE for ${role}`;
    },
    openSession: async (opts) => {
      calls.sessions.push(opts);
      return { sessionId: 'session-1' };
    },
    sendTask: async (session, task) => {
      calls.tasksSent.push({ session, task });
      return {
        signal: { kind: 'stop_reason', value: 'completed' },
        transcript: ['agent: read the ticket', 'agent: committed'],
        work: { task: 'bl-999-a-thing', commit: 'abcdef0123' },
      };
    },
    runHelper: async (name) => {
      calls.helpers.push(name);
      if (name === 'ready_for_next') {
        return {
          exitCode: 0,
          stdout: [
            'TASK: /repo/.swarmforge/handoffs/inbox/in_process/10_x.handoff',
            'FROM: coordinator',
            'TYPE: git_handoff',
            'PRIORITY: 50',
            'TASK_NAME: bl-999-a-thing',
            'PAYLOAD:',
            'merge_and_process abcdef0123',
          ].join('\n'),
        };
      }
      return { exitCode: 0, stdout: 'handoff sent' };
    },
    writeFile: (filePath, content) => {
      calls.writes.push({ path: filePath, content });
    },
    now: () => '20260822T235959Z',
    ...overrides,
  };
  return { deps, calls };
}

const RUN_OPTS = {
  repoRoot: '/repo',
  role: 'documenter',
  identity: CERTIFIED,
  env: {},
};

// ── identityKey / readIdentityStatus (pure, fails closed) ─────────────────

test('an identity is keyed provider/model, the same key the steward registry uses', () => {
  assert.equal(identityKey(CERTIFIED), 'cursor/composer-1');
});

test('a registered identity reports the status the registry recorded', () => {
  assert.equal(readIdentityStatus(REGISTRY, CERTIFIED), 'certified');
  assert.equal(readIdentityStatus(REGISTRY, CANDIDATE), 'candidate');
});

test('an identity absent from the registry is unknown, never certified', () => {
  assert.equal(readIdentityStatus(REGISTRY, { provider: 'cursor', model: 'never-seen' }), 'unknown');
});

test('an unreadable or malformed registry fails closed to unknown', () => {
  assert.equal(readIdentityStatus(undefined, CERTIFIED), 'unknown');
  assert.equal(readIdentityStatus({ models: 'not-a-map' }, CERTIFIED), 'unknown');
  assert.equal(readIdentityStatus({ models: { 'cursor/composer-1': {} } }, CERTIFIED), 'unknown');
});

test('the registry path the driver reads is the model steward registry', () => {
  assert.equal(MODEL_STEWARD_REGISTRY_RELATIVE_PATH, '.swarmforge/model-steward/registry.json');
});

// ── resolvePackPosture ────────────────────────────────────────────────────

test('with no escape set the seat runs for a production pack', () => {
  assert.equal(resolvePackPosture({}), 'production');
});

test('the spike-only escape, set to its exact value, makes the run a spike', () => {
  assert.equal(resolvePackPosture(SPIKE_ENV), 'spike');
});

test('an escape set to anything other than its exact value is still production', () => {
  for (const value of ['', '0', 'true', 'yes', ' 1', 'spike']) {
    assert.equal(
      resolvePackPosture({ [CURSOR_SEAT_SPIKE_ESCAPE_ENV]: value }),
      'production',
      `escape value ${JSON.stringify(value)} must not admit a spike run`
    );
  }
});

// ── admitCursorIdentity (cursor-seat-06) ──────────────────────────────────

test('a certified identity is admitted for a production pack', () => {
  const verdict = admitCursorIdentity({ identity: CERTIFIED, status: 'certified', posture: 'production' });
  assert.equal(verdict.admitted, true);
  assert.match(verdict.reason, /certified/);
});

test('an uncertified identity is refused for a production pack, naming certification', () => {
  const verdict = admitCursorIdentity({ identity: CANDIDATE, status: 'candidate', posture: 'production' });
  assert.equal(verdict.admitted, false);
  assert.match(verdict.reason, /not certified/);
  assert.match(verdict.reason, /model steward registry/);
  assert.match(verdict.reason, /cursor\/auto/);
});

test('the spike-only escape admits an uncertified candidate, and says so', () => {
  const verdict = admitCursorIdentity({ identity: CANDIDATE, status: 'candidate', posture: 'spike' });
  assert.equal(verdict.admitted, true);
  assert.match(verdict.reason, new RegExp(CURSOR_SEAT_SPIKE_ESCAPE_ENV));
});

test('an unknown identity is refused for a production pack exactly like a candidate', () => {
  const verdict = admitCursorIdentity({ identity: CANDIDATE, status: 'unknown', posture: 'production' });
  assert.equal(verdict.admitted, false);
  assert.match(verdict.reason, /not certified/);
});

// ── roleWorktreePath (cursor-seat-01) ─────────────────────────────────────

test('a pipeline role is bound to its own worktree', () => {
  assert.equal(roleWorktreePath('/repo', 'documenter'), '/repo/.worktrees/documenter');
  assert.equal(roleWorktreePath('/repo', 'QA'), '/repo/.worktrees/QA');
});

test('a master-resident role is bound to the repo root, not a worktree that does not exist', () => {
  assert.equal(roleWorktreePath('/repo', 'coordinator'), '/repo');
  assert.equal(roleWorktreePath('/repo', 'specifier'), '/repo');
});

// ── decideNextStep (cursor-seat-04) ───────────────────────────────────────

test('a completed stop reason decides to forward the parcel', () => {
  const decision = decideNextStep({ kind: 'stop_reason', value: 'completed' });
  assert.equal(decision.step, 'forward_handoff');
  assert.equal(decision.fromSignal, 'stop_reason:completed');
});

test('a refused or errored stop reason aborts rather than forwarding', () => {
  assert.equal(decideNextStep({ kind: 'stop_reason', value: 'refused' }).step, 'abort');
  assert.equal(decideNextStep({ kind: 'stop_reason', value: 'error' }).step, 'abort');
});

test('a granted tool event continues the session; a denied one stops the seat', () => {
  const granted = decideNextStep({ kind: 'tool_event', tool: 'shell', permission: 'granted' });
  assert.equal(granted.step, 'continue_session');
  assert.equal(granted.fromSignal, 'tool_event:shell:granted');

  const denied = decideNextStep({ kind: 'tool_event', tool: 'shell', permission: 'denied' });
  assert.equal(denied.step, 'abort');
});

test('a zero helper exit continues; a non-zero one aborts and names the helper', () => {
  const ok = decideNextStep({ kind: 'helper_exit', helper: 'ready_for_next', exitCode: 0 });
  assert.equal(ok.step, 'continue_session');
  assert.equal(ok.fromSignal, 'helper_exit:ready_for_next:0');

  const bad = decideNextStep({ kind: 'helper_exit', helper: 'swarm_handoff', exitCode: 3 });
  assert.equal(bad.step, 'abort');
  assert.match(bad.reason, /swarm_handoff/);
});

test('a sent handoff leaves the seat waiting for a wake, never polling again', () => {
  const decision = decideNextStep({ kind: 'helper_exit', helper: 'swarm_handoff', exitCode: 0, forwarded: true });
  assert.equal(decision.step, 'await_wake');
});

test('an unrecognised signal aborts rather than guessing a step', () => {
  const decision = decideNextStep({ kind: 'pane_text', text: 'looks done to me' });
  assert.equal(decision.step, 'abort');
  assert.match(decision.reason, /unrecognised/i);
});

test('two signals a pane scraper would render identically decide differently', () => {
  // The collision shape: a naive implementation reading rendered text sees the
  // word "completed" in both. One is the session's stop reason; the other is a
  // DENIED tool event that merely happens to be named for it.
  const stop = decideNextStep({ kind: 'stop_reason', value: 'completed' });
  const tool = decideNextStep({ kind: 'tool_event', tool: 'completed', permission: 'denied' });
  assert.notEqual(stop.step, tool.step);
});

// ── buildSeatHandoffDraft (cursor-seat-03) ────────────────────────────────

test('the draft is field: value header lines, never JSON', () => {
  const draft = buildSeatHandoffDraft({ to: 'QA', priority: '50', task: 'bl-999-a-thing', commit: 'abcdef0123' });
  assert.equal(
    draft,
    'type: git_handoff\nto: QA\npriority: 50\ntask: bl-999-a-thing\ncommit: abcdef0123\n'
  );
  assert.ok(!draft.includes('{'), 'a JSON envelope is rejected by the handoff parser');
});

test('a commit that is not exactly ten hex characters is refused, not sent', () => {
  for (const commit of ['abcdef012', 'abcdef01234', 'ABCDEF0123', 'ghijklmnop', '']) {
    assert.throws(
      () => buildSeatHandoffDraft({ to: 'QA', priority: '50', task: 't', commit }),
      /commit/,
      `commit ${JSON.stringify(commit)} must be refused`
    );
  }
});

test('a priority that is not two digits is refused', () => {
  assert.throws(() => buildSeatHandoffDraft({ to: 'QA', priority: '5', task: 't', commit: 'abcdef0123' }), /priority/);
  assert.throws(() => buildSeatHandoffDraft({ to: 'QA', priority: '100', task: 't', commit: 'abcdef0123' }), /priority/);
});

test('a draft with no recipient is refused', () => {
  assert.throws(() => buildSeatHandoffDraft({ to: '', priority: '50', task: 't', commit: 'abcdef0123' }), /to/);
});

test('a recipient that is only whitespace is refused too, not treated as a real name', () => {
  assert.throws(() => buildSeatHandoffDraft({ to: '   ', priority: '50', task: 't', commit: 'abcdef0123' }), /to/);
});

test('a draft with no task name is refused', () => {
  assert.throws(() => buildSeatHandoffDraft({ to: 'QA', priority: '50', task: '', commit: 'abcdef0123' }), /task/);
});

test('a task name that is only whitespace is refused too, not treated as a real name', () => {
  assert.throws(() => buildSeatHandoffDraft({ to: 'QA', priority: '50', task: '   ', commit: 'abcdef0123' }), /task/);
});

// ── parseReadyForNextOutput ───────────────────────────────────────────────

test('a task returned by the helper is parsed into its structured fields', () => {
  const parsed = parseReadyForNextOutput(
    ['TASK: /repo/inbox/in_process/10_x.handoff', 'FROM: coordinator', 'TYPE: git_handoff', 'PRIORITY: 50', 'TASK_NAME: bl-999-a-thing', 'PAYLOAD:', 'merge_and_process abcdef0123'].join('\n')
  );
  assert.equal(parsed.status, 'task');
  assert.equal(parsed.from, 'coordinator');
  assert.equal(parsed.type, 'git_handoff');
  assert.equal(parsed.priority, '50');
  assert.equal(parsed.taskName, 'bl-999-a-thing');
  assert.equal(parsed.file, '/repo/inbox/in_process/10_x.handoff');
  assert.match(parsed.payload, /merge_and_process abcdef0123/);
});

test('NO_TASK is an empty mailbox, not a task', () => {
  assert.equal(parseReadyForNextOutput('NO_TASK\n').status, 'no_task');
});

test('ROTATE_HOME and DRAINING are their own outcomes, never mistaken for a task', () => {
  assert.equal(parseReadyForNextOutput('ROTATE_HOME\nHOME_ROLE: coder\n').status, 'rotate_home');
  assert.equal(parseReadyForNextOutput('DRAINING\n').status, 'draining');
});

// ── runSeatOnce: cursor-seat-01 ───────────────────────────────────────────

test('the seat boots with its own role prompt bundle, bound to its own worktree', async () => {
  const { deps, calls } = makeDeps();
  await runSeatOnce(deps, RUN_OPTS);

  assert.deepEqual(calls.composed, ['documenter']);
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.sessions[0].promptBundle, 'SYSTEM PROMPT BUNDLE for documenter');
  assert.equal(calls.sessions[0].cwd, '/repo/.worktrees/documenter');
  assert.equal(calls.sessions[0].role, 'documenter');
});

// ── runSeatOnce: cursor-seat-02 ───────────────────────────────────────────

test('a wake makes the seat run ready-for-next and hand the parcel to the session', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await runSeatOnce(deps, RUN_OPTS);

  assert.equal(calls.helpers[0], 'ready_for_next');
  assert.equal(calls.tasksSent.length, 1);
  assert.equal(calls.tasksSent[0].task.taskName, 'bl-999-a-thing');
  assert.match(calls.tasksSent[0].task.payload, /merge_and_process/);
  assert.equal(outcome.outcome, 'forwarded');
});

// ── runSeatOnce: cursor-seat-03 ───────────────────────────────────────────

test('the parcel leaves through the handoff helper and nothing is written into an inbox', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await runSeatOnce(deps, RUN_OPTS);

  assert.deepEqual(calls.helpers, ['ready_for_next', 'swarm_handoff']);
  assert.equal(outcome.forwardedTo, 'QA');

  const draftWrite = calls.writes.find((w) => w.path.endsWith('tmp/handoff.txt'));
  assert.ok(draftWrite, 'the draft is written to the seat worktree tmp/handoff.txt');
  assert.equal(draftWrite.path, '/repo/.worktrees/documenter/tmp/handoff.txt');
  assert.match(draftWrite.content, /^type: git_handoff$/m);
  assert.match(draftWrite.content, /^to: QA$/m);

  for (const write of calls.writes) {
    assert.ok(
      !write.path.includes('handoffs/inbox'),
      `the driver must never write into a mailbox directly: ${write.path}`
    );
  }
});

test('the handoff helper is invoked with the draft file the driver just wrote', async () => {
  const seen = [];
  const { deps } = makeDeps({
    runHelper: async (name, args) => {
      seen.push({ name, args });
      if (name === 'ready_for_next') {
        return { exitCode: 0, stdout: 'TASK: /x\nFROM: coordinator\nTYPE: git_handoff\nPRIORITY: 50\nTASK_NAME: t\nPAYLOAD:\nbody\n' };
      }
      return { exitCode: 0, stdout: '' };
    },
  });
  await runSeatOnce(deps, RUN_OPTS);
  const handoff = seen.find((c) => c.name === 'swarm_handoff');
  assert.deepEqual(handoff.args, ['/repo/.worktrees/documenter/tmp/handoff.txt']);
});

test('a session that finishes without naming a commit aborts instead of forwarding', async () => {
  const { deps, calls } = makeDeps({
    sendTask: async () => ({
      signal: { kind: 'stop_reason', value: 'completed' },
      transcript: [],
      work: { task: 'bl-999-a-thing' },
    }),
  });
  const outcome = await runSeatOnce(deps, RUN_OPTS);
  assert.equal(outcome.outcome, 'aborted');
  assert.match(outcome.reason, /commit/);
  assert.ok(!calls.helpers.includes('swarm_handoff'), 'nothing may be forwarded without a commit');
});

test('a session that finishes with NO work field at all aborts, rather than throwing on the missing object', async () => {
  // `work` is declared optional on SeatTaskResult - a completed session that
  // never did any task/commit work can legitimately omit it entirely, not
  // just leave individual fields empty. resolveForwardTarget must reach
  // through `result.work` safely (optional chaining) rather than assuming
  // the object is present.
  const { deps, calls } = makeDeps({
    sendTask: async () => ({
      signal: { kind: 'stop_reason', value: 'completed' },
      transcript: [],
      // work omitted entirely - not `work: undefined`, not present at all
    }),
  });
  const outcome = await runSeatOnce(deps, RUN_OPTS);
  assert.equal(outcome.outcome, 'aborted');
  assert.match(outcome.reason, /commit/);
  assert.ok(!calls.helpers.includes('swarm_handoff'));
});

test('a non-zero handoff helper exit is an aborted run, never reported as forwarded', async () => {
  const { deps } = makeDeps({
    runHelper: async (name) => {
      if (name === 'ready_for_next') {
        return { exitCode: 0, stdout: 'TASK: /x\nFROM: coordinator\nTYPE: git_handoff\nPRIORITY: 50\nTASK_NAME: t\nPAYLOAD:\nbody\n' };
      }
      return { exitCode: 4, stdout: 'quarantined' };
    },
  });
  const outcome = await runSeatOnce(deps, RUN_OPTS);
  assert.equal(outcome.outcome, 'aborted');
  assert.match(outcome.reason, /swarm_handoff/);
});

// ── runSeatOnce: cursor-seat-05 ───────────────────────────────────────────

test('an empty mailbox reports no task and does not poll again', async () => {
  const { deps, calls } = makeDeps({
    runHelper: async (name) => {
      calls.helpers.push(name);
      return { exitCode: 0, stdout: 'NO_TASK\n' };
    },
  });
  const outcome = await runSeatOnce(deps, RUN_OPTS);

  assert.equal(outcome.outcome, 'no_task');
  assert.equal(outcome.readyForNextCalls, 1);
  assert.equal(calls.helpers.filter((h) => h === 'ready_for_next').length, 1);
  assert.equal(calls.tasksSent.length, 0);
});

// ── runSeatOnce: cursor-seat-06 ───────────────────────────────────────────

test('a production pack refuses an uncertified identity before opening any session', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await runSeatOnce(deps, { ...RUN_OPTS, identity: CANDIDATE, env: {} });

  assert.equal(outcome.outcome, 'refused_uncertified');
  assert.equal(outcome.posture, 'production');
  assert.match(outcome.reason, /not certified/);
  assert.match(outcome.reason, /model steward registry/);
  assert.deepEqual(calls.sessions, []);
  assert.deepEqual(calls.helpers, []);
  assert.deepEqual(calls.writes, []);
});

test('with the spike-only escape set, the same uncertified identity completes a parcel', async () => {
  const { deps } = makeDeps();
  const outcome = await runSeatOnce(deps, { ...RUN_OPTS, identity: CANDIDATE, env: SPIKE_ENV });

  assert.equal(outcome.outcome, 'forwarded');
  assert.equal(outcome.posture, 'spike');
});

// ── runSeatOnce: cursor-seat-07 ───────────────────────────────────────────

test('the session transcript is written where a human can read it, and named in the outcome', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await runSeatOnce(deps, RUN_OPTS);

  assert.equal(outcome.transcriptPath, '/repo/.swarmforge/cursor-seat/documenter-20260822T235959Z.transcript.md');
  const write = calls.writes.find((w) => w.path === outcome.transcriptPath);
  assert.ok(write, 'the transcript is actually written, not merely named');
  assert.match(write.content, /agent: committed/);
  assert.match(write.content, /documenter/);
});

test('a refused run still leaves the human a record of why nothing ran', async () => {
  const { deps } = makeDeps();
  const outcome = await runSeatOnce(deps, { ...RUN_OPTS, identity: CANDIDATE, env: {} });
  assert.equal(outcome.transcriptPath, undefined);
  assert.match(outcome.reason, /cursor\/auto/);
});

test('renderTranscript records the role, the identity, and every session line', () => {
  const text = renderTranscript({
    role: 'documenter',
    identity: CANDIDATE,
    posture: 'spike',
    stamp: '20260822T235959Z',
    lines: ['agent: hello', 'agent: bye'],
  });
  assert.match(text, /documenter/);
  assert.match(text, /cursor\/auto/);
  assert.match(text, /spike/);
  assert.match(text, /agent: hello/);
  assert.match(text, /agent: bye/);
});

// ── decisions are recorded, so a human can see what drove each step ───────

test('every step the run took names the structured signal it came from', async () => {
  const { deps } = makeDeps();
  const outcome = await runSeatOnce(deps, RUN_OPTS);
  assert.ok(outcome.decisions.length >= 1);
  for (const decision of outcome.decisions) {
    assert.match(decision.fromSignal, /^(stop_reason|tool_event|helper_exit):/);
  }
});
