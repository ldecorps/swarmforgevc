'use strict';

// BL-283: step handlers for "Operator hands an actionable thread to the
// coordinator and tracks the ticket back". Drives the REAL support_thread.bb
// (open/link), the REAL operator_handoff.bb (intake + coordinator note,
// shelling to the REAL swarm_handoff.bb - mirrors test_dispatch_gap_autoroute.sh's
// own git+roles.tsv fixture and SWARMFORGE_SKIP_SYNC_INJECT=1 convention),
// and the REAL support_lib.bb check-linked-ticket-status! via
// linked_ticket_status_acceptance_runner.bb (mirrors idle_nudge_acceptance_runner.bb's
// own pattern) - no live swarm, no real Telegram, no real timers (a fixed
// injected clock inside the runner).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SUPPORT_THREAD_CLI = path.join(SCRIPTS_DIR, 'support_thread.bb');
const OPERATOR_HANDOFF_CLI = path.join(SCRIPTS_DIR, 'operator_handoff.bb');
const STATUS_RUNNER = path.join(SCRIPTS_DIR, 'test', 'linked_ticket_status_acceptance_runner.bb');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-coordinator-handoff-')));
}

function initGitFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return root;
}

function openThread(root, text) {
  const out = execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'open', '--channel', 'telegram', '--text', text], { encoding: 'utf8' });
  return JSON.parse(out);
}

function handOff(root, threadId, ticketId) {
  const out = execFileSync('bb', [OPERATOR_HANDOFF_CLI, root, '--thread', threadId, '--ticket', ticketId], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_SKIP_SYNC_INJECT: '1' },
  });
  return JSON.parse(out);
}

