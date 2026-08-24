'use strict';

// BL-748: a routing-skip recording failure never withholds delivery.
// Drives the REAL swarm_handoff.bb send path (same fixture shape as BL-623).

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');
const {
  writeAcceptanceContractFixture,
  DEFAULT_FEATURE_PATH: ACCEPTANCE_FEATURE_PATH,
} = require('../../../extension/test/helpers/acceptanceContractFixture');

const FEATURE = 'a routing-skip recording failure never withholds delivery';

const DEFAULT_SKIP_REASONS = [
  'stage_skip_reasons:',
  '  cleaner: not touched, config-only change',
  '  architect: no design impact',
  '  hardender: existing coverage suffices',
  '  documenter: no user-facing behavior change',
  '',
].join('\n');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function writeRolesTsv(root) {
  const roles = [
    ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['specifier', 'master', root, 'swarmforge-specifier', 'Specifier', 'claude', 'task'],
    ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ['cleaner', 'cleaner', root, 'swarmforge-cleaner', 'Cleaner', 'claude', 'batch'],
    ['architect', 'architect', root, 'swarmforge-architect', 'Architect', 'claude', 'task'],
    ['hardender', 'hardender', root, 'swarmforge-hardender', 'Hardender', 'claude', 'batch'],
    ['documenter', 'documenter', root, 'swarmforge-documenter', 'Documenter', 'claude', 'task'],
    ['QA', 'QA', root, 'swarmforge-QA', 'Qa', 'claude', 'task'],
  ];
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${roles.map((r) => r.join('\t')).join('\n')}\n`);
}

function ensureFixture(ctx) {
  if (ctx.targetPath) return ctx.targetPath;
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl748-'));
  git(targetPath, ['init', '-q']);
  fs.writeFileSync(path.join(targetPath, 'README.md'), 'x');
  writeAcceptanceContractFixture(targetPath);
  git(targetPath, ['add', '.']);
  git(targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  ctx.commit = execFileSync('git', ['-C', targetPath, 'rev-parse', '--short=10', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  writeRolesTsv(targetPath);
  // Pre-create outbox dirs so a later chmod a-w on .swarmforge still lets
  // write-handoff! install into existing directories (qa_e2e posture).
  for (const sub of ['outbox', 'sent', 'failed']) {
    fs.mkdirSync(path.join(targetPath, '.swarmforge', 'handoffs', sub), { recursive: true });
  }
  ctx.targetPath = targetPath;
  ctx.ticketId = 'BL-748';
  ctx.drafts = [];
  return targetPath;
}

function writeTicket(ctx, extraLines) {
  const dir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${ctx.ticketId}-demo.yaml`),
    `id: ${ctx.ticketId}\ntitle: "demo"\nstatus: active\nacceptance: ${ACCEPTANCE_FEATURE_PATH}\n${extraLines || ''}`
  );
}

function journalPath(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'routing-skips.jsonl');
}

function restoreJournalWritable(ctx) {
  try {
    fs.chmodSync(path.join(ctx.targetPath, '.swarmforge'), 0o755);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(journalPath(ctx))) fs.chmodSync(journalPath(ctx), 0o644);
  } catch {
    /* ignore */
  }
}

