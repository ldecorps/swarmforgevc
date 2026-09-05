'use strict';

// BL-1403: step handlers for "The merge-deletion guard never reports a move
// and never refuses unexemptably".
//
// Drives the REAL check_merge_deletion.sh as a subprocess against a real
// temp git repository, the same convention the sibling shell test
// (test_merge_deletion_guard.sh) uses for this exact script - the defect is
// about which git plumbing (rename detection, attribution fallback) the
// guard's own shell logic exercises, so nothing short of a real repo and a
// real merge can answer these.
//
// FIXTURE BODY SIZE MATTERS: the intake's body must be large enough that
// appending a short footer keeps it above git's default 50% rename
// similarity threshold - a one-line body was measured (while authoring the
// sibling shell test) to report as D+A, never R, once a footer is appended.
//
// Fixture roots come from mkProcessTmpDir: the acceptance runner has no
// Vitest afterEach, and a scenario's root is needed across multiple steps
// (Given builds the repo, When runs the guard, Then asserts), so no single
// step can safely clean up early either. Removal is registered on process
// exit instead - no prefix-glob sweep anywhere (BL-1385/BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1403 The merge-deletion guard never reports a move and never refuses unexemptably';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_merge_deletion.sh');

const INTAKE_BODY = `# Operator intake

Filed via Telegram.

The human asked whether the spec-tree console's live view could support a
text filter across milestones, since scrolling through the whole tree on a
phone screen is unusable once a few dozen tickets accumulate. This would
mirror an existing filter already used elsewhere in the console.

No further detail was given; the specifier is expected to scope the exact
slice at mint time.
`;

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const root = mkProcessTmpDir('bl1403acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'INTAKE-x.md'), INTAKE_BODY);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'Operator: file a question as raw intake for the swarm']);
  return root;
}

function ensureCtx(ctx) {
  if (!ctx.bl1403) {
    ctx.bl1403 = { root: makeRepo() };
  }
  return ctx.bl1403;
}

function startIncomingBranch(state) {
  git(state.root, ['checkout', '-q', '-b', 'incoming']);
}

function mergeIncomingNoCommit(state) {
  git(state.root, ['checkout', '-q', 'main']);
  execFileSync('git', ['merge', '--no-ff', '--no-commit', 'incoming'], { cwd: state.root, encoding: 'utf8' });
}

function runGuard(root, message) {
  const msgFile = path.join(root, 'msg.txt');
  fs.writeFileSync(msgFile, message);
  try {
    const out = execFileSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
    return { allowed: true, output: out };
  } catch (err) {
    return { allowed: false, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const HOW_MAP = new Map([
  ['unchanged', false],
  ['with a footer appended', true],
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository whose first branch committed a raw intake with a subject naming no ticket$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the incoming branch moved the intake into the archive (.+)$/, (ctx, how) => {
    const state = ensureCtx(ctx);
    assert.ok(HOW_MAP.has(how), `unknown Example "${how}" - the handler knows ${[...HOW_MAP.keys()]}`);
    startIncomingBranch(state);
    fs.mkdirSync(path.join(state.root, 'backlog', 'archive'), { recursive: true });
    git(state.root, ['mv', 'backlog/INTAKE-x.md', 'backlog/archive/INTAKE-x.md']);
    if (HOW_MAP.get(how)) {
      fs.appendFileSync(path.join(state.root, 'backlog', 'archive', 'INTAKE-x.md'), '\nArchived by the specifier drain.\n');
      git(state.root, ['add', '-A']);
    }
    git(state.root, ['commit', '-q', '-m', 'Mint BL-9009: archive its intake']);
    mergeIncomingNoCommit(state);
  });

  scoped(/^the incoming branch deleted the intake in a commit naming ticket "([^"]+)"$/, (ctx, ticketId) => {
    const state = ensureCtx(ctx);
    startIncomingBranch(state);
    git(state.root, ['rm', '-q', 'backlog/INTAKE-x.md']);
    git(state.root, ['commit', '-q', '-m', `Mint ${ticketId}: archive its intake`]);
    mergeIncomingNoCommit(state);
  });

  scoped(/^the incoming branch deleted the intake in a commit naming no ticket$/, (ctx) => {
    const state = ensureCtx(ctx);
    startIncomingBranch(state);
    git(state.root, ['rm', '-q', 'backlog/INTAKE-x.md']);
    git(state.root, ['commit', '-q', '-m', 'chore: remove a stale intake file']);
    mergeIncomingNoCommit(state);
  });

  scoped(/^the merge commit message names no ticket$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.result = runGuard(state.root, 'merge, no ticket named');
  });

  scoped(/^the merge commit message names "([^"]+)"$/, (ctx, ticketId) => {
    const state = ensureCtx(ctx);
    state.result = runGuard(state.root, `${ticketId}: deliberate removal`);
  });

  scoped(/^the merge commit is allowed$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(state.result.allowed, `expected the merge to be allowed: ${state.result.output}`);
  });

  scoped(/^the merge commit is refused$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(!state.result.allowed, `expected the merge to be refused: ${state.result.output}`);
  });

  scoped(/^the refusal names ticket "([^"]+)" and the deleting commit$/, (ctx, ticketId) => {
    const state = ensureCtx(ctx);
    assert.match(state.result.output, new RegExp(ticketId), `refusal must name ${ticketId}: ${state.result.output}`);
    assert.match(state.result.output, /introduced at [0-9a-f]{7,10}/, `refusal must name the deleting commit: ${state.result.output}`);
  });

  scoped(/^the refusal does not say unattributed$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.doesNotMatch(state.result.output, /\(unattributed\)/i, `refusal must not be unattributed: ${state.result.output}`);
  });

  scoped(/^the refusal says unattributed$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.match(state.result.output, /\(unattributed\)/i, `refusal must say unattributed: ${state.result.output}`);
  });
}

module.exports = { registerSteps };
