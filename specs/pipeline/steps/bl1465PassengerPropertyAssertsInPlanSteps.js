'use strict';

// BL-1465: step handlers for "BL-1375's passenger property asserts its
// invariant where the landed code now decides it". Drives the REAL
// land_step_lib.bb (land-plan) and check_feature_handler_registration.sh
// against a fixture git repository, and the REAL property test file itself
// for scenario 03 - never a reimplementation of either decision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1465 BL-1375's passenger property asserts its invariant where the landed code now decides it";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const CHECK_FEATURE_HANDLER_REGISTRATION = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_feature_handler_registration.sh');
const ALLOWLIST_TSV = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');
const STANDING_REDS_TSV = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');
const PROPERTY_FILE = path.join(REPO_ROOT, 'extension', 'test', 'bl1375ApprovedSiblingsCanLandInvariants.property.test.js');
const PROPERTY_FILE_REL = 'test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js';

const LANDING = 'BL-9375';
const SIBLING = 'BL-9376';
const SHARED_PATH = 'specs/pipeline/steps/index.js';
const SIBLING_HANDLER = 'specs/pipeline/steps/bl9376FixtureSteps.js';
const SIBLING_LINE = "require('./bl9376FixtureSteps')";
const registry = (lines) => `const DOMAINS = [\n${lines.map((l) => `  ${l},\n`).join('')}];\n`;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}


// The Background: a landing ticket's own work sharing a registry file with
// an approved, unlanded passenger sibling whose registry line reaches for
// a handler file EXCLUDED from the replay (the sibling's own path) - the
// shape that actually froze main (BL-1324).
function buildFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1465-fixture-');
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(root, SHARED_PATH), registry([]));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed the step registry');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  commitFile(root, 'landing/anchor.txt', 'anchor\n', `${LANDING}: anchor path`);
  commitFile(root, SHARED_PATH, registry([`// ${LANDING} line`]), `${LANDING}: own work on the registry`);
  commitFile(
    root,
    SHARED_PATH,
    registry([`// ${LANDING} line`, SIBLING_LINE]),
    `${SIBLING}: the sibling's line in the same file`,
  );
  commitFile(root, SIBLING_HANDLER, 'module.exports = { registerSteps() {} };\n', `${SIBLING}: its own handler file`);

  const activeDir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, `${SIBLING}-fixture.yaml`), `id: ${SIBLING}\nstatus: todo\nhuman_approval: approved\n`);

  ctx.root = root;
  ctx.citedTip = head(root);
}

function putOnMain(root, rel, body) {
  const base = git(root, 'rev-parse', 'refs/remotes/origin/main');
  const index = path.join(root, '.git', 'bl1465-index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const plumb = (args, input) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', input }).trim();
  plumb(['read-tree', base]);
  const blob = plumb(['hash-object', '-w', '--stdin'], body);
  plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
  const tree = plumb(['write-tree']);
  const commit = plumb(['commit-tree', tree, '-p', base, '-m', `main already carries ${rel}`]);
  git(root, 'update-ref', 'refs/remotes/origin/main', commit);
  fs.rmSync(index, { force: true });
}

