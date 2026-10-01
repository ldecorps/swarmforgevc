'use strict';

// BL-1847: step handlers for "a deterministic coordinator's mail is
// relayed to the human and completed". Drives the REAL handoffd.bb
// coordinator-mail sweep (`bb handoffd.bb <root> --coordinator-mail-sweep-once`)
// over a disposable fixture root - never a reimplementation of the sweep's
// own file-move/outbox-append logic. Fixture shape is the minimal subset
// bl1846DeterministicCoordinatorPromotesSteps.js's own mkFixtureRoot needs
// for THIS sweep: only the coordinator role (the sweep never reads any
// other role's row), no git repo (the sweep itself never shells to git).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const TICKET_CLOSE_GUARD_CLI = path.join(__dirname, 'lib', 'bl1847TicketCloseGuardCheckCli.bb');

const FEATURE = "BL-1847 a deterministic coordinator's mail is relayed to the human and completed";

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function coordinatorMailboxDir(ctx, state) {
  return path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', state);
}

function writeConf(ctx) {
  const lines = [];
  if (ctx.deterministicMode) {
    lines.push('config coordinator_mode deterministic');
  }
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), `${lines.join('\n')}\n`);
}

let seq = 0;
function writeNote(ctx, { from, message, priority = '00' }) {
  seq += 1;
  const id = `20261001T000000Z_${String(seq).padStart(6, '0')}_from_${from}`;
  const filename = `${priority}_${id}.handoff`;
  const content =
    `id: ${id}\n` +
    `from: ${from}\n` +
    'to: coordinator\n' +
    'recipient: coordinator\n' +
    `priority: ${priority}\n` +
    'type: note\n' +
    `message: ${message}\n` +
    '\n' +
    `${message}\n`;
  fs.writeFileSync(path.join(coordinatorMailboxDir(ctx, 'new'), filename), content);
  return filename;
}

function listMailbox(ctx, state) {
  const dir = coordinatorMailboxDir(ctx, state);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
}

function readMailbox(ctx, state, filename) {
  return fs.readFileSync(path.join(coordinatorMailboxDir(ctx, state), filename), 'utf8');
}

function operatorOutboxTexts(ctx) {
  const p = path.join(ctx.root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line).text;
      } catch (_e) {
        return undefined;
      }
    })
    .filter(Boolean);
}

