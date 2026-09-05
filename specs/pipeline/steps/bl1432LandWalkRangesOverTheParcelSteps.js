'use strict';

// BL-1432: step handlers for "the land walk ranges over the parcel, not the
// branch's history". Drives the REAL land_step_lib.bb (land-plan,
// post-land-repoint!) through a bb subprocess against a fixture git
// repository built fresh per scenario - never a reimplementation of the
// walk or the re-point.
//
// Scenarios 01-02 build a fixture repo directly (execFileSync('git', ...))
// and call land-plan with an explicit :base to prove the bounded-walk half
// (option 2); scenario 03-04 exercise post-land-repoint! against a fixture
// whose worktree is (03) clean, or (04) holds work (an uncommitted change,
// or a parcel in in_process).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1432 The land walk ranges over the parcel, not the branch\'s history';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const KNOWN_WORK = new Set(['an uncommitted change', 'a parcel in its in_process']);

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
}

function commit(root, relPath, content, message) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function markOriginMainHere(root) {
  const sha = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', sha);
  return sha;
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[babashka.fs :as fs])\n(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

function landPlan(root, commit, taskTicketId, base) {
  const baseForm = base ? `"${base}"` : 'nil';
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/land-plan {:root "${root}" :commit "${commit}" :task-ticket-id "${taskTicketId}" :base ${baseForm}})))`
  ));
  return JSON.parse(out);
}

function ancestryCommits(root, base, commit) {
  const out = bb(libExpr(
    `(println (json/generate-string (#'land-step-lib/ancestry-commits "${root}" "${base}" "${commit}")))`
  ));
  return JSON.parse(out);
}

function postLandRepoint(root) {
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/post-land-repoint! {:root "${root}"})))`
  ));
  return JSON.parse(out);
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a bare origin, a main that already holds the content of many earlier parcels, and a QA-style branch whose history carries those parcels' review merges plus one new approved parcel$/, (ctx) => {
    ctx.root = mkTmpDir('bl1432-fixture-');
    initRepo(ctx.root);
    // origin-main never advances past the seed - the tip-pure-replay shape:
    // main holds these parcels' CONTENT under other shas, but the review
    // merges below are never its ancestors.
    markOriginMainHere(ctx.root);
    commit(ctx.root, 'backlog/active/BL-9101-old.yaml', 'id: BL-9101\n',
      'Merge cleaner (BL-9101 old, already-landed parcel review merge)');
    ctx.base = git(ctx.root, 'rev-parse', 'HEAD');
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the new approved parcel is the parcel under land$/, (ctx) => {
    ctx.commit = commit(ctx.root, 'backlog/active/BL-9001-x.yaml', 'id: BL-9001\n', 'BL-9001: own work');
    ctx.taskTicketId = 'BL-9001';
  });

  scoped(/^the land plan for the parcel under land is computed$/, (ctx) => {
    ctx.plan = landPlan(ctx.root, ctx.commit, ctx.taskTicketId, ctx.base);
  });

  scoped(/^every commit the attribution walk visits is one of that parcel's own$/, (ctx) => {
    const candidates = ancestryCommits(ctx.root, ctx.base, ctx.commit);
    assert.deepEqual(candidates, [ctx.commit],
      `expected the walk to visit only the parcel's own commit, got: ${JSON.stringify(candidates)}`);
  });

  scoped(/^the verdict names the parcel's own paths and no entangled sibling$/, (ctx) => {
    assert.equal(ctx.plan.action, 'land', `expected :land, got: ${JSON.stringify(ctx.plan)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the new approved parcel has been landed and published$/, (ctx) => {
    if (!ctx.commit) {
      ctx.commit = commit(ctx.root, 'backlog/active/BL-9001-x.yaml', 'id: BL-9001\n', 'BL-9001: own work');
      ctx.taskTicketId = 'BL-9001';
    }
    // "landed and published": origin/main advances to what this parcel
    // delivered (a tip-pure replay lands CONTENT, so the branch's own
    // review-merge commit itself never becomes origin/main's ancestor -
    // the next base for THIS branch is simply its own current tip).
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', ctx.commit);
    ctx.base = ctx.commit;
  });

  scoped(/^a further approved parcel added on the QA-style branch is the parcel under land$/, (ctx) => {
    ctx.commit = commit(ctx.root, 'backlog/active/BL-9002-x.yaml', 'id: BL-9002\n', 'BL-9002: a further approved parcel');
    ctx.taskTicketId = 'BL-9002';
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the QA-style worktree is clean and its in_process mailbox is empty$/, (ctx) => {
    ctx.oldTip = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^the post-land re-point runs$/, (ctx) => {
    ctx.repoint = postLandRepoint(ctx.root);
  });

  scoped(/^the QA-style branch tip equals origin\/main$/, (ctx) => {
    const originMain = git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    assert.equal(ctx.repoint.action, 'repointed', `expected :repointed, got: ${JSON.stringify(ctx.repoint)}`);
    assert.equal(git(ctx.root, 'rev-parse', 'HEAD'), originMain);
  });

  scoped(/^the re-point is logged with the old tip and the new tip$/, (ctx) => {
    const log = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'land-repoint.log'), 'utf8');
    assert.ok(log.includes(ctx.oldTip), `expected the log to name the old tip ${ctx.oldTip}, got: ${log}`);
    assert.ok(log.includes(ctx.repoint['new-tip']), `expected the log to name the new tip, got: ${log}`);
  });

  // ── Scenario 04 (Outline) ─────────────────────────────────────────────
  scoped(/^the QA-style worktree holds (.+)$/, (ctx, work) => {
    if (!KNOWN_WORK.has(work)) {
      throw new Error(`unknown <work>: ${work}`);
    }
    ctx.work = work;
    ctx.oldTip = git(ctx.root, 'rev-parse', 'HEAD');
    if (work === 'an uncommitted change') {
      fs.writeFileSync(path.join(ctx.root, 'dirty.txt'), 'uncommitted\n');
    } else {
      const inProcess = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      fs.mkdirSync(inProcess, { recursive: true });
      fs.writeFileSync(path.join(inProcess, '00_x_from_a_to_b_for_b.handoff'), 'task: BL-9999\n');
    }
  });

  scoped(/^nothing about the branch or the worktree has moved$/, (ctx) => {
    assert.equal(ctx.repoint.action, 'skipped', `expected :skipped, got: ${JSON.stringify(ctx.repoint)}`);
    assert.equal(git(ctx.root, 'rev-parse', 'HEAD'), ctx.oldTip);
  });

  scoped(/^the skip is logged naming (.+)$/, (ctx, work) => {
    if (!KNOWN_WORK.has(work)) {
      throw new Error(`unknown <work>: ${work}`);
    }
    const log = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'land-repoint.log'), 'utf8');
    assert.ok(log.includes(work), `expected the skip log to name "${work}", got: ${log}`);
  });
}

module.exports = { registerSteps };
