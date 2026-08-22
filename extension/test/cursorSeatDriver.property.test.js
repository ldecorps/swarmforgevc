'use strict';

// BL-713 property test (coder-authored, THREE declared invariants).
//
//   Invariant 1 (no private side channel): the seat driver reaches the swarm
//   ONLY through the handoff helpers and the mailbox every other agent uses.
//   It never delivers or completes a parcel by a path that bypasses
//   coordinator routing.
//   Invariant 2 (structured signals only): every driver decision is taken
//   from a structured session signal - never from rendered pane text.
//   Invariant 3 (certification gate): a Cursor identity that is not certified
//   in the Model Steward registry cannot be selected for a production pack;
//   only an explicit spike-only escape admits a candidate.
//
// WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every run the
// seat could possibly make". The unit tests pin the shapes a reviewer thinks
// of; the leak that matters is the one nobody thought of - a run that reaches
// the forward step by an unusual route and writes its draft somewhere else, a
// signal shape that falls through the decision table into a default, an
// escape/status/posture combination whose ordering admits the wrong thing.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Three states a naive generator would essentially never produce:
//
//   (a) THE FORWARD STEP ITSELF. Invariant 1 is only interesting on runs that
//       actually reach a handoff: a generator drawing signals uniformly would
//       spend most of its budget on aborted runs, where no draft is written at
//       all and "wrote nothing into an inbox" is vacuously true. Completed
//       runs carrying a well-formed commit are therefore CONSTRUCTED, and a
//       floor asserts they occurred.
//
//   (b) THE PANE-TEXT COLLISION. This is the collision shape BL-654 warns
//       about: drawing two signals independently would collide on their
//       rendered wording essentially never. So the second signal of each pair
//       is DERIVED FROM THE FIRST by the transformation a text scraper
//       conflates - the first signal's own words are reused as a tool name -
//       and every generated pair is a collision candidate by construction.
//
//   (c) UNCERTIFIED-WITH-ESCAPE-ON-A-PRODUCTION-PACK. Drawing status, posture
//       and escape independently makes the interesting corner (an escape set
//       to a NEAR-MISS value, which must stay production) rare. Near-miss
//       escape values are drawn from an explicit set alongside the exact one,
//       and each arm carries its own floor.
//
// Every outcome carries a floor, so a generator change that quietly stops
// producing forwards - or stops producing refusals, which would make
// invariant 3 vacuous - fails here rather than passing silently.

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  CURSOR_SEAT_SPIKE_ESCAPE_ENV,
  CURSOR_SEAT_SPIKE_ESCAPE_VALUE,
  admitCursorIdentity,
  decideNextStep,
  readIdentityStatus,
  resolvePackPosture,
  runSeatOnce,
} = require('../out/swarm/cursorSeatDriver');

const RUNS = 400;
const REPO_ROOT = '/repo';
const PIPELINE_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

// ──────────────────────────────────────────────────────────────────────────
// Invariant 1 — the seat reaches the swarm only through the helpers.
// ──────────────────────────────────────────────────────────────────────────

// The complete allowlist. A run that touches anything outside it is a private
// side channel, whatever it is called.
const ALLOWED_HELPERS = new Set(['ready_for_next', 'swarm_handoff']);

function isMailboxPath(p) {
  return /handoffs?[\\/](inbox|outbox|in_process|new|cur|tmp)\b/.test(p) || p.includes('handoffs/inbox');
}

const hexCommit = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 10, maxLength: 10 })
  .map((chars) => chars.join(''));

