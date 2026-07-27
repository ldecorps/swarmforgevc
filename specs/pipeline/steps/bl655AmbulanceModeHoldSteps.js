'use strict';

// BL-655: step handlers for "Ambulance mode holds every parcel except one
// ticket's". Drives the REAL production code at every one of the ticket's
// three required read sites plus its two entry points - never a parallel/
// simplified reimplementation of any decision:
//   - site 1 (delivery):  swarmforge/scripts/handoffd.bb, real subprocess,
//     via its --poll-once flag (one deterministic pass, no real timers -
//     same posture corruptHandoffNeverDispatchedSteps.js already uses for
//     this exact daemon).
//   - site 2 (dequeue):   swarmforge/scripts/ready_for_next_task.bb /
//     ready_for_next_batch.bb, real subprocesses, which call handoff-lib's
//     real resolve-dequeueable-candidates (ambulance_lib.bb's real
//     parcel-held? underneath).
//   - site 3 (rotation):  handoffd.bb again, via a second one-shot flag,
//     --print-preferred-rotate-target, added by this same ticket for
//     exactly this purpose - it prints the REAL preferred-mono-rotate-role
//     (built from the real role-mail-row/ambulance filter), never a hand-
//     built score row in JS (that exact anti-pattern was a real BL-576
//     hardener finding - bypassing role-mail-row let a regression there
//     stay green).
//   - the CLI entry point: swarmforge/scripts/ambulance_cli.bb, real
//     subprocess (engage/release/status).
//   - the Telegram entry point: the REAL compiled telegramFrontDeskBotCore
//     (pollAndForward) and telegram-front-desk-bot.ts's real
//     engageAmbulance/releaseAmbulance effect functions and on-disk marker,
//     mirroring bl423TelegramSwarmControlVerbsSteps.js's own controlAdapters
//     posture exactly (no live Telegram network - only postFn is faked).
//
// No fixture ever hand-computes "is this parcel held" or "which role wins
// the rotate" - every such answer comes from a real `bb` invocation.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const READY_TASK = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const READY_BATCH = path.join(SCRIPTS_DIR, 'ready_for_next_batch.bb');
const AMBULANCE_CLI = path.join(SCRIPTS_DIR, 'ambulance_cli.bb');
const EXT_DIR = path.join(REPO_ROOT, 'extension');

const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const CONTROL_TOPIC_ID = 900;
const PRINCIPAL_ID = 111;
const CHAT_ID = '1';

// Every role Background's "a mailbox for every role" promises, plus its
// receive mode - mirrors swarmforge/PIPELINE.md's own role table.
const ROLES = [
  { role: 'coordinator', worktreeName: 'master', mode: 'task' },
  { role: 'specifier', worktreeName: 'master', mode: 'task' },
  { role: 'coder', worktreeName: 'coder', mode: 'task' },
  { role: 'cleaner', worktreeName: 'cleaner', mode: 'batch' },
  { role: 'architect', worktreeName: 'architect', mode: 'task' },
  { role: 'hardener', worktreeName: 'hardener', mode: 'batch' },
  { role: 'documenter', worktreeName: 'documenter', mode: 'task' },
  { role: 'QA', worktreeName: 'QA', mode: 'task' },
];

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

// ── fixture root: a real git repo (a resolvable commit is needed for
//    dequeue's BL-610 unresolvable-commit guard) with a worktree per
//    non-master role and roles.tsv covering every role ──────────────────
function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl655-ambulance-'));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const commit = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
  mkdirp(path.join(root, '.swarmforge'));
  mkdirp(path.join(root, 'backlog', 'active'));
  const worktreeDirs = {};
  const rolesLines = [];
  for (const { role, worktreeName, mode } of ROLES) {
    const wt = worktreeName === 'master' ? root : path.join(root, '.worktrees', worktreeName);
    if (worktreeName !== 'master') {
      git(root, ['worktree', 'add', '-q', '-b', `wt-${worktreeName}`, wt]);
    }
    worktreeDirs[role] = wt;
    rolesLines.push(`${role}\t${worktreeName}\t${wt}\tswarmforge-${worktreeName}\t${role}\tclaude\t${mode}`);
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesLines.join('\n') + '\n');
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  return { root, commit, worktreeDirs };
}

