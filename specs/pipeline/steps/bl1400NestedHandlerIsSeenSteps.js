'use strict';

// BL-1400: the registration guard sees a handler nested in a subdirectory.
//
// Every scenario builds a REAL scratch git repository on `main` and runs the
// REAL guard (swarmforge/scripts/check_feature_handler_registration.sh)
// against it - the same shape BL-1303's own handler uses, because "the
// handler sits in a subdirectory" is a statement about a tree on disk and
// nothing short of a real tree can be wrong about it.
//
// The guard resolves its checker from its OWN checkout, so a scratch repo
// needs no compiled extension of its own.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_feature_handler_registration.sh');

const FEATURE = 'BL-1400 The registration guard sees a nested handler';

const FEATURES_DIR = 'specs/features';
const STEPS_DIR = 'specs/pipeline/steps';
const REGISTRY = `${STEPS_DIR}/index.js`;
const LIB_DIR = `${STEPS_DIR}/lib`;
const FIXTURE_PREFIX = 'bl1400-';

// The Scenario Outline's relations, explicit rather than passed through: a
// relation the feature invents that this handler cannot build must fail
// loudly.
const KNOWN_RELATIONS = ['a top-level handler requires', 'no handler requires'];

// A leaked GIT_DIR/GIT_WORK_TREE would point every scratch repo's git at
// whatever repository this run was launched from.
function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitEnv() });
}

function state(ctx) {
  if (!ctx.bl1400) {
    ctx.bl1400 = {};
  }
  return ctx.bl1400;
}

function buildRepo(s) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  fs.mkdirSync(path.join(repo, FEATURES_DIR), { recursive: true });
  fs.mkdirSync(path.join(repo, LIB_DIR), { recursive: true });
  fs.writeFileSync(path.join(repo, s.feature), `Feature: fixture ${s.ticket}\n`, 'utf8');

  const requires = [];
  if (s.helper) {
    fs.writeFileSync(path.join(repo, `${LIB_DIR}/${s.helper}`), 'module.exports = {};\n', 'utf8');
  }
  const handlerBody =
    s.helperRequiredByHandler === true
      ? `require('./lib/${s.helper.replace(/\.js$/, '')}');\nmodule.exports = { registerSteps() {} };\n`
      : 'module.exports = { registerSteps() {} };\n';
  fs.mkdirSync(path.dirname(path.join(repo, s.handler)), { recursive: true });
  fs.writeFileSync(path.join(repo, s.handler), handlerBody, 'utf8');

  // The registry is discovery-era (BL-1371): it names nothing, so a top-level
  // `*Steps.js` is registered by existing and a nested one is not registered
  // at all - which is precisely the state under test.
  fs.writeFileSync(path.join(repo, REGISTRY), `const DOMAINS = [\n${requires.join('\n')}\n];\n`, 'utf8');

  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture');
  return repo;
}

function runGuard(repo, ...flags) {
  const result = spawnSync('bash', [GUARD, repo, ...flags], { encoding: 'utf8', env: gitEnv() });
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a scratch tree with a feature file for ticket "([^"]+)"$/, (ctx, ticket) => {
    const s = state(ctx);
    s.ticket = ticket;
    s.feature = `${FEATURES_DIR}/${ticket}-x.feature`;
    s.handlerName = `bl${ticket.slice('BL-'.length)}XSteps.js`;
  });

  scoped(/^the feature's only handler sits in a subdirectory of the steps directory$/, (ctx) => {
    state(ctx).handler = `${STEPS_DIR}/nested/${state(ctx).handlerName}`;
  });

  scoped(/^the feature's only handler sits at the top of the steps directory$/, (ctx) => {
    state(ctx).handler = `${STEPS_DIR}/${state(ctx).handlerName}`;
  });

  scoped(/^a helper under the steps lib directory that (.+)$/, (ctx, relation) => {
    assert.ok(KNOWN_RELATIONS.includes(relation), `unknown helper relation "${relation}" - known: ${KNOWN_RELATIONS.join(', ')}`);
    const s = state(ctx);
    // Named for the SAME ticket the feature declares: a helper whose name
    // would make it look like that feature's handler is exactly the file
    // invariant 2 forbids turning into an offender.
    s.helper = `bl${s.ticket.slice('BL-'.length)}XHelper.js`;
    s.helperRequiredByHandler = relation === 'a top-level handler requires';
  });

  scoped(/^the registration guard examines the tree$/, (ctx) => {
    const s = state(ctx);
    const repo = buildRepo(s);
    try {
      s.result = runGuard(repo);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  scoped(/^the registration guard examines the live tree$/, (ctx) => {
    // --assume-main, or this scenario would pass on the branch name alone:
    // the guard is silent off `main`, and every role's worktree IS off main.
    // A vacuous green here is exactly the shape this ticket is about.
    state(ctx).result = runGuard(REPO_ROOT, '--assume-main');
  });

  scoped(/^the guard refuses$/, (ctx) => {
    assert.equal(state(ctx).result.status, 1, `expected a refusal, got:\n${state(ctx).result.out}`);
  });

  scoped(/^the guard passes$/, (ctx) => {
    const { status, out } = state(ctx).result;
    assert.equal(status, 0, `expected a pass, got status ${status}:\n${out}`);
  });

  scoped(/^its output names the nested handler and the feature$/, (ctx) => {
    const s = state(ctx);
    assert.match(s.result.out, new RegExp(`nested/${s.handlerName.replace('.', '\\.')}`));
    assert.match(s.result.out, new RegExp(`${s.ticket}-x\\.feature`));
  });
}

module.exports = { registerSteps };
