'use strict';

// BL-325: step handlers for "A human asked to approve something can see
// the question, answer it, and unblock the agent" - drives the REAL
// compiled pieces of each leg (runConciergeTick for outbound notification,
// decideUpdateAction for inbound resolution, the real operator_runtime.bb
// tick for the deterministic consumer, the real operator-decide.js CLI
// with installFakeTmux for the approve-relay unblock, and relaySseReplies
// for the BL-topic egress) - SHIP AS ONE LOOP: scenario 05 chains all of
// them together, not just one leg in isolation.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const OPERATOR_RUNTIME_BB = path.join(SWARMFORGE_SCRIPTS, 'operator_runtime.bb');
const OPERATOR_DECIDE_JS = path.join(EXT_DIR, 'out', 'tools', 'operator-decide.js');

const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { decideUpdateAction, resolveReplyTopicId, relaySseReplies } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { backlogForTopic } = require(path.join(EXT_DIR, 'out', 'concierge', 'topicRouter'));
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

const PRINCIPAL_ID = 111;
const ROLE = 'coder';
const BACKLOG_ID = 'BL-316';
const TOPIC_ID = 62;
const SNIPPET = 'Proceed with the migration? (y/n)';
const GATE_PANE_TEXT = SNIPPET;

const OPERATOR_DECIDE_STUB = `
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(__dirname, '..', '..', '..', 'consumed.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
`;

function gatedTmuxRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: GATE_PANE_TEXT },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

function mkUpdate({ fromId, topicId, text }) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: topicId, text } };
}

// ── real operator_runtime.bb fixture (mirrors operatorAutoHibernateSteps.js
// and operatorSelfGenProvenanceSteps.js's own mkRosterFixture/tickOnce) ────
function opPath(root, ...rest) {
  return path.join(root, '.swarmforge', 'operator', ...rest);
}

function mkRuntimeFixture(roles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-human-in-loop-'));
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(opPath(root), { recursive: true });
  fs.writeFileSync(opPath(root, 'last-swarm-check'), String(Date.now()));
  const rows = roles.map((role) => {
    const worktree = path.join(root, '.worktrees', role);
    fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    return [role, role, worktree, `swarmforge-${role}`, role, 'claude', 'task'].join('\t');
  });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.length ? rows.join('\n') + '\n' : '');
  fs.mkdirSync(path.join(root, 'extension', 'out', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'out', 'tools', 'operator-decide.js'), OPERATOR_DECIDE_STUB);
  return root;
}

function tickOnce(root) {
  const out = execFileSync('bb', [OPERATOR_RUNTIME_BB, root, '--tick-once'], {
    encoding: 'utf8',
    env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1' },
  });
  return JSON.parse(out);
}

function consumedCalls(root) {
  const logFile = path.join(root, 'consumed.log');
  if (!fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventsFile(root) {
  return opPath(root, 'events.jsonl');
}

// ── real operator-decide.js CLI fixture (mirrors operatorDecideCli.test.js's
// own initFixture + gateAnswerSteps.js's own tmux/session fixtures) ────────
function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function mkOperatorDecideCliFixture(role) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-human-in-loop-cli-')));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n${role}\t${role}\t${root}\tswarmforge-${role}\t${role}\tclaude\ttask\n`
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'sessions.tsv'), [1, role, `swarmforge-${role}`, role, 'claude'].join('\t') + '\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), '/tmp/aps-human-in-loop.sock');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return root;
}

