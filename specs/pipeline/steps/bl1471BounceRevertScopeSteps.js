'use strict';

// BL-1471: a bounce revert touches only the bounced ticket's own paths, and
// an omission bounce reverts nothing. Drives the REAL
// swarmforge/scripts/check_bounce_revert_scope.sh against real git fixtures
// under mkdtemp with a real .swarmforge/bounces/ store (BL-1390) - never a
// JavaScript restatement of the attribution walk or the omission-class
// decision. Scenario 05 statically inspects the real
// swarmforge/scripts/run_commit_guards.sh for the wiring line itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bounce_revert_scope.sh');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh');

const FEATURE = "BL-1471 A bounce revert touches only the bounced ticket's paths, and an omission bounce reverts nothing";

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', rel);
  git(root, 'commit', '-q', '-m', message);
}

function rebuildMerge(ctx) {
  // Re-merges "doc" into "main" from scratch - callers add commits to "doc"
  // first. Keeps the merge's own subject untagged (the real BL-1348 shape:
  // "Merge documenter <sha> into QA.", naming no ticket).
  git(ctx.root, 'checkout', '-q', 'main');
  git(ctx.root, 'reset', '-q', '--hard', ctx.base);
  const docTip = git(ctx.root, 'rev-parse', 'doc').trim();
  git(ctx.root, 'merge', '-q', '--no-ff', '-m', `Merge documenter ${docTip} into QA.`, 'doc');
  ctx.docTip = docTip;
  ctx.mergeTip = git(ctx.root, 'rev-parse', 'HEAD').trim();
}

