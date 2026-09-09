'use strict';

// Shared land-step fixture infrastructure, extracted from BL-1446's own
// step handler (bl1446LandWalkNeverCountsLandedHistorySteps.js) so its
// sibling ticket BL-1447 (same Background: "a fixture repository with an
// origin, a main branch, and a parcel branch carrying five stage commits
// for one ticket whose last hop is recorded in the handoff archive") never
// re-implements it. Calls land-step-lib/land-plan and replay! directly via
// `bb -e` - never a reimplementation of the walk or the replay.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const STAGE_FILES = ['a', 'b', 'c', 'd', 'e'].map((c) => `backlog/active/BL-9001-${c}.yaml`);

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

// BL-1446: `commit`'s own `git add -A` sweeps every untracked path in the
// WHOLE repo, not just the path it was asked to stage - including the
// handoff-archive fixture below, whenever HEAD happens to be on a
// different line (the sibling's) than the one the archive was written
// against. A checkout back to that other line then deletes the archive as
// a file tracked on the line just left and absent at the destination
// (proved live: swarmforge/scripts/test/land_step_lib_test_runner.bb's
// own BL-1446 fixture hit exactly this before excluding it here too).
// Excluded via .git/info/exclude - never gitignore'd content itself, never
// committed - so it can never be swept into an unrelated line's commit in
// the first place. Fixture-only concern: the real archive lives beside a
// real .gitignore.
function excludeHandoffArchive(root) {
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  if (!existing.includes('.swarmforge/')) {
    fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
  }
}

// The durable record land-plan's `parcel-own-base` reads back
// (salvage-lib/latest-item-handoffs): a completed git_handoff citing
// `commit` for `taskName`, in the shape bl1004ReworkClaimSteps.js's own
// seedPriorWork already uses.
function recordHandoff(root, taskName, commitSha) {
  excludeHandoffArchive(root);
  const rolesTsv = path.join(root, '.swarmforge', 'roles.tsv');
  if (!fs.existsSync(rolesTsv)) {
    fs.mkdirSync(path.dirname(rolesTsv), { recursive: true });
    fs.writeFileSync(rolesTsv, ['cleaner', 'cleaner', root, 'session', 'Cleaner', 'claude', 'task'].join('\t') + '\n');
  }
  const completedDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.writeFileSync(
    path.join(completedDir, `00_${process.hrtime.bigint()}_from_documenter_to_qa_for_qa.handoff`),
    `task: ${taskName}\ncommit: ${commitSha}\nto: qa\nfrom: documenter\n`,
  );
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

function landPlan(root, commitSha, taskTicketId, base) {
  // land-plan tells "no :base given" (fall back to parcel-own-base, the
  // real bounded-walk default every production caller gets) apart from
  // "force :base to this exact value" via `(contains? opts :base)` - a
  // literal `:base nil` in the map IS a present key (`contains?` does not
  // care what the value is), so the key must be OMITTED entirely to test
  // the real default, never included with a nil/falsy value.
  const opts = `:root "${root}" :commit "${commitSha}" :task-ticket-id "${taskTicketId}"${base ? ` :base "${base}"` : ''}`;
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/land-plan {${opts}})))`,
  ));
  return JSON.parse(out);
}

// BL-1473: drives the REAL land-step-lib/own-paths, never a
// reimplementation - the same posture landPlan/replay already take one
// door up. unlandedSiblings defaults to none, which is every BL-1473
// scenario's shape (no sibling ticket at all - the exclusion under test
// is origin/main moving independently of any sibling entanglement).
function ownPaths(root, commitSha, taskTicketId, unlandedSiblings) {
  const unlandedForm = `#{${(unlandedSiblings || []).map((s) => `"${s}"`).join(' ')}}`;
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/own-paths "${root}" "${commitSha}" "${taskTicketId}" ${unlandedForm})))`,
  ));
  return JSON.parse(out);
}

// BL-1472: drives the REAL land-step-lib/delivered-attribution - the
// {path {:owners #{...} :any-untagged? bool}} map own-paths itself
// decides each path from. Used where a scenario needs the raw attribution
// answer for one path (owners AND the untagged-touch bit), not just
// own-paths' own include/exclude verdict.
function deliveredAttribution(root, originMain, commitSha) {
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/delivered-attribution "${root}" "${originMain}" "${commitSha}")))`,
  ));
  return JSON.parse(out);
}

function replay(root, commitSha, taskTicketId, ownPaths, passengers) {
  const pathsForm = `[${ownPaths.map((p) => `"${p}"`).join(' ')}]`;
  const passengersForm = `#{${(passengers || []).map((p) => `"${p}"`).join(' ')}}`;
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/replay! {:root "${root}" :commit "${commitSha}" :task-ticket-id "${taskTicketId}" :own-paths ${pathsForm} :passengers ${passengersForm}})))`,
  ));
  return JSON.parse(out);
}

function mkTmpDir(prefix) {
  return mkSocketFixtureRoot(prefix);
}

// The five stage commits (coder, cleaner, architect, hardener, documenter)
// for BL-9001, with the last hop (documenter -> QA) recorded in the
// handoff archive - the Background every scenario of both BL-1446 and
// BL-1447 shares. Returns via ctx.root/.seed/.documenterTip: the fixture
// root, the point origin/main was marked at (for building an independent
// sibling line off the same root), and the QA-branch HEAD every scenario
// continues from.
function buildParcelBranch(ctx, fixturePrefix) {
  ctx.root = mkTmpDir(fixturePrefix);
  initRepo(ctx.root);
  ctx.seed = markOriginMainHere(ctx.root);
  const roles = ['coder', 'cleaner', 'architect', 'hardener', 'documenter'];
  let tip;
  STAGE_FILES.forEach((file, i) => {
    tip = commit(ctx.root, file, 'id: BL-9001\n', `BL-9001: ${roles[i]}`);
  });
  ctx.documenterTip = tip;
  recordHandoff(ctx.root, 'BL-9001-fixture', ctx.documenterTip);
}

module.exports = {
  REPO_ROOT,
  STAGE_FILES,
  git,
  commit,
  initRepo,
  markOriginMainHere,
  recordHandoff,
  landPlan,
  ownPaths,
  deliveredAttribution,
  replay,
  mkTmpDir,
  buildParcelBranch,
};