// Constructed reach (a): a session outcome that ACTUALLY reaches the forward
// step, alongside the shapes that stop short of it - each drawn deliberately
// so no arm can vanish.
// WEIGHTED, not uniform. Reaching the forward step needs FOUR independent
// draws to agree (a completed arm, a task in the mailbox, a helper that
// accepts it, a role that has a next stage). Drawn uniformly that conjunction
// lands ~3% of the time and the floor below catches it - which is the point of
// asserting reach rather than hoping for it. The progress arms are weighted up
// so forwards are common while every stopping shape still occurs.
const sessionOutcome = fc.oneof(
  // completed WITH a commit -> the forward step (the interesting arm)
  { arbitrary: fc.record({ arm: fc.constant('forward'), commit: hexCommit, task: fc.constant('bl-713-a-thing') }), weight: 6 },
  // completed WITHOUT a commit -> must abort before writing a draft
  { arbitrary: fc.record({ arm: fc.constant('no-commit'), commit: fc.constant(undefined), task: fc.constant('bl-713-a-thing') }), weight: 1 },
  { arbitrary: fc.record({ arm: fc.constant('refused'), commit: hexCommit, task: fc.constant('bl-713-a-thing') }), weight: 1 },
  { arbitrary: fc.record({ arm: fc.constant('denied-tool'), commit: hexCommit, task: fc.constant('bl-713-a-thing') }), weight: 1 }
);

const mailboxState = fc.oneof(
  { arbitrary: fc.constant('task'), weight: 6 },
  { arbitrary: fc.constant('no_task'), weight: 2 },
  { arbitrary: fc.constant('rotate_home'), weight: 1 },
  { arbitrary: fc.constant('draining'), weight: 1 },
  { arbitrary: fc.constant('helper_failed'), weight: 1 }
);

// The handoff helper usually accepts - a uniform coin would halve the forward
// arm again on top of the two draws above.
const handoffFailure = fc.oneof({ arbitrary: fc.constant(false), weight: 4 }, { arbitrary: fc.constant(true), weight: 1 });

function signalFor(arm) {
  if (arm === 'refused') {
    return { kind: 'stop_reason', value: 'refused' };
  }
  if (arm === 'denied-tool') {
    return { kind: 'tool_event', tool: 'shell', permission: 'denied' };
  }
  return { kind: 'stop_reason', value: 'completed' };
}

function readyStdoutFor(state) {
  if (state === 'no_task') return 'NO_TASK\n';
  if (state === 'rotate_home') return 'ROTATE_HOME\nHOME_ROLE: coder\n';
  if (state === 'draining') return 'DRAINING\n';
  return [
    'TASK: /repo/.swarmforge/handoffs/inbox/in_process/10_x.handoff',
    'FROM: coordinator',
    'TYPE: git_handoff',
    'PRIORITY: 50',
    'TASK_NAME: bl-713-a-thing',
    'PAYLOAD:',
    'merge_and_process 0123456789',
  ].join('\n');
}