function writeTicket(root, folder, id, status) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: a thing\nstatus: ${status}\n`);
}

function linkTicket(root, threadId, ticketId) {
  execFileSync('bb', [SUPPORT_THREAD_CLI, root, 'link', '--thread', threadId, '--ticket', ticketId], { encoding: 'utf8' });
}

function checkLinkedStatus(root, threadId, ticketId) {
  const out = execFileSync('bb', [STATUS_RUNNER, root, threadId, ticketId], { encoding: 'utf8' });
  return JSON.parse(out);
}

function readOutboxLines(root) {
  const file = path.join(root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function backlogYamlFiles(root) {
  const dirs = ['active', 'paused', 'done'];
  const files = [];
  for (const dir of dirs) {
    const full = path.join(root, 'backlog', dir);
    if (fs.existsSync(full)) {
      files.push(...fs.readdirSync(full).filter((f) => f.endsWith('.yaml')));
    }
  }
  return files;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator can hand an actionable subject thread to the coordinator$/, () => {
    // Framing only - each scenario's own Given builds its own fixture.
  });

  // ── coordinator-handoff-01/02 ────────────────────────────────────────
  registry.define(/^a subject thread that has become actionable$/, (ctx) => {
    ctx.root = initGitFixture();
    ctx.thread = openThread(ctx.root, 'we should build a thing for this');
    ctx.ticketId = 'BL-500';
    ctx.backlogFilesBefore = backlogYamlFiles(ctx.root);
  });

  registry.define(/^the Operator hands it off$/, (ctx) => {
    ctx.result = handOff(ctx.root, ctx.thread.id, ctx.ticketId);
  });

  // ── coordinator-handoff-01 ───────────────────────────────────────────
  registry.define(/^it files an intake to the coordinator referencing the subject$/, (ctx) => {
    const intakeFile = path.join(ctx.root, '.swarmforge', 'operator', `INTAKE-${ctx.thread.id.toLowerCase()}.md`);
    if (!fs.existsSync(intakeFile)) {
      throw new Error(`expected an intake file at ${intakeFile}`);
    }
    if (!fs.readFileSync(intakeFile, 'utf8').includes(ctx.thread.id)) {
      throw new Error('expected the intake file to reference the subject thread id');
    }
    const outboxDir = path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
    const queued = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).filter((f) => f.endsWith('.handoff')) : [];
    if (queued.length !== 1) {
      throw new Error(`expected exactly one coordinator note queued, got: ${JSON.stringify(queued)}`);
    }
    const noteContent = fs.readFileSync(path.join(outboxDir, queued[0]), 'utf8');
    if (!noteContent.includes(ctx.thread.id)) {
      throw new Error(`expected the coordinator note to reference the subject thread id, got: ${noteContent}`);
    }
  });

  registry.define(/^the thread records the linked ticket$/, (ctx) => {
    if (!ctx.result['linked-tickets'] || !ctx.result['linked-tickets'].some((l) => l.id === ctx.ticketId)) {
      throw new Error(`expected the thread to record the linked ticket, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── coordinator-handoff-02 ───────────────────────────────────────────
  registry.define(/^it does not create, spec, or promote the ticket itself$/, (ctx) => {
    const after = backlogYamlFiles(ctx.root);
    if (JSON.stringify(after.sort()) !== JSON.stringify(ctx.backlogFilesBefore.sort())) {
      throw new Error(`expected no backlog ticket file to be created/moved by the Operator, before: ${ctx.backlogFilesBefore}, after: ${after}`);
    }
  });

  // ── coordinator-handoff-03/04/05 ─────────────────────────────────────
  registry.define(/^a thread linked to a ticket whose status has moved on$/, (ctx) => {
    ctx.root = initGitFixture();
    ctx.thread = openThread(ctx.root, 'about A');
    ctx.ticketId = 'BL-600';
    linkTicket(ctx.root, ctx.thread.id, ctx.ticketId);
    // "moved on" - the linked-ticket record starts with no last-reported
    // status, and the ticket now sits in backlog/done/.
    writeTicket(ctx.root, 'done', ctx.ticketId, 'done');
  });

  registry.define(/^the Operator checks the linked ticket$/, (ctx) => {
    ctx.checkResult = checkLinkedStatus(ctx.root, ctx.thread.id, ctx.ticketId);
    ctx.posted = readOutboxLines(ctx.root);
  });

  registry.define(/^it posts the new status into that subject's topic$/, (ctx) => {
    const forThread = ctx.posted.filter((p) => p.threadId === ctx.thread.id);
    if (forThread.length !== 1 || !forThread[0].text.includes('done')) {
      throw new Error(`expected a status notice posted into ${ctx.thread.id}'s topic, got: ${JSON.stringify(ctx.posted)}`);
    }
  });

  // ── coordinator-handoff-04 ───────────────────────────────────────────
  registry.define(/^a thread linked to a ticket that is still at the same status$/, (ctx) => {
    ctx.root = initGitFixture();
    ctx.thread = openThread(ctx.root, 'about A');
    ctx.ticketId = 'BL-601';
    linkTicket(ctx.root, ctx.thread.id, ctx.ticketId);
    writeTicket(ctx.root, 'active', ctx.ticketId, 'active');
    // Report it once so the thread's own last-reported-status is "active" -
    // the SAME status the ticket is still at when checked below.
    checkLinkedStatus(ctx.root, ctx.thread.id, ctx.ticketId);
  });

  registry.define(/^it posts no status notice$/, (ctx) => {
    if (ctx.checkResult['posted?'] !== false) {
      throw new Error(`expected no status notice, got: ${JSON.stringify(ctx.checkResult)}`);
    }
  });

  // ── coordinator-handoff-05 ───────────────────────────────────────────
  registry.define(/^two subjects and a ticket linked to only the first$/, (ctx) => {
    ctx.root = initGitFixture();
    ctx.subjectA = openThread(ctx.root, 'about A');
    ctx.subjectB = openThread(ctx.root, 'about B');
    ctx.ticketId = 'BL-602';
    linkTicket(ctx.root, ctx.subjectA.id, ctx.ticketId);
    writeTicket(ctx.root, 'done', ctx.ticketId, 'done');
    // Aliased so the shared "the Operator checks the linked ticket" When
    // step (registered under coordinator-handoff-03) works uniformly here.
    ctx.thread = ctx.subjectA;
  });

  registry.define(/^only the first subject's topic receives the status$/, (ctx) => {
    // subjectB never linked the ticket at all - there is nothing for the
    // sweep to even check on its behalf; asserting subjectA's own topic
    // received it, and the outbox carries no entry for subjectB, proves
    // routing is scoped to the linked subject only.
    const forA = ctx.posted.filter((p) => p.threadId === ctx.subjectA.id);
    const forB = ctx.posted.filter((p) => p.threadId === ctx.subjectB.id);
    if (forA.length !== 1) {
      throw new Error(`expected subject A's topic to receive the status, got: ${JSON.stringify(ctx.posted)}`);
    }
    if (forB.length !== 0) {
      throw new Error(`expected subject B's topic to receive nothing, got: ${JSON.stringify(ctx.posted)}`);
    }
  });
}

module.exports = { registerSteps };
