'use strict';

// BL-1368: an approval commit names the decider.
//
// Drives the REAL front-desk decision routines (recordApprovalDecisionAndClose
// / recordAmendDecisionAndClose) against a fixture repo with the REAL
// commit_integrity_cli.bb, so the commit message under assertion is composed
// by production and read back out of git - never restated by the handler,
// which is how a byline assertion turns into prompt-text theatre.
//
// The role-byline half runs the REAL compliance checker
// (compliance_battery.bb check commit-byline), the same scripted proxy the
// swarm uses to hold a role to its byline, so invariant 2 is measured by the
// thing that actually enforces it.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE = 'An approval commit names the decider';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const REAL_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const COMPLIANCE_CLI = path.join(REAL_SCRIPTS, 'compliance_battery.bb');
const FIXTURE_PREFIX = 'bl1368-';

const { commitApprovalWrites } = require(path.join(EXT_OUT, 'util', 'commitIntegrityRunner'));
const { recordApprovalDecisionAndClose, recordAmendDecisionAndClose } = require(path.join(
  EXT_OUT,
  'tools',
  'telegramFrontDeskBotCore'
));
const { PIPELINE_ORDER } = require(path.join(EXT_OUT, 'metrics', 'swarmMetrics'));

const TICKET = 'BL-9368';

// Scenario Outline values are validated against this explicit list - a verb
// the feature invents but production cannot compose must fail loudly, never
// pass through.
const KNOWN_VERBS = ['Approve', 'Reject', 'Amend'];

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

// BL-971: a killed run traps nothing, so aged roots from an earlier run are
// swept by prefix BEFORE this one starts. Age-bounded on purpose: a concurrent
// run's live root is minutes old and must survive.
function sweepAgedFixtureRoots() {
  const tmp = os.tmpdir();
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(tmp, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // A root another run removed between readdir and stat is not our problem.
    }
  }
}

function makeRoot(ctx) {
  sweepAgedFixtureRoots();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  installCommitIntegrity(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  ctx.root = root;
  return root;
}

function writePendingTicket(root) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${TICKET}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${TICKET}\ntitle: t\nhuman_approval: pending\ndepends_on: []\n`);
  git(root, 'add', '-A', 'backlog');
  git(root, 'commit', '-q', '-m', `seed ${TICKET}`);
  return file;
}

function recordDecisionOnDisk(file, value) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/human_approval:.*/m, `human_approval: ${value}`));
}

// The adapters a real decision needs: recording is the on-disk flip the bot's
// own recorders perform, and the commit is the REAL shared writer.
function decisionAdapters(ctx) {
  const record = (value) => {
    recordDecisionOnDisk(ctx.ticketFile, value);
    return true;
  };
  return {
    recordApprovalReply: async () => record('approved'),
    recordRejectionReply: async () => record('rejected'),
    recordAmendReply: async () => record('amending'),
    commitApprovalWrites: (backlogId, message) => commitApprovalWrites(ctx.root, backlogId, message),
  };
}

function roleBylineIn(message) {
  return PIPELINE_ORDER.find((role) => message.includes(`By ${role}.`));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket pending human approval$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.ticketFile = writePendingTicket(root);
  });

  scoped(/^the human records a (\S+) decision$/, async (ctx, verb) => {
    assert.ok(KNOWN_VERBS.includes(verb), `unknown decision verb "${verb}" - known: ${KNOWN_VERBS.join(', ')}`);
    const adapters = decisionAdapters(ctx);
    const result =
      verb === 'Amend'
        ? await recordAmendDecisionAndClose(adapters, TICKET, 'please narrow it', 0)
        : await recordApprovalDecisionAndClose(
            adapters,
            TICKET,
            verb === 'Approve' ? { kind: 'approved' } : { kind: 'rejected', reason: 'not yet' },
            0
          );
    assert.equal(result.committed, true, `the ${verb} decision must reach a real commit`);
    ctx.headMessage = git(ctx.root, 'log', '-1', '--format=%B');
    assert.ok(ctx.headMessage.startsWith(`${verb} ${TICKET}:`), `commit subject must carry the verb: ${ctx.headMessage}`);
  });

  scoped(/^the commit does not carry a pipeline role byline$/, (ctx) => {
    const named = roleBylineIn(ctx.headMessage);
    assert.equal(named, undefined, `the commit credits the pipeline role "${named}":\n${ctx.headMessage}`);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(/^a pipeline role commits its own work$/, (ctx) => {
    const root = ctx.root ?? makeRoot(ctx);
    ctx.role = 'coder';
    fs.writeFileSync(path.join(root, 'work.txt'), 'a real change\n');
    git(root, 'add', 'work.txt');
    ctx.roleMessage = `Implement the slice.\n\nBy ${ctx.role}.`;
  });

  scoped(/^the commit is written$/, (ctx) => {
    git(ctx.root, 'commit', '-q', '-m', ctx.roleMessage);
    ctx.roleSha = git(ctx.root, 'rev-parse', 'HEAD').trim();
  });

  scoped(/^the commit carries that role's byline$/, (ctx) => {
    const out = execFileSync('bb', [COMPLIANCE_CLI, 'check', 'commit-byline', ctx.root, ctx.roleSha, ctx.role], {
      encoding: 'utf8',
    });
    const verdict = JSON.parse(out.trim().split('\n').pop());
    assert.equal(verdict.status, 'pass', `the role byline check refused a role's own commit: ${out}`);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