test('invariant 1: every run reaches the swarm only through the two helpers, and never writes into a mailbox', async () => {
  const reached = { forwarded: 0, aborted: 0, no_task: 0, refused_uncertified: 0 };

  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...PIPELINE_ROLES),
      sessionOutcome,
      mailboxState,
      handoffFailure,
      async (role, outcome, mailbox, handoffFails) => {
        const helpers = [];
        const writes = [];
        const deps = {
          readRegistry: () => ({ models: { 'cursor/composer-1': { status: 'certified' } } }),
          composePromptBundle: async () => 'bundle',
          openSession: async () => ({ sessionId: 's' }),
          sendTask: async () => ({
            signal: signalFor(outcome.arm),
            transcript: ['agent: line'],
            work: { task: outcome.task, commit: outcome.commit },
          }),
          runHelper: async (name, args) => {
            helpers.push({ name, args });
            if (name === 'ready_for_next') {
              return mailbox === 'helper_failed'
                ? { exitCode: 7, stdout: '' }
                : { exitCode: 0, stdout: readyStdoutFor(mailbox) };
            }
            return { exitCode: handoffFails ? 3 : 0, stdout: '' };
          },
          writeFile: (p, content) => writes.push({ path: p, content }),
          now: () => 'STAMP',
        };

        const result = await runSeatOnce(deps, {
          repoRoot: REPO_ROOT,
          role,
          identity: { provider: 'cursor', model: 'composer-1' },
          env: {},
        });
        reached[result.outcome] = (reached[result.outcome] ?? 0) + 1;

        // Only the two allowlisted helpers, ever.
        for (const call of helpers) {
          assert.ok(ALLOWED_HELPERS.has(call.name), `helper "${call.name}" is outside the allowlist`);
        }
        // Nothing is ever written into a mailbox - not the draft, not the
        // transcript, not on any abort path.
        for (const write of writes) {
          assert.ok(!isMailboxPath(write.path), `wrote into a mailbox: ${write.path}`);
        }
        // Every write lands under this seat's own worktree or the shared
        // transcript directory; nowhere else is reachable at all.
        const worktree =
          role === 'coordinator' || role === 'specifier' ? REPO_ROOT : `${REPO_ROOT}/.worktrees/${role}`;
        for (const write of writes) {
          assert.ok(
            write.path === `${worktree}/tmp/handoff.txt` ||
              write.path.startsWith(`${REPO_ROOT}/.swarmforge/cursor-seat/`),
            `unexpected write target: ${write.path}`
          );
        }
        // A parcel is only ever DELIVERED by the handoff helper. If a draft
        // was written, the helper ran on exactly that file; if no draft was
        // written, the helper never ran.
        const draft = writes.find((w) => w.path.endsWith('tmp/handoff.txt'));
        const sends = helpers.filter((c) => c.name === 'swarm_handoff');
        if (draft) {
          assert.equal(sends.length, 1);
          assert.deepEqual(sends[0].args, [draft.path]);
          assert.match(draft.content, /^type: git_handoff$/m);
          assert.ok(!draft.content.includes('{'), 'a JSON envelope would be quarantined, not delivered');
        } else {
          assert.equal(sends.length, 0, 'a handoff was sent with no draft behind it');
        }
        // "forwarded" is only ever claimed when the helper actually accepted it.
        if (result.outcome === 'forwarded') {
          assert.equal(sends.length, 1);
          assert.equal(handoffFails, false);
          assert.ok(result.forwardedTo && result.forwardedTo !== role);
        }
        return true;
      }
    ),
    { numRuns: RUNS }
  );

  // Reach floors (a): the forward step, and every stopping shape, actually
  // occurred - otherwise the assertions above are vacuous.
  assert.ok(reached.forwarded >= 20, `forwarded runs too rare to test invariant 1: ${reached.forwarded}`);
  assert.ok(reached.aborted >= 20, `aborted runs too rare: ${reached.aborted}`);
  assert.ok(reached.no_task >= 20, `empty-mailbox runs too rare: ${reached.no_task}`);
});

test('invariant 1 (reach): an empty mailbox never costs a second poll, whatever the role', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...PIPELINE_ROLES), fc.constantFrom('no_task', 'rotate_home', 'draining'), async (role, state) => {
      let readyCalls = 0;
      const deps = {
        readRegistry: () => ({ models: { 'cursor/composer-1': { status: 'certified' } } }),
        composePromptBundle: async () => 'bundle',
        openSession: async () => ({ sessionId: 's' }),
        sendTask: async () => {
          throw new Error('an empty mailbox must never reach the session');
        },
        runHelper: async (name) => {
          if (name === 'ready_for_next') {
            readyCalls++;
            return { exitCode: 0, stdout: readyStdoutFor(state) };
          }
          throw new Error('an empty mailbox must never forward');
        },
        writeFile: () => {},
        now: () => 'STAMP',
      };
      const result = await runSeatOnce(deps, {
        repoRoot: REPO_ROOT,
        role,
        identity: { provider: 'cursor', model: 'composer-1' },
        env: {},
      });
      assert.equal(result.outcome, 'no_task');
      assert.equal(readyCalls, 1);
      assert.equal(result.readyForNextCalls, 1);
      return true;
    }),
    { numRuns: RUNS }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 2 — decisions come from structured signals, never rendered text.