function recordBounce(ctx, ticket, failureClass, commit, at) {
  const dir = path.join(ctx.root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  const record = { ticket, producingRole: 'coder', ticketType: 'defect', failureClass, commit, by: 'QA', at };
  fs.appendFileSync(path.join(dir, '2026-09.jsonl'), `${JSON.stringify(record)}\n`);
}

function runGuard(root, message) {
  const msgFile = path.join(os.tmpdir(), `bl1471-msg-${process.pid}-${Math.random()}.txt`);
  fs.writeFileSync(msgFile, message);
  const r = spawnSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
  fs.rmSync(msgFile, { force: true });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  scoped(
    registry,
    /^a fixture repository with a reviewing branch that merged a parcel for one ticket, a bounce store under the fixture root, and the shared commit-guard chain$/,
    (ctx) => {
      ctx.root = mkTmp('aps-bl1471-repo-');
      git(ctx.root, 'init', '-q', '-b', 'main');
      git(ctx.root, 'config', 'user.email', 'test@test');
      git(ctx.root, 'config', 'user.name', 'test');
      git(ctx.root, 'config', 'commit.gpgsign', 'false');
      git(ctx.root, 'commit', '-q', '--allow-empty', '-m', 'seed');
      ctx.base = git(ctx.root, 'rev-parse', 'HEAD').trim();

      ctx.ticket = 'BL-9001';
      ctx.ticketFile = 'specs/pipeline/steps/bl9001ExampleSteps.js';
      git(ctx.root, 'checkout', '-q', '-b', 'doc', ctx.base);
      commitFile(ctx.root, ctx.ticketFile, 'step handler\n', `${ctx.ticket}: add step handler`);
      ctx.ticketCommit = git(ctx.root, 'rev-parse', 'HEAD').trim();

      rebuildMerge(ctx);
      // A real bounce store exists under the fixture root from the first
      // bounce recorded by a later step - nothing to create here yet.
    }
  );

  // ── shared Given: the bounced ticket's latest record's class ──────────
  scoped(registry, /^the ticket's latest bounce record is of a wrong-content class$/, (ctx) => {
    recordBounce(ctx, ctx.ticket, 'behavior', ctx.ticketCommit, '2026-09-07T10:00:00.000Z');
  });

  scoped(registry, /^the ticket's latest bounce record is of class (spec-gap|invariant-unencoded)$/, (ctx, cls) => {
    recordBounce(ctx, ctx.ticket, cls, ctx.ticketCommit, '2026-09-07T10:00:00.000Z');
  });

  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(
    registry,
    /^a staged revert of the review merge whose diff touches only paths attributed to the bounced ticket$/,
    (ctx) => {
      spawnSync('git', ['revert', '-n', '-m', '1', ctx.mergeTip], { cwd: ctx.root, encoding: 'utf8' });
      ctx.message = `Revert "Merge documenter ${ctx.docTip} into QA."\n\nThis reverts commit ${ctx.mergeTip}.\n`;
    }
  );

  // ── scenario 02: fold a second ticket's commit into "doc" and re-merge,
  //    so the revert's own diff now spans two tickets' paths ────────────
  scoped(
    registry,
    /^a staged revert of the review merge whose diff removes a path attributed to a different ticket$/,
    (ctx) => {
      ctx.otherTicket = 'BL-9002';
      ctx.otherFile = 'specs/pipeline/steps/bl9002ExampleSteps.js';
      git(ctx.root, 'checkout', '-q', 'doc');
      commitFile(ctx.root, ctx.otherFile, 'step handler 2\n', `${ctx.otherTicket}: add a second step handler`);
      rebuildMerge(ctx);
      spawnSync('git', ['revert', '-n', '-m', '1', ctx.mergeTip], { cwd: ctx.root, encoding: 'utf8' });
      ctx.message = `Revert "Merge documenter ${ctx.docTip} into QA."\n\nThis reverts commit ${ctx.mergeTip}.\n`;
    }
  );

  // ── scenario 03 ─────────────────────────────────────────────────────
  scoped(registry, /^a staged revert of the review merge$/, (ctx) => {
    spawnSync('git', ['revert', '-n', '-m', '1', ctx.mergeTip], { cwd: ctx.root, encoding: 'utf8' });
    ctx.message = `Revert "Merge documenter ${ctx.docTip} into QA."\n\nThis reverts commit ${ctx.mergeTip}.\n`;
  });

  // ── scenario 04 ─────────────────────────────────────────────────────
  scoped(registry, /^a staged ordinary commit on the reviewing branch$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(ctx.root, 'unrelated.txt'), 'unrelated change\n');
    git(ctx.root, 'add', 'unrelated.txt');
    ctx.message = 'chore: an ordinary commit\n';
    ctx.ordinaryStaged = true;
  });

  // ── shared When ─────────────────────────────────────────────────────
  scoped(registry, /^the commit-guard chain judges (?:the revert|it)$/, (ctx) => {
    ctx.result = runGuard(ctx.root, ctx.message);
  });

  // ── shared Thens ────────────────────────────────────────────────────
  scoped(registry, /^the revert-scope guard passes$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected the guard to pass:\n${ctx.result.out}`);
  });

  scoped(registry, /^the revert-scope guard refuses, naming that path and the ticket it belongs to$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a refusal:\n${ctx.result.out}`);
    assert.ok(ctx.result.out.includes(ctx.otherFile), `refusal must name the other path:\n${ctx.result.out}`);
    assert.ok(ctx.result.out.includes(ctx.otherTicket), `refusal must name the other ticket:\n${ctx.result.out}`);
  });

  scoped(registry, /^the revert-scope guard refuses, saying an omission bounce reverts nothing$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a refusal:\n${ctx.result.out}`);
    assert.match(ctx.result.out, /nothing to revert/i, `refusal must say an omission bounce reverts nothing:\n${ctx.result.out}`);
  });

  scoped(registry, /^the revert-scope guard exits without judging$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `an ordinary commit must never be refused:\n${ctx.result.out}`);
    assert.equal(ctx.result.out.trim(), '', `an ordinary commit must produce no output from this guard:\n${ctx.result.out}`);
  });

  // ── scenario 05 ─────────────────────────────────────────────────────
  scoped(registry, /^the commit-guard runner is inspected$/, (ctx) => {
    ctx.runnerContent = fs.readFileSync(RUNNER, 'utf8');
  });

  scoped(registry, /^it runs the revert-scope guard in its cheap tier$/, (ctx) => {
    const lines = ctx.runnerContent.split('\n');
    const guardLine = lines.findIndex((l) => /run_guard\s+check_bounce_revert_scope\.sh/.test(l));
    const expensiveLine = lines.findIndex((l) => /run_guard\s+check_property_suite_drift\.sh/.test(l));
    assert.ok(guardLine >= 0, 'run_commit_guards.sh does not run check_bounce_revert_scope.sh at all');
    assert.ok(expensiveLine >= 0, 'run_commit_guards.sh does not run the expensive-tier guard - cannot locate the tier boundary');
    assert.ok(
      guardLine < expensiveLine,
      'check_bounce_revert_scope.sh is not reached before the expensive tier - it is not in the cheap tier'
    );
  });
}

module.exports = { registerSteps };
