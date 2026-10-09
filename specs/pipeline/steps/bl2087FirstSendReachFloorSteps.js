'use strict';

// BL-2087: step handlers for "the sampled reach floor gate checks a
// coder's first send". Drives the REAL swarm_handoff.bb (and its real
// sampled_reach_floor_guard_lib.bb call chain) against a real fixture git
// repo, same pattern as bl1584SampledReachFloorGateSteps.js - a single
// fixture git repo playing the role of "the branch" (git operations always
// target ctx.root), reusing BL-1584's own frozen corpus under
// specs/pipeline/fixtures/bl1584/ rather than a second copy.
//
// The one structural difference from BL-1584's handler: this ticket's
// whole premise is a coder's FIRST send, taken up from a Work note that
// carries no commit header at all - so the fixture never seeds a received
// git_handoff. Instead, main is seeded once and the coder's own commits
// land on a SEPARATE branch that diverges from it, so
// sampled_reach_floor_guard_lib.bb's merge-base-with-main fallback sees a
// real base to compare against (committing everything straight onto main,
// BL-1584's own fixture shape, would make every file :modified against
// itself and never :added).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const FIXTURE_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'fixtures', 'bl1584');

const TASK_NAME = 'BL-2087-fixture';
const TICKET_ID = 'BL-2087';
const FEATURE_NAME = "BL-2087 the sampled reach floor gate checks a coder's first send";
const CODER_BRANCH = 'coder-branch';

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// BL-1390: a fresh mkdtemp dir under mkSocketFixtureRoot - `git init` here
// can never touch the live checkout - proven right after init, BEFORE any
// mutating git command follows.
function proveFixtureIsolated(root) {
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function writeRoles(ctx) {
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  const row = `coder\tcoder-wt\t${ctx.root}\tswarmforge-coder\tCoder\tclaude\ttask`;
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${row}\n`);
}

function writeFile(ctx, name, content) {
  const full = path.join(ctx.root, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commit(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function head(ctx) {
  return gitOut(ctx.root, ['rev-parse', 'HEAD']);
}

// BL-2087: the coder's own in_process mailbox holds a Work note, never a
// git_handoff - received-commit-for-task's own reader matches type:
// git_handoff only, so a note is functionally equivalent to nothing
// received at all, but seeding it (rather than leaving the mailbox empty)
// matches the ticket's own described shape and keeps the fixture honest
// about what a coder's FIRST take-up of a ticket actually looks like.
function seedWorkNote(ctx) {
  const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const content = `type: note\nto: coder\npriority: 10\nmessage: Work ${TICKET_ID}: merge main first, then read backlog/active\n`;
  fs.writeFileSync(path.join(dir, '00_work.handoff'), content);
}

// Diverges the coder's own work from main at main's CURRENT tip - called
// right before the parcel's first commit, never in Background, so a
// scenario that commits something onto main first (scenario 02's "main
// already carries...") does so before the branch exists.
function branchFromMain(ctx) {
  git(ctx.root, ['checkout', '-q', '-b', CODER_BRANCH]);
}

function runSwarmHandoff(ctx, draftContent) {
  const draftPath = path.join(ctx.root, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'coder' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function frozenFixtureContent(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${name}.property.fixture.js`), 'utf8');
}

const REFUSAL_MARKER = /SAMPLED_REACH_FLOOR: Cannot send git_handoff/;
const WARNING_MARKER = /SAMPLED_REACH_FLOOR WARNING/;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────

  scoped(/^a fixture repository whose main branch carries the frozen classifier corpus under specs\/pipeline\/fixtures\/bl1584$/, (ctx) => {
    ctx.root = mkTmp('bl2087-gate-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    proveFixtureIsolated(ctx.root);
    git(ctx.root, ['config', 'user.email', 'bl2087@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl2087']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeRoles(ctx);
    writeFile(ctx, 'seed.txt', 'seed\n');
    commit(ctx, 'seed base');
  });

  scoped(/^a coder whose in_process mailbox holds only the Work note for its ticket, with no commit$/, (ctx) => {
    seedWorkNote(ctx);
  });

  // ── Given / When (scenario 01) ───────────────────────────────────────

  scoped(/^the parcel's own commit adds a property test file shaped like the corpus file (\S+)$/, (ctx, name) => {
    branchFromMain(ctx);
    const relPath = `extension/test/${name}.property.test.js`;
    writeFile(ctx, relPath, frozenFixtureContent(name));
    commit(ctx, `${TICKET_ID}-fixture: adds ${name} as a new property test`);
    ctx.subjectPath = relPath;
  });

  scoped(/^the coder sends its first git_handoff for the ticket$/, (ctx) => {
    const tipSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    const draft = `type: git_handoff\nto: cleaner\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${tipSha}\n`;
    ctx.result = runSwarmHandoff(ctx, draft);
  });

  scoped(/^the send is (refused|allowed)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.result);
    const refused = REFUSAL_MARKER.test(out);
    if (outcome === 'refused') {
      if (ctx.result.status !== 2 || !refused) {
        throw new Error(`expected BL-1584's own gate to have refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      return;
    }
    // Not a status===0 check: the self-audit challenge (BL-1529, Article
    // 2.3) can legitimately answer AUDIT_REQUIRED / HANDOFF_NOT_QUEUED
    // (exit 1) on a fixture's first-ever send for a sender+task - a real,
    // non-refusing outcome for THIS gate's own purposes, same convention
    // bl1584SampledReachFloorGateSteps.js's own "allowed" check follows.
    if (refused) {
      throw new Error(`expected the send to be allowed, but BL-1584's gate refused it: ${out}`);
    }
  });

  // ── Given / When (scenario 02) ───────────────────────────────────────

  scoped(/^main already carries a property test file shaped like the corpus file bl1327DescentLadderInvariants$/, (ctx) => {
    const relPath = 'extension/test/bl1327DescentLadderInvariants.property.test.js';
    writeFile(ctx, relPath, frozenFixtureContent('bl1327DescentLadderInvariants'));
    commit(ctx, 'pre-existing: bl1327DescentLadderInvariants, already on main');
    ctx.subjectPath = relPath;
  });

  scoped(/^the parcel's own commit modifies that file without constructing its floor$/, (ctx) => {
    branchFromMain(ctx);
    const full = path.join(ctx.root, ctx.subjectPath);
    fs.appendFileSync(full, '\n// touched, same shape\n');
    commit(ctx, `${TICKET_ID}-fixture: touches the pre-existing file`);
  });

  scoped(/^a sampled reach floor warning names that property test file$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!(WARNING_MARKER.test(out) && out.includes(ctx.subjectPath))) {
      throw new Error(`expected a SAMPLED_REACH_FLOOR WARNING naming ${ctx.subjectPath}, got: ${out}`);
    }
  });
}

module.exports = { registerSteps };