function sendHandoff(ctx, { from, to }) {
  ensureFixture(ctx);
  const seq = (ctx._seq = (ctx._seq || 0) + 1);
  const draftName = `draft-${seq}.txt`;
  const draft = path.join(ctx.targetPath, draftName);
  fs.writeFileSync(
    draft,
    ['type: git_handoff', `to: ${to}`, 'priority: 50', `task: ${ctx.ticketId}`, `commit: ${ctx.commit}`, ''].join(
      '\n'
    )
  );
  ctx.lastDraft = draft;
  ctx.drafts.push(draft);
  const env = {
    ...process.env,
    SWARMFORGE_ROLE: from,
    SWARMFORGE_SKIP_SYNC_INJECT: '1',
    SWARMFORGE_REQUIRED_STAGES_ROUTING: '1',
  };
  delete env.SWARMFORGE_SKIP_DAEMON;
  const result = spawnSync('bb', [SWARM_HANDOFF, draftName], {
    cwd: ctx.targetPath,
    encoding: 'utf8',
    env,
  });
  ctx.lastSend = {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    out: `${result.stdout || ''}${result.stderr || ''}`,
    error: result.error,
  };
  return ctx.lastSend;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^required-stages routing is enabled$/, (ctx) => {
    ensureFixture(ctx);
  });

  scoped(/^an active ticket declaring required_stages and stage_skip_reasons$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(ctx, ['required_stages: [coder, qa]', DEFAULT_SKIP_REASONS].join('\n'));
  });

  scoped(/^the active ticket declares required_stages of coder and qa$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(ctx, ['required_stages: [coder, qa]', DEFAULT_SKIP_REASONS].join('\n'));
  });

  scoped(/^the active ticket declares the full canonical chain$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(
      ctx,
      'required_stages: [coder, cleaner, architect, hardender, documenter, qa]\n'
    );
  });

  scoped(/^the routing-skips journal's parent directory cannot be created$/, (ctx) => {
    ensureFixture(ctx);
    restoreJournalWritable(ctx);
    // Existing .swarmforge stays; remove write so a new routing-skips.jsonl
    // cannot be created (create-dirs on an existing dir is a no-op; spit fails).
    fs.chmodSync(path.join(ctx.targetPath, '.swarmforge'), 0o555);
    ctx.journalFault = 'parent';
  });

  scoped(/^the routing-skips journal file cannot be appended to$/, (ctx) => {
    ensureFixture(ctx);
    restoreJournalWritable(ctx);
    fs.writeFileSync(journalPath(ctx), '');
    fs.chmodSync(journalPath(ctx), 0o444);
    ctx.journalFault = 'file';
  });

  scoped(/^the routing-skips journal is writable$/, (ctx) => {
    ensureFixture(ctx);
    restoreJournalWritable(ctx);
    ctx.journalFault = null;
  });

  scoped(/^the coder sends a git_handoff addressed directly to QA$/, (ctx) => {
    sendHandoff(ctx, { from: 'coder', to: 'QA' });
  });

  scoped(/^the documenter sends a git_handoff addressed to QA$/, (ctx) => {
    sendHandoff(ctx, { from: 'documenter', to: 'QA' });
  });

  scoped(/^the send does not abort with an uncaught exception$/, (ctx) => {
    const { out, error, status } = ctx.lastSend;
    assert.ok(!error, `spawn failed: ${error}`);
    assert.doesNotMatch(out, /Exception|NullPointer|StackTrace|clojure\.lang/, `uncaught exception:\n${out}`);
    assert.ok(status === 0, `expected exit 0, got ${status}:\n${out}`);
  });

  scoped(/^the parcel is delivered to QA$/, (ctx) => {
    const { out, status } = ctx.lastSend;
    assert.ok(status === 0, `send failed (${status}):\n${out}`);
    const match = out.match(/:(\/[^\n]*\.handoff)/);
    assert.ok(match, `no installed handoff reported:\n${out}`);
    const content = fs.readFileSync(match[1], 'utf8');
    const toLine = content.split('\n').find((l) => l.startsWith('to: '));
    assert.equal(toLine && toLine.slice(4), 'QA', `expected to: QA, got ${toLine}`);
    ctx.lastOutbox = match[1];
  });

  scoped(/^the draft file is consumed$/, (ctx) => {
    assert.ok(ctx.lastDraft, 'no draft recorded');
    assert.ok(!fs.existsSync(ctx.lastDraft), `draft still present: ${ctx.lastDraft}`);
  });

  scoped(/^the recording failure is reported on stderr$/, (ctx) => {
    assert.match(ctx.lastSend.stderr, /ROUTING-SKIP RECORD FAILED:/, ctx.lastSend.stderr);
  });

  scoped(/^no recording failure is reported on stderr$/, (ctx) => {
    assert.doesNotMatch(ctx.lastSend.stderr, /ROUTING-SKIP RECORD FAILED:/, ctx.lastSend.stderr);
  });

  scoped(/^a routing-skips journal line is appended for the ticket$/, (ctx) => {
    const p = journalPath(ctx);
    assert.ok(fs.existsSync(p), 'routing-skips.jsonl missing');
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, 'expected at least one journal line');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.equal(entry['ticket-id'], ctx.ticketId, `journal entry: ${JSON.stringify(entry)}`);
  });
}

module.exports = { registerSteps };
