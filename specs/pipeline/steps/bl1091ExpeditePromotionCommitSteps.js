'use strict';

// BL-1091: Expedite promotion commits BOTH ends of the paused→active rename.
//
// Drives the REAL promoteToActive + commitExpediteWrites against a fixture
// git repo with the REAL commit_integrity_cli.bb and promotion gates. The
// defect was a pathspec that named only the destination — git show --stat
// is the oracle, not a restated path list.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installPromotionGates } = require('./lib/promotionGatesFixture');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE = 'A backlog promotion is committed as both of its paths';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const REAL_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const { promoteToActive, findBacklogFilePath } = require(path.join(EXT_OUT, 'panel', 'backlogWriter'));
const { commitExpediteWrites, commitApprovalWrites } = (() => {
  const runner = require(path.join(EXT_OUT, 'util', 'commitIntegrityRunner'));
  const bot = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));
  return {
    commitExpediteWrites: bot.commitExpediteWrites,
    commitApprovalWrites: runner.commitApprovalWrites,
  };
})();

const TICKET = 'BL-9091';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function installCommitIntegrity(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of computeClosure(REAL_SCRIPTS, 'commit_integrity_cli.bb')) {
    const src = path.join(REAL_SCRIPTS, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scriptsDir, name));
  }
}

function makeRoot(ctx) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1091-')));
  installPromotionGates(root);
  installCommitIntegrity(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  ctx.root = root;
  return root;
}

function writeTicket(root, folder, extra) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${TICKET}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${TICKET}\ntitle: t\nhuman_approval: pending\ndepends_on: []\n${extra}`);
  git(root, 'add', '-A', 'backlog');
  git(root, 'commit', '-q', '-m', `seed ${TICKET}`);
  return file;
}

function approveOnDisk(file) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/human_approval:.*/m, 'human_approval: approved'));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket in backlog\/paused\/ awaiting approval$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.ticketFile = writeTicket(root, 'paused', '');
    ctx.folder = 'paused';
  });

  scoped(/^a ticket already in backlog\/active\/ awaiting approval$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.ticketFile = writeTicket(root, 'active', '');
    ctx.folder = 'active';
  });

  scoped(/^a ticket awaiting approval in whichever folder it already occupies$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.ticketFile = writeTicket(root, 'active', '');
  });

  scoped(/^the operator expedites the ticket$/, async (ctx) => {
    approveOnDisk(ctx.ticketFile);
    const promotion = promoteToActive(ctx.root, TICKET);
    ctx.promotion = promotion;
    const ok = await commitExpediteWrites(ctx.root, TICKET, promotion.source);
    assert.equal(ok, true, 'expedite commit must succeed');
    ctx.headStat = git(ctx.root, 'show', '--stat', '--format=', 'HEAD');
    ctx.headName = git(ctx.root, 'show', '--name-status', '--format=', 'HEAD');
  });

  scoped(/^the resulting commit records a deletion under backlog\/paused\/$/, (ctx) => {
    // Git may record a pure rename (Rxxx) or a D+A pair — both name the
    // paused/ source disappearing. Only a destination-only A is the defect.
    assert.match(ctx.headName, new RegExp(`backlog/paused/${TICKET}`));
    assert.match(ctx.headName, /^(?:D|R\d+)/m);
  });

  scoped(/^the resulting commit records an addition under backlog\/active\/$/, (ctx) => {
    assert.match(ctx.headName, new RegExp(`backlog/active/${TICKET}`));
  });

  scoped(/^no uncommitted change for that ticket remains in the working tree$/, (ctx) => {
    const status = git(ctx.root, 'status', '--porcelain', '--', 'backlog');
    assert.equal(status.trim(), '', `working tree dirty:\n${status}`);
  });

  scoped(/^the ticket id appears in exactly one backlog folder$/, (ctx) => {
    const hits = [];
    for (const folder of ['active', 'paused', 'hold', 'done']) {
      const dir = path.join(ctx.root, 'backlog', folder);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(TICKET)) hits.push(path.join(folder, f));
      }
    }
    assert.equal(hits.length, 1, `expected one path, got ${hits.join(', ')}`);
  });

  scoped(/^the resulting commit records the approval on the active path$/, (ctx) => {
    assert.match(ctx.headName, new RegExp(`backlog/active/${TICKET}`));
    assert.doesNotMatch(ctx.headName, /backlog\/paused\//);
  });

  scoped(/^the operator records (.+) through the (.+) writer$/, async (ctx, verb, writer) => {
    ctx.writer = writer;
    ctx.verb = verb;
    approveOnDisk(ctx.ticketFile);
    const message = `${verb} ${TICKET}: record human_approval\n\nBy coder.`;
    // Both writers share commitApprovalWrites — single path. The "writer"
    // column locks that neither bridge nor front-desk grows a second path.
    const ok = await commitApprovalWrites(ctx.root, TICKET, message);
    assert.equal(ok, true);
    ctx.headName = git(ctx.root, 'show', '--name-status', '--format=', 'HEAD');
  });

  scoped(/^the resulting commit names exactly one path$/, (ctx) => {
    const paths = ctx.headName
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    assert.equal(paths.length, 1, `expected one path, got:\n${ctx.headName}`);
  });
}

module.exports = { registerSteps };