// ──────────────────────────────────────────────────────────────────────────

// What a naive pane scraper would see. Deliberately written the way such an
// implementation would be: the words, with the structure thrown away.
function paneTextOf(signal) {
  if (signal.kind === 'stop_reason') return signal.value;
  if (signal.kind === 'tool_event') return `${signal.tool} ${signal.permission}`;
  return `${signal.helper} ${signal.exitCode}`;
}

const structuredSignal = fc.oneof(
  fc.record({
    kind: fc.constant('stop_reason'),
    value: fc.constantFrom('completed', 'refused', 'error'),
  }),
  fc.record({
    kind: fc.constant('tool_event'),
    tool: fc.constantFrom('shell', 'edit', 'read', 'completed', 'granted'),
    permission: fc.constantFrom('granted', 'denied'),
  }),
  fc.record({
    kind: fc.constant('helper_exit'),
    helper: fc.constantFrom('ready_for_next', 'swarm_handoff'),
    exitCode: fc.integer({ min: 0, max: 5 }),
  })
);

test('invariant 2: a decision is a pure function of the signal, and names that signal', () => {
  fc.assert(
    fc.property(structuredSignal, (signal) => {
      const first = decideNextStep(signal);
      const second = decideNextStep(JSON.parse(JSON.stringify(signal)));
      assert.deepEqual(first, second, 'the same signal must always decide the same way');
      assert.match(first.fromSignal, /^(stop_reason|tool_event|helper_exit):/);
      assert.ok(first.fromSignal.startsWith(`${signal.kind}:`), 'the decision must name the signal kind it read');
      assert.ok(['forward_handoff', 'continue_session', 'await_wake', 'abort'].includes(first.step));
      return true;
    }),
    { numRuns: RUNS }
  );
});

test('invariant 2 (collision by construction): signals a pane scraper renders alike decide differently', () => {
  let collisions = 0;
  fc.assert(
    fc.property(fc.constantFrom('completed', 'refused', 'error'), (stopValue) => {
      const stop = { kind: 'stop_reason', value: stopValue };
      // Derived from the first side by the transformation a text scraper
      // conflates: the stop reason's OWN WORD becomes the tool's name, so the
      // rendered text of the pair overlaps by construction.
      const tool = { kind: 'tool_event', tool: stopValue, permission: 'denied' };
      assert.ok(paneTextOf(tool).includes(paneTextOf(stop)), 'the pair must actually collide in rendered text');
      collisions++;

      const stopDecision = decideNextStep(stop);
      const toolDecision = decideNextStep(tool);
      assert.notEqual(
        stopDecision.fromSignal,
        toolDecision.fromSignal,
        'two structurally different signals must never be read as the same one'
      );
      if (stopValue === 'completed') {
        // The case that matters: the word "completed" appears in both, but only
        // the STOP REASON may forward a parcel.
        assert.equal(stopDecision.step, 'forward_handoff');
        assert.equal(toolDecision.step, 'abort');
      }
      return true;
    }),
    { numRuns: RUNS }
  );
  assert.ok(collisions >= 100, `collision pairs too rare: ${collisions}`);
});

test('invariant 2: a signal that is not structured decides nothing but abort', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (kind, text) => {
      fc.pre(!['stop_reason', 'tool_event', 'helper_exit'].includes(kind));
      const decision = decideNextStep({ kind, text });
      assert.equal(decision.step, 'abort', 'unstructured input must never produce a forward');
      return true;
    }),
    { numRuns: RUNS }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 3 — certification gates a production pack.
// ──────────────────────────────────────────────────────────────────────────

// Reach (c): the exact escape value alongside NEAR MISSES a naive generator
// would never produce, since only the exact value may admit a spike.
const escapeValue = fc.oneof(
  fc.constant(CURSOR_SEAT_SPIKE_ESCAPE_VALUE),
  fc.constantFrom(undefined, '', '0', 'true', 'TRUE', 'yes', ' 1', '1 ', '01', 'spike')
);

