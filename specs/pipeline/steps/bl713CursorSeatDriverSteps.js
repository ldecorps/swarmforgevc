'use strict';

// BL-713: step handlers for "A Cursor-driven seat holds a real role in the
// pipeline" (slice A of BL-712).
//
// Every step drives the REAL compiled seat driver
// (extension/out/swarm/cursorSeatDriver.js) over a STUBBED agent session -
// the Background's own wording. Nothing here re-implements a decision table,
// a draft format or an admission rule in JS; a handler that did would keep
// passing after the production code it describes was deleted.
//
// The stub records EVERY side effect the driver can perform, because that is
// what makes "it writes nothing directly into another role's inbox" a
// statement about the whole run rather than about the one write this file
// happened to look for.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DRIVER_SOURCE = path.join(REPO_ROOT, 'extension', 'src', 'swarm', 'cursorSeatDriver.ts');
const DRIVER = require(path.join(REPO_ROOT, 'extension', 'out', 'swarm', 'cursorSeatDriver'));

const REPO_FIXTURE = '/repo';
const SPIKE_ENV = { [DRIVER.CURSOR_SEAT_SPIKE_ESCAPE_ENV]: DRIVER.CURSOR_SEAT_SPIKE_ESCAPE_VALUE };

const CERTIFIED_IDENTITY = { provider: 'cursor', model: 'composer-1' };
const UNCERTIFIED_IDENTITY = { provider: 'cursor', model: 'auto' };
const REGISTRY = {
  models: {
    'cursor/composer-1': { status: 'certified' },
    'cursor/auto': { status: 'candidate' },
  },
};

// BL-421 Scenario Outline rule: every Examples: column value is validated
// against an explicit lookup, never passed through - a gherkin-mutator edit
// into an unrecognised value must fail the scenario, not slip into an else
// branch. These are the three structured signal families the driver's own
// SessionSignal union declares.
const KNOWN_SIGNALS = {
  'a stop reason': { kind: 'stop_reason', value: 'completed' },
  'a tool event': { kind: 'tool_event', tool: 'shell', permission: 'granted' },
  'a helper exit status': { kind: 'helper_exit', helper: 'ready_for_next', exitCode: 0 },
};

// What a pane-scraping implementation would consult. Named here so scenario
// 04's second Then is a real check against the driver's own source rather
// than a restatement of its comments.
const PANE_READING_TOKENS = ['capture-pane', 'capturePane', 'tmuxClient', 'capturePaneText', 'pane_current_command'];

const TASK_STDOUT = [
  'TASK: /repo/.worktrees/documenter/.swarmforge/handoffs/inbox/in_process/10_x.handoff',
  'FROM: coordinator',
  'TYPE: git_handoff',
  'PRIORITY: 50',
  'TASK_NAME: bl-713-a-thing',
  'PAYLOAD:',
  'merge_and_process 0123456789',
].join('\n');

// A stubbed agent session that records everything. `writeFile` is redirected
// into `ctx.writes` by default; scenario 07 swaps in a real fixture root so
// "available to the human" means a file that can actually be read back.
function makeStub(ctx, overrides = {}) {
  ctx.writes = [];
  ctx.helpers = [];
  ctx.sessions = [];
  ctx.tasksSent = [];
  return {
    readRegistry: () => REGISTRY,
    composePromptBundle: async (role) => `SYSTEM PROMPT BUNDLE for ${role}`,
    openSession: async (opts) => {
      ctx.sessions.push(opts);
      return { sessionId: 'stub-session' };
    },
    sendTask: async (session, task) => {
      ctx.tasksSent.push(task);
      return {
        signal: ctx.sessionSignal ?? { kind: 'stop_reason', value: 'completed' },
        transcript: ['agent: read the parcel', 'agent: committed the stage work'],
        work: { task: 'bl-713-a-thing', commit: '0123456789' },
      };
    },
    runHelper: async (name, args) => {
      ctx.helpers.push({ name, args });
      if (name === 'ready_for_next') {
        return { exitCode: 0, stdout: ctx.mailboxEmpty ? 'NO_TASK\n' : TASK_STDOUT };
      }
      return { exitCode: 0, stdout: '' };
    },
    writeFile: (filePath, content) => {
      ctx.writes.push({ path: filePath, content });
    },
    now: () => '20260822T235959Z',
    ...overrides,
  };
}

function runOptions(ctx) {
  return {
    repoRoot: REPO_FIXTURE,
    role: ctx.role ?? 'documenter',
    identity: ctx.identity ?? CERTIFIED_IDENTITY,
    env: ctx.env ?? SPIKE_ENV,
  };
}