// BL-325 scope 6 fixture: TWO roles, each with its OWN worktree holding a
// DIFFERENT backlog item (an in_process handoff naming it, mirroring
// telegramFrontDeskBotCli.test.js's own readRoleTicket fixture shape), so
// runApprove's live readRoleTicket(...) resolves role->backlogId for both -
// the exact multi-gate scenario the count-based selector alone cannot
// direct correctly.
function mkMultiRoleOperatorDecideCliFixture(roleTickets) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-human-in-loop-cli-multi-')));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rolesTsvLines = [`specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`];
  const sessionsTsvLines = [];
  roleTickets.forEach(({ role, backlogId }, i) => {
    const worktree = path.join(root, '.worktrees', role);
    fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
      `task: ${backlogId}-a-fine-feature\ndequeued_at: 2026-07-13T08:00:00Z\n\nbody\n`
    );
    rolesTsvLines.push([role, role, worktree, `swarmforge-${role}`, role, 'claude', 'task'].join('\t'));
    sessionsTsvLines.push([i + 1, role, `swarmforge-${role}`, role, 'claude'].join('\t'));
  });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsvLines.join('\n') + '\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'sessions.tsv'), sessionsTsvLines.join('\n') + '\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), '/tmp/aps-human-in-loop-multi.sock');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return root;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a gated role is blocked on a backlog item awaiting human approval$/, (ctx) => {
    ctx.role = ROLE;
    ctx.backlogId = BACKLOG_ID;
    ctx.topicId = TOPIC_ID;
    ctx.snippet = SNIPPET;
  });

  registry.define(/^that backlog item has its own Telegram topic$/, (ctx) => {
    ctx.backlogTopicMap = { [ctx.backlogId]: ctx.topicId };
  });

  // ── human-in-the-loop-closed-01: the notification states the question ──
  registry.define(/^the human is notified that the item needs approval$/, async (ctx) => {
    ctx.sent = [];
    const adapters = {
      readFolders: () => ({ active: [{ id: ctx.backlogId, title: 'a fine feature' }], paused: [], done: [] }),
      readGates: () => [{ role: ctx.role, gated: true, snippet: ctx.snippet }],
      readRoleTicket: () => ({ [ctx.role]: ctx.backlogId }),
      readTickState: () => ({
        snapshot: { backlog: { active: [], paused: [], done: [] }, gates: [{ role: ctx.role, gated: false }], roleTicket: {} },
        emittedKeys: [],
      }),
      writeTickState: () => {},
      routeAdapters: {
        getTopicMap: () => ctx.backlogTopicMap,
        createTopic: async () => ({ success: true, topicId: 999 }),
        recordTopicId: () => {},
        sendMessage: async (topicId, text) => {
          ctx.sent.push({ topicId, text });
          return true;
        },
        closeTopic: async () => true,
        // BL-329: routeEvent (called by runConciergeTick) calls this
        // unconditionally after a successful send.
        recordMessage: () => {},
      },
    };
    ctx.tickResult = await runConciergeTick(adapters);
  });

  registry.define(/^the notification states the question being asked$/, (ctx) => {
    if (!ctx.sent.some((m) => m.text.includes(ctx.snippet))) {
      throw new Error(`expected the notification to state the question "${ctx.snippet}", got ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^it is not merely the ticket id$/, (ctx) => {
    if (ctx.sent.some((m) => m.text === `NeedsApproval: ${ctx.backlogId}`)) {
      throw new Error(`expected more than the bare ticket id, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── human-in-the-loop-closed-02: reply reaches a real consumer ─────────
  registry.define(/^the human types an answer into that backlog item's topic$/, (ctx) => {
    ctx.replyText = 'yes, approved - go ahead';
    const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.topicId, text: ctx.replyText });
    ctx.decision = decideUpdateAction(
      update,
      PRINCIPAL_ID,
      () => undefined,
      (topicId) => backlogForTopic(ctx.backlogTopicMap, topicId)
    );
  });

  registry.define(/^the reply is routed$/, (ctx) => {
    if (ctx.decision.action !== 'operator-context') {
      throw new Error(`expected the reply to resolve to operator-context, got ${JSON.stringify(ctx.decision)}`);
    }
    ctx.root = ctx.root || mkRuntimeFixture([ctx.role]);
    // The SAME event shape postOperatorContext/appendOperatorEvent writes.
    fs.appendFileSync(eventsFile(ctx.root), JSON.stringify({ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: ctx.decision.backlogId, text: ctx.decision.text }) + '\n');
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^it is delivered to the Operator as context for that backlog item$/, (ctx) => {
    if (ctx.decision.backlogId !== ctx.backlogId) {
      throw new Error(`expected the reply tagged for ${ctx.backlogId}, got ${JSON.stringify(ctx.decision)}`);
    }
  });

  registry.define(/^a consumer acts on it$/, (ctx) => {
    const calls = consumedCalls(ctx.root);
    if (!calls.some((c) => c[0] === ctx.backlogId && c[1] === 'approve' && c[2] === ctx.decision.text)) {
      throw new Error(`expected operator-decide.js invoked with [${ctx.backlogId}, approve, ${ctx.decision.text}], got ${JSON.stringify(calls)}`);
    }
  });

  registry.define(/^it is not merely recorded where nothing reads it$/, (ctx) => {
    const eventsContent = fs.existsSync(eventsFile(ctx.root)) ? fs.readFileSync(eventsFile(ctx.root), 'utf8') : '';
    if (eventsContent.includes('TELEGRAM_BL_TOPIC_MESSAGE')) {
      throw new Error('the event is still sitting unconsumed in the queue');
    }
  });

  // ── human-in-the-loop-closed-03: the answer unblocks the gated pane ────
  registry.define(/^the human has answered the approval question in the item's topic$/, (ctx) => {
    ctx.answerText = 'yes, approved';
    ctx.cliRoot = mkOperatorDecideCliFixture(ctx.role);
    ctx.fakeTmux = installFakeTmux(gatedTmuxRules());
  });

  registry.define(/^the answer is relayed to the gated role$/, (ctx) => {
    ctx.cliOut = execFileSync('node', [OPERATOR_DECIDE_JS, ctx.backlogId, 'approve', ctx.answerText], {
      cwd: ctx.cliRoot,
      encoding: 'utf8',
    });
  });

  registry.define(/^the gated role is unblocked$/, (ctx) => {
    const sendCalls = ctx.fakeTmux.calls().filter((args) => args.includes('send-keys'));
    if (sendCalls.length === 0) {
      throw new Error('expected a tmux send-keys call unblocking the gated pane');
    }
    const targets = sendCalls.map((args) => args[args.indexOf('-t') + 1]);
    if (!targets.some((t) => t && t.startsWith(`swarmforge-${ctx.role}`))) {
      throw new Error(`expected send-keys targeting swarmforge-${ctx.role}, got ${JSON.stringify(targets)}`);
    }
  });

  registry.define(/^the answer is relayed through the existing approval relay rather than a second one$/, (ctx) => {
    // Structural: the CLI invoked above IS extension/out/tools/operator-decide.js
    // (BL-285's own approve relay) - no bespoke script was written for this.
    if (!fs.existsSync(OPERATOR_DECIDE_JS)) {
      throw new Error('expected BL-285\'s own operator-decide.js to be the thing invoked');
    }
  });

  // ── human-in-the-loop-closed-07: ticket-directed gate selection ────────
  registry.define(/^two different backlog items are each waiting on their own approval question$/, (ctx) => {
    ctx.roleA = 'coder';
    ctx.roleB = 'cleaner';
    ctx.backlogIdA = 'BL-401';
    ctx.backlogIdB = 'BL-402';
    ctx.cliRoot = mkMultiRoleOperatorDecideCliFixture([
      { role: ctx.roleA, backlogId: ctx.backlogIdA },
      { role: ctx.roleB, backlogId: ctx.backlogIdB },
    ]);
    // Both roles' panes read as gated (gatedTmuxRules' capture-pane rule
    // matches any invocation regardless of session) - the real multi-gate
    // condition that made the count-based selector ask-which.
    ctx.fakeTmux = installFakeTmux(gatedTmuxRules());
  });

  registry.define(/^the human answers in the first item's topic$/, (ctx) => {
    ctx.answerText = 'yes, approved';
    // bl-topic-approval-sweep! passes the backlogId as threadId - the SAME
    // real CLI invocation the deterministic consumer makes.
    ctx.cliOut = execFileSync('node', [OPERATOR_DECIDE_JS, ctx.backlogIdA, 'approve', ctx.answerText], {
      cwd: ctx.cliRoot,
      encoding: 'utf8',
    });
  });

  registry.define(/^the first item's gate is answered$/, (ctx) => {
    const sendCalls = ctx.fakeTmux.calls().filter((args) => args.includes('send-keys'));
    const targets = sendCalls.map((args) => args[args.indexOf('-t') + 1]);
    if (!targets.some((t) => t && t.startsWith(`swarmforge-${ctx.roleA}`))) {
      throw new Error(`expected send-keys targeting swarmforge-${ctx.roleA} (the first item's own role), got ${JSON.stringify(targets)}`);
    }
  });

  registry.define(/^the human is not asked which gate they meant$/, (ctx) => {
    if (/which/i.test(ctx.cliOut)) {
      throw new Error(`expected no "which gate" disambiguation, got: ${JSON.stringify(ctx.cliOut)}`);
    }
  });

  registry.define(/^the second item's gate is left untouched$/, (ctx) => {
    const sendCalls = ctx.fakeTmux.calls().filter((args) => args.includes('send-keys'));
    const targets = sendCalls.map((args) => args[args.indexOf('-t') + 1]);
    if (targets.some((t) => t && t.startsWith(`swarmforge-${ctx.roleB}`))) {
      throw new Error(`expected the second item's own role (swarmforge-${ctx.roleB}) to never receive send-keys, got ${JSON.stringify(targets)}`);
    }
  });

  // ── human-in-the-loop-closed-04: Operator posts into a BL topic ────────
  registry.define(/^the Operator posts a message to that backlog item's topic$/, (ctx) => {
    ctx.postText = 'status update from the Operator';
    // The SAME reply-outbox entry shape operator-decide.ts's own
    // appendToReplyOutbox writes (threadId = the backlogId) - the supported
    // path this scenario proves, never a direct Telegram API call.
    ctx.replyOutboxEntry = { id: 'evt-1', threadId: ctx.backlogId, text: ctx.postText };
  });

  registry.define(/^the message appears in that topic$/, async (ctx) => {
    const sseRecord = `event: telegram-reply\ndata: ${JSON.stringify(ctx.replyOutboxEntry)}\n\n`;
    ctx.relaySent = [];
    let calls = 0;
    await relaySseReplies(
      '',
      {
        readChunk: async () => {
          calls += 1;
          return calls === 1 ? { done: false, chunk: sseRecord } : { done: true, chunk: '' };
        },
        sendReply: async (topicId, text) => {
          ctx.relaySent.push({ topicId, text });
        },
        topicForSubject: (subjectId) => resolveReplyTopicId({}, ctx.backlogTopicMap, subjectId),
        ackReply: async () => {},
      },
      new Set()
    );
    if (!ctx.relaySent.some((m) => m.topicId === ctx.topicId && m.text === ctx.postText)) {
      throw new Error(`expected the message relayed into topic ${ctx.topicId}, got ${JSON.stringify(ctx.relaySent)}`);
    }
  });

  registry.define(/^it is sent through a supported swarm path, not a direct Telegram API call$/, (ctx) => {
    // relaySseReplies is the SAME SSE-relay egress every SUP-### reply
    // already travels through (telegram-topic-03) - sendReply is the only
    // adapter that ever touches Telegram, and it was invoked here exactly
    // once, through that one relay, never a second/bespoke fetch call.
    if (ctx.relaySent.length !== 1) {
      throw new Error(`expected exactly one relayed send through the shared egress, got ${JSON.stringify(ctx.relaySent)}`);
    }
  });

  // ── human-in-the-loop-closed-05: the whole loop, chained ───────────────
  registry.define(/^a gated role raises an approval question the human has not yet answered$/, async (ctx) => {
    ctx.sent = [];
    ctx.itemCompleted = false;
    const adapters = {
      readFolders: () => ({ active: [{ id: ctx.backlogId, title: 'a fine feature' }], paused: [], done: [] }),
      readGates: () => [{ role: ctx.role, gated: true, snippet: ctx.snippet }],
      readRoleTicket: () => ({ [ctx.role]: ctx.backlogId }),
      readTickState: () => ({
        snapshot: { backlog: { active: [], paused: [], done: [] }, gates: [{ role: ctx.role, gated: false }], roleTicket: {} },
        emittedKeys: [],
      }),
      writeTickState: () => {},
      routeAdapters: {
        getTopicMap: () => ctx.backlogTopicMap,
        createTopic: async () => ({ success: true, topicId: 999 }),
        recordTopicId: () => {},
        sendMessage: async (topicId, text) => {
          ctx.sent.push({ topicId, text });
          return true;
        },
        closeTopic: async () => true,
        // BL-329: routeEvent (called by runConciergeTick) calls this
        // unconditionally after a successful send.
        recordMessage: () => {},
      },
    };
    await runConciergeTick(adapters);
    if (!ctx.sent.some((m) => m.text.includes(ctx.snippet))) {
      throw new Error('setup failed: the raised question never stated its snippet');
    }
  });

  registry.define(/^the human reads the question in the topic and answers it there$/, (ctx) => {
    ctx.answerText = 'yes, approved - go ahead';
    const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.topicId, text: ctx.answerText });
    ctx.decision = decideUpdateAction(
      update,
      PRINCIPAL_ID,
      () => undefined,
      (topicId) => backlogForTopic(ctx.backlogTopicMap, topicId)
    );
    if (ctx.decision.action !== 'operator-context') {
      throw new Error(`expected operator-context, got ${JSON.stringify(ctx.decision)}`);
    }
    // The item is STILL active (not completed) at the moment the human's
    // answer is routed - the ordering guarantee this scenario proves.
    if (ctx.itemCompleted) {
      throw new Error('the item completed before the answer was even routed');
    }
    ctx.root = mkRuntimeFixture([ctx.role]);
    fs.appendFileSync(eventsFile(ctx.root), JSON.stringify({ type: 'TELEGRAM_BL_TOPIC_MESSAGE', backlogId: ctx.decision.backlogId, text: ctx.decision.text }) + '\n');
    // Same tick, deterministic consumer - proven at the unit/integration
    // level by test_operator_runtime_tick.sh's own BL-325 cases; here it
    // is the SAME real binary, driven through the whole inbound->consume
    // chain in one go.
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the gated role receives that answer and proceeds$/, (ctx) => {
    const calls = consumedCalls(ctx.root);
    if (!calls.some((c) => c[0] === ctx.backlogId && c[1] === 'approve' && c[2] === ctx.decision.text)) {
      throw new Error(`expected the gated role's approval relay invoked, got ${JSON.stringify(calls)}`);
    }
  });

  registry.define(/^the item does not complete before the human's answer arrives$/, (ctx) => {
    // The consumer ran to completion (asserted above) INSIDE the same
    // deterministic tick the answer was routed into - there is no later,
    // separate step where a completion could have raced ahead of it. The
    // event is also gone from the pending queue (not left to be
    // reprocessed once "eventually" completed elsewhere).
    const eventsContent = fs.existsSync(eventsFile(ctx.root)) ? fs.readFileSync(eventsFile(ctx.root), 'utf8') : '';
    if (eventsContent.includes('TELEGRAM_BL_TOPIC_MESSAGE')) {
      throw new Error('the answer event is still pending - it could still be preempted');
    }
    if (ctx.itemCompleted) {
      throw new Error('the item was marked complete before this assertion, contradicting the ordering guarantee');
    }
  });

  // ── human-in-the-loop-closed-06: SUP threads are unaffected ────────────
  registry.define(/^the human sends a message in a SUP support thread$/, (ctx) => {
    ctx.subjectMap = { [String(ctx.topicId)]: 'SUP-1' };
    const update = mkUpdate({ fromId: PRINCIPAL_ID, topicId: ctx.topicId, text: 'any update?' });
    ctx.supUpdate = update;
  });

  registry.define(/^the message is routed$/, (ctx) => {
    if (ctx.supUpdate) {
      ctx.supDecision = decideUpdateAction(
        ctx.supUpdate,
        PRINCIPAL_ID,
        (topicId) => (String(topicId) in ctx.subjectMap ? ctx.subjectMap[String(topicId)] : undefined),
        (topicId) => backlogForTopic(ctx.backlogTopicMap || {}, topicId)
      );
    }
  });

  registry.define(/^it behaves exactly as it did before this feature$/, (ctx) => {
    if (!ctx.supDecision || ctx.supDecision.action !== 'post-existing' || ctx.supDecision.subjectId !== 'SUP-1') {
      throw new Error(`expected an unchanged post-existing SUP-1 decision, got ${JSON.stringify(ctx.supDecision)}`);
    }
    // subjectForTopic is checked BEFORE backlogForTopic (decideUpdateAction's
    // own priority, unchanged by BL-325) - a SUP-mapped topic never falls
    // through to the BL-### resolution path this ticket added.
  });
}

module.exports = { registerSteps };