const SWEEP_ENV_BASE = { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' };

function runSweepOnce(ctx) {
  ctx.sweepResult = spawnSync('bb', [HANDOFFD, ctx.root, '--coordinator-mail-sweep-once'], {
    encoding: 'utf8',
    env: SWEEP_ENV_BASE,
  });
  if (ctx.sweepResult.status !== 0) {
    throw new Error(
      `handoffd.bb --coordinator-mail-sweep-once failed (exit ${ctx.sweepResult.status}): ${ctx.sweepResult.stderr}`
    );
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a scratch project with an empty coordinator mailbox$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1847-coordinator-mail-');
    track(root);
    mkdirp(path.join(root, '.swarmforge'));
    mkdirp(coordinatorMailboxDir({ root }, 'new'));
    mkdirp(coordinatorMailboxDir({ root }, 'completed'));
    mkdirp(coordinatorMailboxDir({ root }, 'in_process'));
    mkdirp(path.join(root, 'swarmforge'));
    mkdirp(path.join(root, 'backlog', 'active'));

    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      `coordinator\tmaster\t${root}\tswarmforge-coordinator\tcoordinator\tclaude\ttask\n`
    );

    const sock = path.join(root, 'fake.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);

    ctx.root = root;
    ctx.deterministicMode = false;
    writeConf(ctx);
  });

  // ── Given ───────────────────────────────────────────────────────────
  scoped(/^the pack declares the deterministic coordinator mode$/, (ctx) => {
    ctx.deterministicMode = true;
    writeConf(ctx);
  });

  scoped(/^the pack declares no coordinator mode$/, (ctx) => {
    ctx.deterministicMode = false;
    writeConf(ctx);
  });

  scoped(/^a note from QA naming a ticket waits in the coordinator's new mail$/, (ctx) => {
    ctx.ticketId = 'BL-9201';
    ctx.noteFilename = writeNote(ctx, { from: 'QA', message: `${ctx.ticketId} approved abcdef1234ab` });
    ctx.noteContentBefore = readMailbox(ctx, 'new', ctx.noteFilename);
    ctx.noteSender = 'QA';
  });

  scoped(/^three notes from three different roles wait in the coordinator's new mail$/, (ctx) => {
    ctx.threeFilenames = [
      writeNote(ctx, { from: 'QA', message: 'BL-9202 approved cdef123456ab' }),
      writeNote(ctx, { from: 'specifier', message: 'BL-9203 ready in paused' }),
      writeNote(ctx, { from: 'coder', message: 'BL-9204 blocked on BL-9100' }),
    ];
  });

  scoped(/^QA's approval note for an active ticket waits in the coordinator's new mail$/, (ctx) => {
    ctx.ticketId = 'BL-9205';
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-fixture.yaml`),
      `id: ${ctx.ticketId}\ntitle: "fixture ticket"\ntype: feature\npriority: 10\nstatus: active\n`
    );
    ctx.noteFilename = writeNote(ctx, { from: 'QA', message: `${ctx.ticketId} landed abcdef1234ab` });
  });

  scoped(/^another parcel already sits in the coordinator's in-process mail$/, (ctx) => {
    // BL-1847's own scope: "inbox/in_process/ is left alone - a parcel a
    // coordinator seat already took ... is that seat's." The sweep only
    // ever lists :new (handoffd.bb's coordinator-mail-sweep!), so this
    // proves the claim rather than assuming it from the code's shape.
    ctx.inProcessFilename = writeNote(ctx, { from: 'specifier', message: 'BL-9206 ready in paused' });
    const from = path.join(coordinatorMailboxDir(ctx, 'new'), ctx.inProcessFilename);
    const to = path.join(coordinatorMailboxDir(ctx, 'in_process'), ctx.inProcessFilename);
    ctx.inProcessContentBefore = fs.readFileSync(from, 'utf8');
    fs.renameSync(from, to);
  });

  scoped(/^the operator outbox path cannot be written$/, (ctx) => {
    // A path seam (engineering.prompt: Test Speed And Isolation forbids
    // chmod for failure simulation), not a permission bit: a DIRECTORY
    // sits where telegram-reply-outbox.jsonl must be written, so `spit`
    // throws a real, ordinary IOException (EISDIR) rather than a
    // fabricated one. .swarmforge/operator/ itself never exists in this
    // fixture yet (no prior step creates it), so this is the first and
    // only writer of that path.
    fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl'), {
      recursive: true,
    });
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^handoffd runs its coordinator-mail sweep once$/, (ctx) => {
    runSweepOnce(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^that note is in the coordinator's completed mail byte for byte$/, (ctx) => {
    const completed = listMailbox(ctx, 'completed');
    if (!completed.includes(ctx.noteFilename)) {
      throw new Error(`expected ${ctx.noteFilename} in completed/; found: ${JSON.stringify(completed)}`);
    }
    const after = readMailbox(ctx, 'completed', ctx.noteFilename);
    if (after !== ctx.noteContentBefore) {
      throw new Error('relayed note content changed - expected byte-identical');
    }
  });

  scoped(/^one operator message names QA, that ticket and the note's first line$/, (ctx) => {
    const texts = operatorOutboxTexts(ctx);
    if (texts.length !== 1) {
      throw new Error(`expected exactly one operator message; found ${texts.length}: ${JSON.stringify(texts)}`);
    }
    const [text] = texts;
    if (!text.includes('QA') || !text.includes(ctx.ticketId) || !text.includes('approved abcdef1234ab')) {
      throw new Error(`expected the message to name QA, ${ctx.ticketId} and the note's first line; got: ${text}`);
    }
  });

  scoped(/^all three notes are in the coordinator's completed mail$/, (ctx) => {
    const completed = listMailbox(ctx, 'completed');
    for (const f of ctx.threeFilenames) {
      if (!completed.includes(f)) {
        throw new Error(`expected ${f} in completed/; found: ${JSON.stringify(completed)}`);
      }
    }
  });

  scoped(/^exactly one operator message lists all three senders$/, (ctx) => {
    const texts = operatorOutboxTexts(ctx);
    if (texts.length !== 1) {
      throw new Error(`expected exactly one operator message; found ${texts.length}: ${JSON.stringify(texts)}`);
    }
    const [text] = texts;
    for (const sender of ['QA', 'specifier', 'coder']) {
      if (!text.includes(sender)) {
        throw new Error(`expected the single message to name sender "${sender}"; got: ${text}`);
      }
    }
  });

  scoped(/^the ticket close guard finds QA's approval for that ticket$/, (ctx) => {
    const result = spawnSync('bb', [TICKET_CLOSE_GUARD_CLI, ctx.root, ctx.ticketId], { encoding: 'utf8' });
    if (result.status !== 0 || result.stdout.trim() !== 'true') {
      throw new Error(
        `expected the ticket close guard to find QA's approval for ${ctx.ticketId}; got exit ${result.status}, stdout: ${result.stdout}, stderr: ${result.stderr}`
      );
    }
  });

  scoped(/^that note is still in the coordinator's new mail$/, (ctx) => {
    const stillNew = listMailbox(ctx, 'new');
    if (!stillNew.includes(ctx.noteFilename)) {
      throw new Error(`expected ${ctx.noteFilename} to remain in new/; found: ${JSON.stringify(stillNew)}`);
    }
  });

  scoped(/^no operator message is written$/, (ctx) => {
    const texts = operatorOutboxTexts(ctx);
    if (texts.length !== 0) {
      throw new Error(`expected no operator message; found: ${JSON.stringify(texts)}`);
    }
  });

  scoped(/^the in-process parcel is unchanged and was not relayed$/, (ctx) => {
    const stillInProcess = listMailbox(ctx, 'in_process');
    if (!stillInProcess.includes(ctx.inProcessFilename)) {
      throw new Error(`expected ${ctx.inProcessFilename} to remain in in_process/; found: ${JSON.stringify(stillInProcess)}`);
    }
    const after = readMailbox(ctx, 'in_process', ctx.inProcessFilename);
    if (after !== ctx.inProcessContentBefore) {
      throw new Error('in_process parcel content changed - expected byte-identical');
    }
    const completed = listMailbox(ctx, 'completed');
    if (completed.includes(ctx.inProcessFilename)) {
      throw new Error(`expected ${ctx.inProcessFilename} to NOT appear in completed/; it did`);
    }
    const texts = operatorOutboxTexts(ctx);
    if (texts.some((t) => t.includes('specifier') && t.includes('BL-9206'))) {
      throw new Error(`expected no operator message to name the in-process parcel; got: ${JSON.stringify(texts)}`);
    }
  });
}

module.exports = { registerSteps };