function roleDir(ctx, role) {
  const canon = role === 'resident' ? 'coder' : role;
  const dir = ctx.worktreeDirs[canon];
  if (!dir) {
    throw new Error(`unknown role "${role}" in this fixture`);
  }
  return dir;
}

function isMaster(role) {
  return role === 'coordinator' || role === 'specifier';
}

function mailboxBase(ctx, role) {
  const dir = roleDir(ctx, role);
  return isMaster(role) ? path.join(dir, '.swarmforge', 'handoffs', role) : path.join(dir, '.swarmforge', 'handoffs');
}

function outboxDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'outbox');
}
function inboxNewDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'new');
}
function inProcessDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'in_process');
}
function failedDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'failed');
}
function abandonedDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'abandoned');
}
function completedDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'completed');
}

// ── writing real handoff files (required envelope headers: from/to/
//    priority/type, plus a non-blank body - handoff-lib/corrupt-handoff?'s
//    own structural floor) ─────────────────────────────────────────────
function renderHeaders(headers) {
  return Object.entries(headers)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

let fileSeq = 0;
function writeHandoff(dir, { from = 'specifier', to, priority = '50', type = 'git_handoff', task, commit, message, createdAt, body }) {
  mkdirp(dir);
  fileSeq += 1;
  const filename = `${priority}_${String(fileSeq).padStart(4, '0')}_from_${from}_to_${to}.handoff`;
  const headers = { from, to, priority, type, task, commit, message, created_at: createdAt || `2026-07-27T00:00:${String(fileSeq).padStart(2, '0')}Z` };
  const content = `${renderHeaders(headers)}\n\n${body || 'payload'}\n`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  return { file, content };
}

function listHandoffFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
}

function readHeader(content, field) {
  const prefix = `${field}: `;
  return content.split('\n\n')[0].split('\n').find((l) => l.startsWith(prefix))?.slice(prefix.length);
}

// ── the marker / ticket YAML / real ambulance_cli.bb ──────────────────────
function markerPath(ctx) {
  return path.join(ctx.root, '.swarmforge', 'operator', 'control-ambulance.json');
}