function landPlan(root, commit) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string (land-step-lib/land-plan {:root "${root}" :commit "${commit}" :task-ticket-id "${LANDING}"})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function registerSteps(registryObj) {
  const scoped = (re, fn) => registryObj.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with a landing ticket, an approved unlanded passenger sibling sharing a path, and the sibling's own handler path excluded from the replay$/,
    (ctx) => {
      buildFixture(ctx);
    },
  );

  scoped(/^the passenger's registry line reaches for a handler file that is on neither the tip nor main$/, (ctx) => {
    // Dangling: buildFixture already leaves it this way - nothing further to do.
  });

  scoped(/^the passenger's handler file is already on main$/, (ctx) => {
    putOnMain(ctx.root, SIBLING_HANDLER, 'module.exports = { registerSteps() {} };\n');
  });

  scoped(/^the land step plans the landing ticket's tip$/, (ctx) => {
    ctx.plan = landPlan(ctx.root, ctx.citedTip);
  });

  scoped(/^the plan's action is escalate$/, (ctx) => {
    assert.equal(ctx.plan.action, 'escalate', `expected escalate, got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^its reason names the passenger and the consistency guard that refused the replayed tree$/, (ctx) => {
    assert.ok(ctx.plan.reason.includes(SIBLING), `reason does not name the passenger: ${ctx.plan.reason}`);
    assert.ok(
      ctx.plan.reason.includes('check_feature_handler_registration.sh'),
      `reason does not name the consistency guard: ${ctx.plan.reason}`,
    );
    assert.ok(
      Array.isArray(ctx.plan.unlanded) && ctx.plan.unlanded.includes(SIBLING),
      `plan.unlanded does not name the passenger: ${JSON.stringify(ctx.plan)}`,
    );
  });

  scoped(/^the plan's action is replay carrying the passenger$/, (ctx) => {
    assert.equal(ctx.plan.action, 'replay', `expected replay, got: ${JSON.stringify(ctx.plan)}`);
    assert.ok(
      Array.isArray(ctx.plan.passengers) && ctx.plan.passengers.includes(SIBLING),
      `plan.passengers does not name the passenger: ${JSON.stringify(ctx.plan)}`,
    );
  });

  scoped(/^the built tip-pure commit passes the same consistency guard$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', ctx.plan.branch);
    const guard = spawnSync('bash', [CHECK_FEATURE_HANDLER_REGISTRATION, ctx.root, '--assume-main'], { encoding: 'utf8' });
    assert.equal(guard.status, 0, `the built tip failed its own guard: ${guard.stdout}${guard.stderr}`);
    git(ctx.root, 'checkout', '-q', ctx.citedTip);
    git(ctx.root, 'branch', '-q', '-D', ctx.plan.branch);
  });

  scoped(/^the bl1375 property file runs alone under the property lane's runner$/, (ctx) => {
    const result = spawnSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE],
      { cwd: path.join(REPO_ROOT, 'extension'), encoding: 'utf8' },
    );
    ctx.vitestResult = result;
  });

  scoped(/^all three invariants pass$/, (ctx) => {
    assert.equal(
      ctx.vitestResult.status, 0,
      `expected the property file to pass, got:\n${ctx.vitestResult.stdout}\n${ctx.vitestResult.stderr}`,
    );
    assert.match(ctx.vitestResult.stdout, /invariant 1:.*✓|✓.*invariant 1/i,
      `expected invariant 1 to report passing:\n${ctx.vitestResult.stdout}`);
  });

  scoped(/^the run exercised at least one dangling and at least one resolved passenger line$/, (ctx) => {
    // The property test's own assertions (reach.dangling > 0, reach.resolved
    // > 0) already fail the run if either corner was never exercised - a
    // green exit here IS that proof, never re-derived from output text.
    assert.equal(ctx.vitestResult.status, 0, 'expected the run to have passed, proving both corners were reached');
  });

  scoped(/^the fix is on main$/, (ctx) => {
    ctx.onMain = true;
  });

  scoped(/^the property allowlist carries no row for the bl1375 property file$/, () => {
    const text = fs.readFileSync(ALLOWLIST_TSV, 'utf8');
    assert.ok(!text.includes(PROPERTY_FILE_REL), `expected no allowlist row for ${PROPERTY_FILE_REL}, got:\n${text}`);
  });

  scoped(/^backlog\/standing-reds\.tsv carries no row for it either$/, () => {
    const text = fs.readFileSync(STANDING_REDS_TSV, 'utf8');
    assert.ok(!text.includes(PROPERTY_FILE_REL), `expected no standing-reds row for ${PROPERTY_FILE_REL}, got a match`);
  });
}

module.exports = { registerSteps };