const registryStatus = fc.constantFrom('certified', 'candidate', 'retired', 'unknown', 'CERTIFIED', '', undefined);

test('invariant 3: only a certified identity, or the exact escape, ever admits a seat', () => {
  const reached = { certifiedAdmit: 0, spikeAdmit: 0, refused: 0 };

  fc.assert(
    fc.property(escapeValue, registryStatus, fc.string({ minLength: 1, maxLength: 12 }), (escape, status, model) => {
      const identity = { provider: 'cursor', model };
      const registry = { models: { [`cursor/${model}`]: status === undefined ? {} : { status } } };
      const env = escape === undefined ? {} : { [CURSOR_SEAT_SPIKE_ESCAPE_ENV]: escape };

      const posture = resolvePackPosture(env);
      const readStatus = readIdentityStatus(registry, identity);
      const verdict = admitCursorIdentity({ identity, status: readStatus, posture });

      const escapeIsExact = escape === CURSOR_SEAT_SPIKE_ESCAPE_VALUE;
      assert.equal(posture, escapeIsExact ? 'spike' : 'production');

      // Only the literal "certified" status certifies. "CERTIFIED", "", a
      // missing status field and an unknown word all fail closed.
      const isCertified = status === 'certified';
      assert.equal(readStatus === 'certified', isCertified);

      assert.equal(verdict.admitted, isCertified || escapeIsExact);
      if (!verdict.admitted) {
        assert.equal(posture, 'production', 'a production pack is the only posture that can refuse');
        assert.match(verdict.reason, /not certified/);
        assert.match(verdict.reason, /model steward registry/);
        reached.refused++;
      } else if (isCertified) {
        reached.certifiedAdmit++;
      } else {
        assert.match(verdict.reason, new RegExp(CURSOR_SEAT_SPIKE_ESCAPE_ENV));
        reached.spikeAdmit++;
      }
      return true;
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.certifiedAdmit >= 10, `certified admissions too rare: ${reached.certifiedAdmit}`);
  assert.ok(reached.spikeAdmit >= 10, `spike-escape admissions too rare: ${reached.spikeAdmit}`);
  assert.ok(reached.refused >= 30, `refusals too rare - invariant 3 would be vacuous: ${reached.refused}`);
});

test('invariant 3: a refused run opens no session, calls no helper, and writes nothing', async () => {
  let refusals = 0;
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...PIPELINE_ROLES),
      fc.constantFrom('candidate', 'retired', 'unknown'),
      fc.constantFrom(undefined, '', '0', 'true', ' 1'),
      async (role, status, escape) => {
        const identity = { provider: 'cursor', model: 'auto' };
        const deps = {
          readRegistry: () => ({ models: { 'cursor/auto': { status } } }),
          composePromptBundle: async () => {
            throw new Error('a refused run must not compose a prompt bundle');
          },
          openSession: async () => {
            throw new Error('a refused run must not open a session');
          },
          sendTask: async () => {
            throw new Error('a refused run must not send a task');
          },
          runHelper: async () => {
            throw new Error('a refused run must not call a helper');
          },
          writeFile: () => {
            throw new Error('a refused run must not write anything');
          },
          now: () => 'STAMP',
        };
        const result = await runSeatOnce(deps, {
          repoRoot: REPO_ROOT,
          role,
          identity,
          env: escape === undefined ? {} : { [CURSOR_SEAT_SPIKE_ESCAPE_ENV]: escape },
        });
        assert.equal(result.outcome, 'refused_uncertified');
        assert.equal(result.posture, 'production');
        assert.equal(result.transcriptPath, undefined);
        assert.equal(result.readyForNextCalls, 0);
        refusals++;
        return true;
      }
    ),
    { numRuns: RUNS }
  );
  assert.ok(refusals >= 100, `refusal runs too rare: ${refusals}`);
});