function writeTicketYaml(ctx, id) {
  mkdirp(path.join(ctx.root, 'backlog', 'active'));
  fs.writeFileSync(path.join(ctx.root, 'backlog', 'active', `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\nstatus: active\n`);
}

function runAmbulanceCli(ctx, args) {
  const result = spawnSync('bb', [AMBULANCE_CLI, ctx.root, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function ambulanceStatus(ctx) {
  const { stdout, status, stderr } = runAmbulanceCli(ctx, ['status']);
  if (status !== 0) {
    throw new Error(`ambulance_cli.bb status failed: ${stderr}`);
  }
  return JSON.parse(stdout);
}

// Both "the ambulance marker names X" and "no ambulance is engaged" are
// used as a GIVEN (setup, in 10 of the 11 scenarios) AND as a THEN
// (assertion, in exactly the one scenario that drives the real Telegram
// engage/release action). ctx.ambulanceActionPerformed - set by the
// Telegram "human sends" step below, right after it exercises the real
// production effect - is what tells the SAME handler which role it is
// playing in the scenario it is currently running: an assertion must
// re-read real state, never re-derive the state it is supposed to verify.
function isVerifyPhase(ctx) {
  return !!ctx.ambulanceActionPerformed;
}

// ── one delivery poll / rotation target (site 1 / site 3, real handoffd.bb) ──
function runPollOnce(ctx) {
  const result = spawnSync('bb', [HANDOFFD, ctx.root, '--poll-once'], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1', SWARMFORGE_MAILBOX_ONLY: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`handoffd.bb --poll-once failed: ${result.stderr}`);
  }
}

function readDaemonLog(ctx) {
  const p = path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function runPreferredRotateTarget(ctx) {
  const result = spawnSync('bb', [HANDOFFD, ctx.root, '--print-preferred-rotate-target'], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`handoffd.bb --print-preferred-rotate-target failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

// ── dequeue (site 2, real ready_for_next_task.bb / ready_for_next_batch.bb) ──
function receiveMode(role) {
  const canon = role === 'resident' ? 'coder' : role;
  return ROLES.find((r) => r.role === canon)?.mode || 'task';
}

function runReadyForNext(ctx, role) {
  const canon = role === 'resident' ? 'coder' : role;
  const script = receiveMode(canon) === 'batch' ? READY_BATCH : READY_TASK;
  const result = spawnSync('bb', [script], {
    cwd: roleDir(ctx, canon),
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: canon },
  });
  return result.stdout + result.stderr;
}

// ── word-number parsing for Gherkin's "two"/"three"/"all three" phrasing ──
const WORD_NUMBERS = { one: 1, two: 2, three: 3 };
function toNumber(word) {
  return WORD_NUMBERS[word] ?? Number(word);
}

// ── mentions -> fixture text (ambulance-hold-03) ───────────────────────────
function mentionsToBody(mentions) {
  if (mentions === 'no ticket id') {
    return 'a steering note with no ticket id at all';
  }
  return `cites ${mentions}`;
}

// ── marker-label -> fixture setup (ambulance-hold-08) ──────────────────────
function applyMarkerLabel(ctx, label) {
  const p = markerPath(ctx);
  mkdirp(path.dirname(p));
  switch (label) {
    case 'absent':
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    case 'an empty file':
      fs.writeFileSync(p, '');
      return;
    case 'unparseable JSON':
      fs.writeFileSync(p, 'not json{{{');
      return;
    case 'JSON carrying no ticket id':
      fs.writeFileSync(p, JSON.stringify({ active: true }));
      return;
    case 'naming a ticket with no file':
      fs.writeFileSync(p, JSON.stringify({ active: true, ticket: 'BL-9999999' }));
      return;
    default:
      throw new Error(`unrecognized ambulance marker label: "${label}"`);
  }
}

// ── snapshot every mailbox (ambulance-hold-09) ─────────────────────────────
function snapshotAllQueues(ctx) {
  const snap = {};
  for (const { role } of ROLES) {
    for (const [kind, dirFn] of [
      ['outbox', outboxDir],
      ['new', inboxNewDir],
      ['in_process', inProcessDir],
    ]) {
      const dir = dirFn(ctx, role);
      const key = `${role}:${kind}`;
      snap[key] = listHandoffFiles(dir)
        .sort()
        .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return snap;
}

function assertSnapshotsEqual(before, after) {
  const beforeStr = JSON.stringify(before);
  const afterStr = JSON.stringify(after);
  if (beforeStr !== afterStr) {
    throw new Error(`queue snapshot changed:\n before: ${beforeStr}\n after:  ${afterStr}`);
  }
}

// ── Telegram control adapters (mirrors bl423TelegramSwarmControlVerbsSteps.js) ──
function controlAdapters(ctx) {
  return {
    chatId: CHAT_ID,
    controlTopicId: async () => CONTROL_TOPIC_ID,
    getPendingControlConfirm: async () => undefined,
    setPendingControlConfirm: async () => {},
    getPauseState: async () => ({ active: false }),
    postControlStopModesMenu: async () => {},
    postControlRestartConfirm: async () => {},
    postControlCancelled: async () => {},
    postControlPauseMenu: async () => {},
    executeEmergencyStop: async () => {},
    executeDrainStop: async () => {},
    executeRestart: async () => {},
    applyPause: async () => {},
    resumeNow: async () => {},
    engageAmbulance: async (ticket) => {
      const controlModule = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
      await controlModule.engageAmbulance(ctx.root, 'fake-token', CHAT_ID, CONTROL_TOPIC_ID, ticket, ctx.postFn);
    },
    releaseAmbulance: async () => {
      const controlModule = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
      await controlModule.releaseAmbulance(ctx.root, 'fake-token', CHAT_ID, CONTROL_TOPIC_ID, ctx.postFn);
    },
    answerCallbackQuery: async () => {},
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postToBridge: async () => {
      throw new Error('postToBridge must never be called for a Control-topic event');
    },
    openSubjectAndRecord: async () => 'SUP-999',
    postOperatorContext: async () => {
      throw new Error('postOperatorContext must never be called for a Control-topic event');
    },
  };
}

function mkTextUpdate({ fromId, topicId, text }) {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: CHAT_ID }, from: { id: fromId }, message_thread_id: topicId, text },
  };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a running mono-router swarm with a mailbox for every role$/, (ctx) => {
    const { root, commit, worktreeDirs } = mkFixtureRoot();
    ctx.root = root;
    ctx.commit = commit;
    ctx.worktreeDirs = worktreeDirs;
    ctx.parcels = {}; // ticket -> {file, content, dir}
    ctx.postCalls = [];
    ctx.postFn = async (url, body) => {
      ctx.postCalls.push({ url, body: JSON.parse(body) });
      return { success: true, body: { ok: true, result: { message_id: 1 } } };
    };
  });

  // ── the ambulance marker (dual GIVEN/THEN role - see isVerifyPhase) ─────
  registry.define(/^the ambulance marker names (BL-\d+)$/, (ctx, ticket) => {
    if (isVerifyPhase(ctx)) {
      const state = ambulanceStatus(ctx);
      if (!(state.active && state.ticket === ticket)) {
        throw new Error(`expected the ambulance marker to name ${ticket}, got: ${JSON.stringify(state)}`);
      }
      return;
    }
    writeTicketYaml(ctx, ticket);
    const { status, stderr } = runAmbulanceCli(ctx, ['engage', ticket]);
    if (status !== 0) {
      throw new Error(`ambulance_cli.bb engage ${ticket} failed: ${stderr}`);
    }
    ctx.ambulanceTicket = ticket;
  });

  registry.define(/^no ambulance is engaged$/, (ctx) => {
    if (isVerifyPhase(ctx)) {
      const state = ambulanceStatus(ctx);
      if (state.active) {
        throw new Error(`expected no ambulance engaged, got: ${JSON.stringify(state)}`);
      }
      return;
    }
    const { status, stderr } = runAmbulanceCli(ctx, ['release']);
    if (status !== 0) {
      throw new Error(`ambulance_cli.bb release failed: ${stderr}`);
    }
  });

  registry.define(/^the ambulance marker is (.+)$/, (ctx, label) => {
    applyMarkerLabel(ctx, label);
  });

  // ── parcels queued in an outbox / inbox ─────────────────────────────────
  registry.define(/^a git_handoff for task (BL-\d+) is queued in the (\w+) outbox$/, (ctx, ticket, role) => {
    const { file, content } = writeHandoff(outboxDir(ctx, role), { to: 'cleaner', task: ticket, commit: ctx.commit });
    ctx.parcels[ticket] = { file, content, role };
  });

  registry.define(/^a git_handoff for task (BL-\d+) is queued in the (\w+) inbox$/, (ctx, ticket, role) => {
    const { file, content } = writeHandoff(inboxNewDir(ctx, role), { to: role, task: ticket, commit: ctx.commit });
    ctx.parcels[ticket] = { file, content, role };
  });

  registry.define(/^a newer git_handoff for task (BL-\d+) is queued in the (\w+) inbox$/, (ctx, ticket, role) => {
    const { file, content } = writeHandoff(inboxNewDir(ctx, role), {
      to: role,
      task: ticket,
      commit: ctx.commit,
      createdAt: '2026-07-27T00:01:00Z', // strictly after the fixed 00:00:0N stamps every other write above uses
    });
    ctx.parcels[ticket] = { file, content, role };
  });

  registry.define(/^three git_handoffs for task (BL-\d+) have been held across two delivery polls$/, (ctx, ticket) => {
    ctx.heldTrio = [];
    for (let i = 0; i < 3; i += 1) {
      const { file, content } = writeHandoff(outboxDir(ctx, 'coder'), { to: 'cleaner', task: ticket, commit: ctx.commit, body: `payload-${i}` });
      ctx.heldTrio.push({ file, content });
    }
    ctx.heldTicket = ticket;
    // "across two delivery polls": actually poll twice while the ambulance
    // is still active, proving the hold survives repetition, not just a
    // single check.
    for (let i = 0; i < 2; i += 1) {
      runPollOnce(ctx);
      for (const { file, content } of ctx.heldTrio) {
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
          throw new Error(`parcel ${file} was not held byte-identical across delivery poll ${i + 1}`);
        }
      }
    }
  });

  registry.define(/^a parcel whose text mentions (.+) is queued in the coder outbox$/, (ctx, mentions) => {
    const { file, content } = writeHandoff(outboxDir(ctx, 'coder'), { to: 'cleaner', type: 'note', message: '', body: mentionsToBody(mentions) });
    ctx.mentionParcel = { file, content };
  });

  registry.define(/^the resident holds the parcel for (BL-\d+)$/, (ctx, ticket) => {
    writeTicketYaml(ctx, ticket);
    const { file, content } = writeHandoff(inProcessDir(ctx, 'coder'), { to: 'coder', task: ticket, commit: ctx.commit });
    ctx.residentClaim = { file, content, ticket };
  });

  registry.define(/^a priority 00 note naming (BL-\d+) is queued for the resident's own role$/, (ctx, ticket) => {
    const { file, content } = writeHandoff(outboxDir(ctx, 'hardener'), { from: 'hardener', to: 'coder', priority: '00', type: 'note', message: `bounce touching ${ticket}`, body: 'see message' });
    ctx.parcels[ticket] = { file, content, role: 'coder' };
  });

  registry.define(/^two git_handoffs for task (BL-\d+) and three for task (BL-\d+) are queued for a batch role$/, (ctx, ticketA, ticketB) => {
    ctx.batchTrioA = [];
    ctx.batchTrioB = [];
    for (let i = 0; i < 2; i += 1) {
      const { file, content } = writeHandoff(outboxDir(ctx, 'architect'), { from: 'architect', to: 'hardener', task: ticketA, commit: ctx.commit, body: `a-${i}` });
      ctx.batchTrioA.push({ file, content });
    }
    for (let i = 0; i < 3; i += 1) {
      const { file, content } = writeHandoff(outboxDir(ctx, 'architect'), { from: 'architect', to: 'hardener', task: ticketB, commit: ctx.commit, body: `b-${i}` });
      ctx.batchTrioB.push({ file, content });
    }
    ctx.batchTicketA = ticketA;
    ctx.batchTicketB = ticketB;
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the handoff daemon runs one delivery poll$/, (ctx) => {
    runPollOnce(ctx);
  });

  registry.define(/^the ambulance is released$/, (ctx) => {
    const { status, stderr } = runAmbulanceCli(ctx, ['release']);
    if (status !== 0) {
      throw new Error(`ambulance_cli.bb release failed: ${stderr}`);
    }
  });

  registry.define(/^the resident rotation target is chosen$/, (ctx) => {
    ctx.rotateTarget = runPreferredRotateTarget(ctx);
  });

  registry.define(/^the (\w+) asks for its next task$/, (ctx, role) => {
    ctx.readyOutput = runReadyForNext(ctx, role);
  });

  registry.define(/^the ambulance command (.+) is run twice in a row$/, (ctx, command) => {
    ctx.beforeSnapshot = snapshotAllQueues(ctx);
    const args = command.split(/\s+/);
    const first = runAmbulanceCli(ctx, args);
    ctx.firstMarkerContent = fs.readFileSync(markerPath(ctx), 'utf8');
    const second = runAmbulanceCli(ctx, args);
    ctx.secondRun = second;
    ctx.secondMarkerContent = fs.existsSync(markerPath(ctx)) ? fs.readFileSync(markerPath(ctx), 'utf8') : undefined;
    if (first.status !== 0) {
      throw new Error(`first "${command}" run failed: ${first.stderr}`);
    }
  });

  registry.define(/^a ticket (BL-\d+) exists$/, (ctx, ticket) => {
    writeTicketYaml(ctx, ticket);
  });

  registry.define(/^the human sends "([^"]+)" in the Control topic$/, async (ctx, text) => {
    // Deliberately does NOT pre-file whatever ticket id the text mentions -
    // the ambulance-hold-12 negative scenario relies on the real
    // engageAmbulance effect (extension/src/tools/telegram-front-desk-bot.ts)
    // refusing a ticket with no backlog file itself, the same guard
    // ambulance_cli.bb's engage-cmd! already enforces on its own entry
    // point. A scenario that needs the ticket to exist says so explicitly
    // via "a ticket BL-... exists".
    const adapters = controlAdapters(ctx);
    adapters.getUpdates = async () => ({ success: true, updates: [mkTextUpdate({ fromId: PRINCIPAL_ID, topicId: CONTROL_TOPIC_ID, text })] });
    await pollAndForward(0, PRINCIPAL_ID, adapters);
    ctx.ambulanceActionPerformed = true;
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^the parcel for (BL-\d+) has been delivered$/, (ctx, ticket) => {
    const parcel = ctx.parcels[ticket];
    if (!parcel) {
      throw new Error(`no tracked parcel for ${ticket}`);
    }
    const recipient = readHeader(parcel.content, 'to');
    const files = listHandoffFiles(inboxNewDir(ctx, recipient));
    const match = files.some((f) => readHeader(fs.readFileSync(path.join(inboxNewDir(ctx, recipient), f), 'utf8'), 'task') === ticket);
    if (!match) {
      throw new Error(`expected ${ticket}'s parcel delivered into ${recipient}'s inbox/new/; found: ${JSON.stringify(files)}`);
    }
    if (fs.existsSync(parcel.file)) {
      throw new Error(`expected ${ticket}'s parcel to have left its outbox/inbox origin at ${parcel.file}`);
    }
  });

  registry.define(/^the parcel for (BL-\d+) is still queued unmodified$/, (ctx, ticket) => {
    const parcel = ctx.parcels[ticket];
    if (!parcel) {
      throw new Error(`no tracked parcel for ${ticket}`);
    }
    if (!fs.existsSync(parcel.file)) {
      throw new Error(`expected ${ticket}'s parcel still at ${parcel.file}, but it is gone`);
    }
    const now = fs.readFileSync(parcel.file, 'utf8');
    if (now !== parcel.content) {
      throw new Error(`expected ${ticket}'s parcel byte-identical; before:\n${parcel.content}\nafter:\n${now}`);
    }
  });

  registry.define(/^the parcel for (BL-\d+) has never been claimed$/, (ctx, ticket) => {
    for (const { role } of ROLES) {
      const files = listHandoffFiles(inProcessDir(ctx, role));
      for (const f of files) {
        const content = fs.readFileSync(path.join(inProcessDir(ctx, role), f), 'utf8');
        if (readHeader(content, 'task') === ticket || (readHeader(content, 'message') || '').includes(ticket)) {
          throw new Error(`expected ${ticket} never claimed, but found it in_process for ${role}: ${f}`);
        }
      }
    }
  });

  registry.define(/^no parcel has been moved to failed, abandoned or completed$/, (ctx) => {
    for (const { role } of ROLES) {
      for (const dirFn of [failedDir, abandonedDir, completedDir]) {
        const files = listHandoffFiles(dirFn(ctx, role));
        if (files.length) {
          throw new Error(`expected no parcel in ${dirFn(ctx, role)}, found: ${JSON.stringify(files)}`);
        }
      }
    }
  });

  registry.define(/^that parcel is (delivered|held)$/, (ctx, outcome) => {
    const { file, content } = ctx.mentionParcel;
    const recipient = readHeader(content, 'to');
    const stillAtSource = fs.existsSync(file);
    if (outcome === 'held') {
      if (!stillAtSource) {
        throw new Error('expected the parcel to remain held in its outbox, but it left');
      }
    } else {
      if (stillAtSource) {
        throw new Error('expected the parcel delivered (left its outbox), but it is still there');
      }
      const files = listHandoffFiles(inboxNewDir(ctx, recipient));
      if (!files.length) {
        throw new Error(`expected a delivered copy in ${recipient}'s inbox/new/, found none`);
      }
    }
  });

  registry.define(/^no task is claimed$/, (ctx) => {
    if (/^TASK:/m.test(ctx.readyOutput) || /^BATCH:/m.test(ctx.readyOutput)) {
      throw new Error(`expected no task claimed, got: ${ctx.readyOutput}`);
    }
  });

  registry.define(/^the resident rotates to (\w+)$/, (ctx, role) => {
    if (ctx.rotateTarget !== role) {
      throw new Error(`expected rotation target "${role}", got "${ctx.rotateTarget}"`);
    }
  });

  registry.define(/^the resident's claim is unchanged$/, (ctx) => {
    if (!ctx.readyOutput.includes(`TASK_NAME: ${ctx.residentClaim.ticket}`)) {
      throw new Error(`expected the resident's claim to still name ${ctx.residentClaim.ticket}, got: ${ctx.readyOutput}`);
    }
    if (fs.readFileSync(ctx.residentClaim.file, 'utf8') !== ctx.residentClaim.content) {
      throw new Error('expected the in-process claim file itself untouched');
    }
  });

  registry.define(/^all (\w+) parcels for (BL-\d+) have been delivered$/, (ctx, countWord, ticket) => {
    const n = toNumber(countWord);
    const recipient = ticket === ctx.heldTicket ? 'cleaner' : readHeader(ctx.heldTrio[0].content, 'to');
    const files = listHandoffFiles(inboxNewDir(ctx, recipient)).filter((f) => readHeader(fs.readFileSync(path.join(inboxNewDir(ctx, recipient), f), 'utf8'), 'task') === ticket);
    if (files.length !== n) {
      throw new Error(`expected ${n} delivered parcels for ${ticket}, found ${files.length}: ${JSON.stringify(files)}`);
    }
    ctx.deliveredTrioFiles = files.map((f) => path.join(inboxNewDir(ctx, recipient), f));
  });

  registry.define(/^each delivered parcel is byte-identical to the parcel that was held$/, (ctx) => {
    // "Byte-identical" is about the parcel's OWN content surviving the hold
    // untouched (already proven while it sat held, in the "held across two
    // delivery polls" step above, and again here by diffing against what
    // was captured then) - delivery itself legitimately stamps two NEW
    // envelope fields on top (recipient, enqueued_at; add-delivery-headers)
    // and render-message re-orders headers by its own preferred-key list,
    // neither of which existed on - or can be predicted from - the queued
    // copy. Comparing every OTHER header plus the body, order-independently,
    // is the honest form of this claim.
    const normalize = (content) => {
      const [header, ...bodyParts] = content.split('\n\n');
      const lines = header
        .split('\n')
        .filter((l) => !l.startsWith('recipient:') && !l.startsWith('enqueued_at:'))
        .sort();
      return JSON.stringify({ lines, body: bodyParts.join('\n\n') });
    };
    const deliveredNorm = ctx.deliveredTrioFiles.map((f) => normalize(fs.readFileSync(f, 'utf8'))).sort();
    const heldNorm = ctx.heldTrio.map(({ content }) => normalize(content)).sort();
    if (JSON.stringify(deliveredNorm) !== JSON.stringify(heldNorm)) {
      throw new Error(`delivered content diverged from what was held:\n delivered: ${JSON.stringify(deliveredNorm)}\n held:      ${JSON.stringify(heldNorm)}`);
    }
  });

  registry.define(/^the delivered set matches what the same fixture delivers with no ambulance engaged$/, (ctx) => {
    const control = mkFixtureRoot();
    const controlCtx = { root: control.root, commit: control.commit, worktreeDirs: control.worktreeDirs };
    for (let i = 0; i < 3; i += 1) {
      writeHandoff(outboxDir(controlCtx, 'coder'), { to: 'cleaner', task: ctx.heldTicket, commit: controlCtx.commit, body: `payload-${i}` });
    }
    runPollOnce(controlCtx);
    const controlDelivered = listHandoffFiles(inboxNewDir(controlCtx, 'cleaner')).length;
    if (controlDelivered !== ctx.deliveredTrioFiles.length) {
      throw new Error(`expected the no-ambulance control fixture to deliver the same ${ctx.deliveredTrioFiles.length} parcels, got ${controlDelivered}`);
    }
  });

  registry.define(/^only the (\w+) parcels for (BL-\d+) have been delivered$/, (ctx, countWord, ticket) => {
    const n = toNumber(countWord);
    const files = listHandoffFiles(inboxNewDir(ctx, 'hardener')).filter((f) => readHeader(fs.readFileSync(path.join(inboxNewDir(ctx, 'hardener'), f), 'utf8'), 'task') === ticket);
    if (files.length !== n) {
      throw new Error(`expected ${n} delivered parcels for ${ticket} in hardener's inbox, found ${files.length}`);
    }
  });

  registry.define(/^the (\w+) parcels for (BL-\d+) are still queued unmodified$/, (ctx, countWord, ticket) => {
    const n = toNumber(countWord);
    const trio = ticket === ctx.batchTicketA ? ctx.batchTrioA : ctx.batchTrioB;
    if (trio.length !== n) {
      throw new Error(`fixture/assertion mismatch: expected ${n} tracked parcels for ${ticket}, fixture tracked ${trio.length}`);
    }
    for (const { file, content } of trio) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
        throw new Error(`expected ${ticket}'s parcel still queued unmodified at ${file}`);
      }
    }
  });

  registry.define(/^the daemon log records that ambulance mode is not engaged$/, (ctx) => {
    if (!readDaemonLog(ctx).includes('ambulance-inactive')) {
      throw new Error(`expected the daemon log to record ambulance mode inactive; log:\n${readDaemonLog(ctx)}`);
    }
  });

  registry.define(/^the second run reports success and changes nothing$/, (ctx) => {
    if (ctx.secondRun.status !== 0) {
      throw new Error(`second run did not report success: ${ctx.secondRun.stderr}`);
    }
    if (ctx.secondMarkerContent !== ctx.firstMarkerContent) {
      throw new Error(`marker changed on the second run:\n first:  ${ctx.firstMarkerContent}\n second: ${ctx.secondMarkerContent}`);
    }
  });

  registry.define(/^every queue holds exactly the parcels it held before the first run$/, (ctx) => {
    assertSnapshotsEqual(ctx.beforeSnapshot, snapshotAllQueues(ctx));
  });

  registry.define(/^the Control topic is told the ambulance is engaged for (BL-\d+)$/, (ctx, ticket) => {
    const texts = ctx.postCalls.map((c) => c.body.text);
    if (!texts.some((t) => t && t.includes(`Ambulance engaged for ${ticket}`))) {
      throw new Error(`expected a Control-topic message announcing ambulance engagement for ${ticket}; got: ${JSON.stringify(texts)}`);
    }
  });

  registry.define(/^the Control topic is told the ambulance is released$/, (ctx) => {
    const texts = ctx.postCalls.map((c) => c.body.text);
    if (!texts.some((t) => t && t.includes('Ambulance released'))) {
      throw new Error(`expected a Control-topic message announcing ambulance release; got: ${JSON.stringify(texts)}`);
    }
  });

  registry.define(/^the Control topic is told the engage was refused for (BL-\d+)$/, (ctx, ticket) => {
    const texts = ctx.postCalls.map((c) => c.body.text);
    if (!texts.some((t) => t && /refused/i.test(t) && t.includes(ticket))) {
      throw new Error(`expected a Control-topic message refusing the engage for ${ticket}; got: ${JSON.stringify(texts)}`);
    }
  });
}

module.exports = { registerSteps };
