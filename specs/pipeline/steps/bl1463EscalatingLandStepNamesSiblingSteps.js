'use strict';

// BL-1463: step handlers for "an escalating land step still names the
// sibling it could not read". Scenarios 01/03 reuse BL-1272's own
// FIXTURE_CLI (real bare origin, real land_step_cli.bb, the same
// tree-object deletion that produces a genuinely unreadable attribution)
// rather than a second implementation of that fixture shape. Scenario 02
// drives the real land_step_cli.bb over simpler synthetic repos for the
// two no-evidence escalate reasons.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1463 An escalating land step still names the sibling it could not read';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1272LandStepFixtureCli.sh');
const LAND_STEP_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const STANDING_REDS_TSV = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');
const BL1272_FEATURE_REL = 'specs/features/BL-1272-a-landed-sibling-is-not-reported-as-entangled.feature';

const SIBLING = 'BL-9002';

function runBl1272Fixture(state) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1463-'));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, state], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300_000 });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function runLandStepCli(taskName, commit, root) {
  const result = require('node:child_process').spawnSync('bb', [LAND_STEP_CLI, taskName, commit, root], { encoding: 'utf8' });
  return { exit: result.status, out: (result.stdout || '') + (result.stderr || '') };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a main branch, and a parcel tip whose ancestry carries a sibling ticket's commit$/,
    (ctx) => {
      // Deferred: the sibling's evidence state (the next Given) decides
      // which fixture this Background actually builds - never a rebuild.
      ctx.backgroundPending = true;
    },
  );

  scoped(/^the sibling's attributed content is unreadable on origin\/main$/, (ctx) => {
    assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
    ctx.report = runBl1272Fixture('unreadable');
  });

  scoped(/^the land step escalates because (.+)$/, (ctx, reason) => {
    assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1463-noevidence-'));
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'f.txt'), 'x\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'seed');
    const tip = git(root, 'rev-parse', 'HEAD');
    ctx.root = root;

    if (reason === 'the task name names no ticket id') {
      ctx.report = runLandStepCli('no-ticket-task', tip, root);
    } else if (reason === 'origin/main cannot be resolved') {
      // No refs/remotes/origin/main at all - origin-main-sha resolves nil.
      ctx.report = runLandStepCli('BL-9001-fixture', tip, root);
    } else {
      throw new Error(`bl1463: unrecognized escalate reason "${reason}"`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  scoped(/^the land step CLI plans the parcel's tip$/, () => {
    // Already run by the Given step above (the fixture script or the
    // synthetic repo runs the real CLI as part of building its evidence) -
    // nothing further to do; kept as its own step for Gherkin readability.
  });

  scoped(/^the land step plans the parcel's tip$/, () => {
    // Same as above - scenario 03 reuses the unreadable-attribution report
    // already captured.
  });

  scoped(/^it prints LAND_ESCALATE$/, (ctx) => {
    assert.equal(ctx.report.exit, 1, `expected exit 1, got: ${JSON.stringify(ctx.report)}`);
    assert.match(ctx.report.out, /^LAND_ESCALATE$/m, `expected a LAND_ESCALATE line, got:\n${ctx.report.out}`);
  });

  scoped(/^it prints an ENTANGLED_SIBLING line naming the sibling$/, (ctx) => {
    assert.match(
      ctx.report.out, new RegExp(`^ENTANGLED_SIBLING ${SIBLING}$`, 'm'),
      `expected ENTANGLED_SIBLING ${SIBLING}, got:\n${ctx.report.out}`,
    );
  });

  scoped(/^its entanglement note names the sibling as unlanded$/, (ctx) => {
    assert.match(
      ctx.report.out, /entangled tip - sibling ticket\(s\)/,
      `expected an entanglement note, got:\n${ctx.report.out}`,
    );
    const noteLine = ctx.report.out.split('\n').find((l) => /entangled tip - sibling ticket\(s\)/.test(l));
    assert.ok(noteLine && noteLine.includes(SIBLING), `the note does not name ${SIBLING}: ${noteLine}`);
  });

  scoped(/^it prints LAND_ESCALATE and no ENTANGLED_SIBLING line$/, (ctx) => {
    assert.equal(ctx.report.exit, 1, `expected exit 1, got: ${JSON.stringify(ctx.report)}`);
    assert.match(ctx.report.out, /^LAND_ESCALATE$/m, `expected a LAND_ESCALATE line, got:\n${ctx.report.out}`);
    assert.doesNotMatch(ctx.report.out, /^ENTANGLED_SIBLING /m, `expected no ENTANGLED_SIBLING line, got:\n${ctx.report.out}`);
  });

  scoped(/^the plan's action is escalate, never replay$/, (ctx) => {
    assert.equal(ctx.report.action, 'LAND_ESCALATE', `expected LAND_ESCALATE, got: ${JSON.stringify(ctx.report)}`);
  });

  scoped(/^the fix is on main$/, (ctx) => {
    ctx.onMain = true;
  });

  scoped(/^backlog\/standing-reds\.tsv carries no row for BL-1272's feature file$/, () => {
    const text = fs.readFileSync(STANDING_REDS_TSV, 'utf8');
    assert.ok(!text.includes(BL1272_FEATURE_REL), `expected no standing-reds row for ${BL1272_FEATURE_REL}, got a match`);
  });
}

module.exports = { registerSteps };
