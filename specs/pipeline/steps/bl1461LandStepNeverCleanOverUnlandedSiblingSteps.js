'use strict';

// BL-1461: the land step's candidate walk must cover the WHOLE
// origin-main..commit range, not just the parcel's last recorded hop - a
// sibling absorbed before the first hop or between hops is entangled
// exactly like one absorbed after the last hop (BL-1446 kept landed
// history out of the SAME walk; this is the other direction). Drives the
// real `land_step_cli.bb` CLI, never a reimplementation of land-plan.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  REPO_ROOT,
  STAGE_FILES,
  git,
  commit,
  initRepo,
  markOriginMainHere,
  recordHandoff,
  mkTmpDir,
} = require('./lib/bl1446LandFixture');

const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const SIBLING_FILE = 'backlog/active/BL-9002-x.yaml';

const FEATURE = 'BL-1461 The land step never calls a tip clean while an unlanded sibling sits anywhere in its unlanded history';

const POSITION_KEYS = {
  "before the parcel's first hop": 'before-first',
  "between the parcel's cleaner and architect hops": 'between',
  "after the parcel's last hop": 'after-last',
};

// Five BL-9001 stage commits (coder..documenter) with the sibling ticket's
// own commit inserted at `position`, the last hop recorded exactly like a
// real handoff archive. `landed` moves origin/main's own ref onto the
// sibling's commit (BL-1446 invariant 1: never a candidate regardless of
// position); omitted, origin/main never advances past the fixture seed, so
// the sibling is genuinely unlanded.
function buildFixtureWithSibling(ctx, positionKey, landed) {
  ctx.root = mkTmpDir('bl1461-fixture-');
  initRepo(ctx.root);
  ctx.seed = markOriginMainHere(ctx.root);
  const roles = ['coder', 'cleaner', 'architect', 'hardener', 'documenter'];
  let siblingCommit;
  let tip;

  const commitSibling = () => {
    siblingCommit = commit(ctx.root, SIBLING_FILE, 'id: BL-9002\n', 'BL-9002: sibling ticket');
  };

  if (positionKey === 'before-first') {
    commitSibling();
  }
  STAGE_FILES.forEach((file, i) => {
    tip = commit(ctx.root, file, 'id: BL-9001\n', `BL-9001: ${roles[i]}`);
    // Between the cleaner (index 1) and architect (index 2) hops.
    if (positionKey === 'between' && i === 1) {
      commitSibling();
    }
  });
  if (positionKey === 'after-last') {
    // Independent line off the seed, merged into the QA tip AFTER the
    // documenter's own commit - BL-1446 scenario 02's exact shape.
    git(ctx.root, 'checkout', '-q', ctx.seed);
    commitSibling();
    git(ctx.root, 'checkout', '-q', tip);
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge sibling into QA.', siblingCommit);
    tip = git(ctx.root, 'rev-parse', 'HEAD');
  }

  ctx.documenterTip = tip;
  recordHandoff(ctx.root, 'BL-9001-fixture', ctx.documenterTip);
  if (landed) {
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', siblingCommit);
  }
  ctx.siblingCommit = siblingCommit;
}

function runLandStepCli(ctx) {
  const result = require('node:child_process').spawnSync(
    'bb',
    [CLI, 'BL-9001-fixture', ctx.documenterTip, ctx.root],
    { encoding: 'utf8' },
  );
  ctx.cliResult = result;
  return result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a main branch, and a shared batch-role branch carrying a parcel's five stage commits with the parcel's last hop recorded in the handoff archive$/,
    (ctx) => {
      // Deferred: the sibling's POSITION (the next Given) decides where in
      // this same construction its commit lands, so building happens
      // there - never a rebuild, never two different fixtures disagreeing
      // on shape.
      ctx.backgroundPending = true;
    },
  );

  scoped(/^a sibling ticket's commit sits (.+) and is not reachable from origin\/main$/, (ctx, position) => {
    assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
    const key = POSITION_KEYS[position];
    assert.ok(key, `bl1461: unrecognized position "${position}"`);
    buildFixtureWithSibling(ctx, key, false);
  });

  scoped(/^a sibling ticket's commit sits (.+) and is reachable from origin\/main$/, (ctx, position) => {
    assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
    const key = POSITION_KEYS[position];
    assert.ok(key, `bl1461: unrecognized position "${position}"`);
    buildFixtureWithSibling(ctx, key, true);
  });

  scoped(/^the land step plans the parcel's tip$/, (ctx) => {
    runLandStepCli(ctx);
  });

  scoped(/^the land step plans and builds the replay for the parcel's tip$/, (ctx) => {
    runLandStepCli(ctx);
  });

  scoped(/^the verdict is LAND_REPLAY naming the sibling as unlanded$/, (ctx) => {
    const { stdout, stderr, status } = ctx.cliResult;
    assert.equal(status, 0, `expected exit 0, got ${status}: ${stdout}${stderr}`);
    assert.match(stdout, /^LAND_REPLAY /m, `expected a LAND_REPLAY line, got:\n${stdout}`);
    assert.match(stdout, /^ENTANGLED_SIBLING BL-9002$/m, `expected ENTANGLED_SIBLING BL-9002, got:\n${stdout}`);
  });

  scoped(/^the verdict is LAND_CLEAN$/, (ctx) => {
    const { stdout, stderr, status } = ctx.cliResult;
    assert.equal(status, 0, `expected exit 0, got ${status}: ${stdout}${stderr}`);
    assert.match(stdout, /^LAND_CLEAN /m, `expected a LAND_CLEAN line, got:\n${stdout}`);
  });

  scoped(
    /^the replay tip carries every path the five stage commits changed, byte-identical to the cited tip$/,
    (ctx) => {
      const match = /^LAND_REPLAY (\S+) (\S+)$/m.exec(ctx.cliResult.stdout);
      assert.ok(match, `expected a LAND_REPLAY line, got:\n${ctx.cliResult.stdout}`);
      const [, , replayCommit] = match;
      for (const file of STAGE_FILES) {
        const cited = git(ctx.root, 'show', `${ctx.documenterTip}:${file}`);
        const replayed = git(ctx.root, 'show', `${replayCommit}:${file}`);
        assert.equal(replayed, cited, `expected ${file} in the replay tip to be byte-identical to the cited tip`);
      }
    },
  );

  scoped(/^the replay tip carries no path the sibling's commit changed$/, (ctx) => {
    const match = /^LAND_REPLAY (\S+) (\S+)$/m.exec(ctx.cliResult.stdout);
    assert.ok(match, `expected a LAND_REPLAY line, got:\n${ctx.cliResult.stdout}`);
    const [, , replayCommit] = match;
    const result = require('node:child_process').spawnSync(
      'git', ['-C', ctx.root, 'cat-file', '-e', `${replayCommit}:${SIBLING_FILE}`],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, `expected ${SIBLING_FILE} to be ABSENT from the replay tip`);
  });
}

module.exports = { registerSteps };