async function runSeat(ctx, overrides) {
  ctx.outcome = await DRIVER.runSeatOnce(makeStub(ctx, overrides), runOptions(ctx));
  return ctx.outcome;
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^a role seat driven by the Cursor seat driver over a stubbed agent session$/, (ctx) => {
    ctx.role = 'documenter';
    ctx.identity = CERTIFIED_IDENTITY;
    ctx.env = SPIKE_ENV;
    ctx.mailboxEmpty = false;
    assert.equal(typeof DRIVER.runSeatOnce, 'function', 'the compiled seat driver must expose runSeatOnce');
  });

  // ── cursor-seat-01 ──────────────────────────────────────────────────────
  registry.define(/^the seat is started for a role$/, async (ctx) => {
    await runSeat(ctx);
  });

  registry.define(/^the driver opens an agent session carrying that role's prompt bundle$/, (ctx) => {
    assert.equal(ctx.sessions.length, 1, 'exactly one session is opened for the seat');
    assert.equal(
      ctx.sessions[0].promptBundle,
      `SYSTEM PROMPT BUNDLE for ${ctx.role}`,
      "the session must carry the composed bundle for the seat's own role"
    );
    assert.equal(ctx.sessions[0].role, ctx.role);
  });

  registry.define(/^the session is bound to that role's own worktree$/, (ctx) => {
    assert.equal(ctx.sessions[0].cwd, DRIVER.roleWorktreePath(REPO_FIXTURE, ctx.role));
    assert.equal(ctx.sessions[0].cwd, `${REPO_FIXTURE}/.worktrees/${ctx.role}`);
  });

  // ── cursor-seat-02 ──────────────────────────────────────────────────────
  registry.define(/^a parcel is waiting in that role's mailbox$/, (ctx) => {
    ctx.mailboxEmpty = false;
  });

  registry.define(/^the seat receives a wake$/, async (ctx) => {
    await runSeat(ctx);
  });

  registry.define(/^the driver runs the ready-for-next helper$/, (ctx) => {
    assert.equal(ctx.helpers[0].name, 'ready_for_next', 'the wake is answered by ready_for_next, nothing else');
  });

  registry.define(/^the parcel it returns is given to the session as the task$/, (ctx) => {
    assert.equal(ctx.tasksSent.length, 1, 'the parcel reaches the session exactly once');
    assert.equal(ctx.tasksSent[0].taskName, 'bl-713-a-thing');
    assert.match(ctx.tasksSent[0].payload, /merge_and_process 0123456789/);
  });

  // ── cursor-seat-03 ──────────────────────────────────────────────────────
  registry.define(/^the session reports the stage work finished$/, (ctx) => {
    ctx.sessionSignal = { kind: 'stop_reason', value: 'completed' };
  });

  registry.define(/^the driver forwards the parcel$/, async (ctx) => {
    await runSeat(ctx);
    assert.equal(ctx.outcome.outcome, 'forwarded', `expected a forward, got ${ctx.outcome.reason}`);
  });

  registry.define(/^it sends the handoff through the handoff helper$/, (ctx) => {
    const sends = ctx.helpers.filter((call) => call.name === 'swarm_handoff');
    assert.equal(sends.length, 1, 'the parcel leaves through swarm_handoff exactly once');
    const draft = ctx.writes.find((write) => write.path.endsWith(path.join('tmp', 'handoff.txt')));
    assert.ok(draft, 'the draft is written to the seat worktree tmp/handoff.txt');
    assert.deepEqual(sends[0].args, [draft.path], 'the helper is handed the draft the driver just wrote');
    assert.match(draft.content, /^type: git_handoff$/m);
    assert.match(draft.content, /^commit: [0-9a-f]{10}$/m);
  });

  registry.define(/^it writes nothing directly into another role's inbox$/, (ctx) => {
    assert.ok(ctx.writes.length > 0, 'the run must have written something, or this check is vacuous');
    for (const write of ctx.writes) {
      assert.ok(
        !/handoffs?[\\/](inbox|new|in_process)/.test(write.path),
        `the driver wrote into a mailbox directly: ${write.path}`
      );
    }
  });

  // ── cursor-seat-04 ──────────────────────────────────────────────────────
  registry.define(/^the session reports (.+)$/, (ctx, signalLabel) => {
    const label = signalLabel.trim();
    const signal = KNOWN_SIGNALS[label];
    assert.ok(signal, `unknown signal "${label}" - known: ${Object.keys(KNOWN_SIGNALS).join(', ')}`);
    ctx.signalLabel = label;
    ctx.reportedSignal = signal;
    ctx.decision = DRIVER.decideNextStep(signal);
  });

  registry.define(/^the driver takes its next step from that reported signal$/, (ctx) => {
    assert.ok(ctx.decision, 'the driver produced no decision at all');
    assert.ok(
      ['forward_handoff', 'continue_session', 'await_wake', 'abort'].includes(ctx.decision.step),
      `unrecognised step "${ctx.decision.step}"`
    );
    assert.ok(
      ctx.decision.fromSignal.startsWith(`${ctx.reportedSignal.kind}:`),
      `the decision must name the structured signal it read, got "${ctx.decision.fromSignal}"`
    );
    assert.notEqual(
      ctx.decision.fromSignal,
      'unrecognised:none',
      'a declared signal family must never fall through to the unrecognised branch'
    );
  });

  registry.define(/^the driver reads no rendered pane text to make that decision$/, (ctx) => {
    // Behavioural half: the decision is a pure function of the signal, so the
    // same signal decides the same way with nothing else supplied.
    assert.deepEqual(
      DRIVER.decideNextStep(JSON.parse(JSON.stringify(ctx.reportedSignal))),
      ctx.decision,
      'the decision must depend on the signal alone'
    );
    // Static half: the driver has no way to reach pane text in the first place.
    const source = fs.readFileSync(DRIVER_SOURCE, 'utf8');
    for (const token of PANE_READING_TOKENS) {
      assert.ok(!source.includes(token), `the seat driver reaches rendered pane text via "${token}"`);
    }
  });

  // ── cursor-seat-05 ──────────────────────────────────────────────────────
  registry.define(/^that role's mailbox is empty$/, (ctx) => {
    ctx.mailboxEmpty = true;
  });

  registry.define(/^the driver reports no task available$/, (ctx) => {
    assert.equal(ctx.outcome.outcome, 'no_task');
    assert.match(ctx.outcome.reason, /no_task|does not poll/);
  });

  registry.define(/^it does not poll the mailbox again on its own$/, (ctx) => {
    const polls = ctx.helpers.filter((call) => call.name === 'ready_for_next');
    assert.equal(polls.length, 1, `the seat polled ${polls.length} times; a wake is the only trigger`);
    assert.equal(ctx.outcome.readyForNextCalls, 1);
    assert.equal(ctx.tasksSent.length, 0, 'an empty mailbox must never reach the session');
  });

  // ── cursor-seat-06 ──────────────────────────────────────────────────────
  registry.define(/^no spike-only escape is set$/, (ctx) => {
    ctx.env = {};
    assert.equal(DRIVER.resolvePackPosture(ctx.env), 'production');
  });

  registry.define(/^the Cursor identity is not certified in the model steward registry$/, (ctx) => {
    ctx.identity = UNCERTIFIED_IDENTITY;
    assert.notEqual(
      DRIVER.readIdentityStatus(REGISTRY, UNCERTIFIED_IDENTITY),
      'certified',
      'the fixture identity must actually be uncertified, or this scenario proves nothing'
    );
  });

  registry.define(/^the seat is started for a production pack$/, async (ctx) => {
    assert.equal(DRIVER.resolvePackPosture(ctx.env), 'production', 'this scenario needs a production posture');
    await runSeat(ctx);
  });

  registry.define(/^the driver refuses to start$/, (ctx) => {
    assert.equal(ctx.outcome.outcome, 'refused_uncertified');
    assert.deepEqual(ctx.sessions, [], 'a refused seat must never open a session');
    assert.deepEqual(ctx.helpers, [], 'a refused seat must never call a helper');
    assert.deepEqual(ctx.writes, [], 'a refused seat must never write anything');
  });

  registry.define(/^it names certification as the reason$/, (ctx) => {
    assert.match(ctx.outcome.reason, /not certified/);
    assert.match(ctx.outcome.reason, /model steward registry/);
    assert.match(ctx.outcome.reason, /cursor\/auto/);
  });

  // ── cursor-seat-07 ──────────────────────────────────────────────────────
  registry.define(/^the seat completes a parcel$/, async (ctx) => {
    // A REAL fixture root, so "available to the human" means a file that can
    // be opened - not a recorded intention. Created and removed inside this
    // one step (BL-971): a throw before the assertions must not leak it.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl713-cursor-seat-')));
    try {
      const outcome = await DRIVER.runSeatOnce(
        makeStub(ctx, {
          writeFile: (filePath, content) => {
            ctx.writes.push({ path: filePath, content });
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
          },
        }),
        { ...runOptions(ctx), repoRoot: root }
      );
      ctx.outcome = outcome;
      assert.equal(outcome.outcome, 'forwarded', `expected a completed parcel, got ${outcome.reason}`);
      ctx.transcriptExists = fs.existsSync(outcome.transcriptPath);
      ctx.transcriptText = ctx.transcriptExists ? fs.readFileSync(outcome.transcriptPath, 'utf8') : '';
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  registry.define(/^the session transcript is available to the human$/, (ctx) => {
    assert.ok(ctx.outcome.transcriptPath, 'the run must name where its transcript went');
    assert.ok(ctx.transcriptExists, `no transcript was written at ${ctx.outcome.transcriptPath}`);
    assert.match(ctx.transcriptText, /agent: committed the stage work/);
    assert.match(ctx.transcriptText, new RegExp(ctx.role));
    assert.match(ctx.transcriptText, /cursor\/composer-1/);
  });
}

module.exports = { registerSteps };
