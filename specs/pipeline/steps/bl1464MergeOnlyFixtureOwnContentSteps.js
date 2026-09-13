'use strict';

// BL-1464: step handlers for "BL-1297's merge-only fixture merges the
// parcel's own content, so its scenario tests what it says".
//
// Scenario 01 runs BL-1297's whole feature end-to-end via run_acceptance.sh -
// proving the fix through the real acceptance pipeline, not a JS restatement
// of it. Scenarios 02-03 drive the REAL land_step_lib.bb against the SAME
// fixture builders BL-1297's own handler exports (never a second copy of
// them): 02 asks what the FIXED fixture's tip attributes, 03 asks about the
// OLD (foreign) shape `mergeParcelIn` still builds for scenario 01/05, kept
// as the explicit refusal case this ticket's fix does not touch. Scenario 04
// reads the standing-red register directly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  git,
  bb,
  initRepo,
  cleanup,
  mergeParcelIn,
  mergeOwnParcelIn,
  PARCEL_PATH,
} = require('./bl1297MergeCommitOwnPathsSteps');

const FEATURE = "BL-1464 BL-1297's merge-only fixture merges the parcel's own content, so its scenario tests what it says";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL1297_FEATURE = path.join(
  REPO_ROOT, 'specs', 'features', 'BL-1297-a-merge-commits-own-paths-are-not-empty.feature'
);
const STANDING_REDS = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');
const TASK_ID = 'BL-1174';

function tapCounts(out) {
  const pass = /^# pass (\d+)/m.exec(out);
  const fail = /^# fail (\d+)/m.exec(out);
  return { pass: pass ? Number(pass[1]) : null, fail: fail ? Number(fail[1]) : null };
}

// The entangling commit BL-1297's own scenario 03 fixture appends so the tip
// differs from origin/main and the land step reaches its replay decision -
// shared verbatim so scenario 02 asks about the EXACT tip scenario 03 builds.
function entangle(ctx) {
  git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'BL-1185: a sibling ticket, unlanded');
  ctx.commit = git(ctx.root, 'rev-parse', 'HEAD').trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^the BL-1297 feature runs from the repository$/, (ctx) => {
    try {
      ctx.result = { out: execFileSync(RUN_ACCEPTANCE, [BL1297_FEATURE], { encoding: 'utf8' }), code: 0 };
    } catch (e) {
      ctx.result = { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status };
    }
  });

  scoped(/^all six of its scenarios pass$/, (ctx) => {
    const { pass, fail } = tapCounts(ctx.result.out);
    assert.equal(pass, 6, `expected all 6 of BL-1297's scenarios to pass, got: ${ctx.result.out}`);
    assert.equal(fail, 0, `expected 0 failing BL-1297 scenarios, got: ${ctx.result.out}`);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^the fixture repository BL-1297's third scenario builds$/, (ctx) => {
    initRepo(ctx);
    mergeOwnParcelIn(ctx, PARCEL_PATH);
    entangle(ctx);
  });

  scoped(/^the land step attributes the tip's delivered paths$/, (ctx) => {
    const raw = bb(`
(require '[cheshire.core :as json])
(load-file ${JSON.stringify(LAND_LIB)})
(let [attribution (land-step-lib/delivered-attribution ${JSON.stringify(ctx.root)} ${JSON.stringify(ctx.base)} ${JSON.stringify(ctx.commit)})]
  (print (json/generate-string
          (into {} (for [[path {:keys [owners any-untagged?]}] attribution]
                     [path {:owners (vec (sort owners)) :anyUntagged any-untagged?}])))))`);
    ctx.attribution = JSON.parse(raw);
  });

  scoped(/^no delivered path is owned solely by an unlanded sibling$/, (ctx) => {
    const owningSiblingOnly = Object.entries(ctx.attribution).filter(([, v]) => (
      v.owners.length === 1 && v.owners[0] === 'BL-9999' && !v.anyUntagged
    ));
    assert.deepEqual(
      owningSiblingOnly,
      [],
      `expected no delivered path owned solely by the unlanded sibling: ${JSON.stringify(ctx.attribution)}`
    );
    assert.ok(
      Object.keys(ctx.attribution).includes(PARCEL_PATH),
      `expected the parcel's own path in the delivered set: ${JSON.stringify(ctx.attribution)}`
    );
    assert.deepEqual(
      ctx.attribution[PARCEL_PATH].owners,
      [TASK_ID],
      `expected the parcel's own path credited to the task itself, not a sibling: ${JSON.stringify(ctx.attribution)}`
    );
    cleanup(ctx);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(
    /^a fixture repository whose parcel's only attributed commit merges content authored under an unlanded sibling's id$/,
    (ctx) => {
      initRepo(ctx);
      mergeParcelIn(ctx, PARCEL_PATH);
      entangle(ctx);
    }
  );

  scoped(/^the land step plans the parcel's tip$/, (ctx) => {
    ctx.plan = bb(`
(load-file ${JSON.stringify(LAND_LIB)})
(print (pr-str (land-step-lib/land-plan {:root ${JSON.stringify(ctx.root)}
                                         :commit ${JSON.stringify(ctx.commit)}
                                         :task-ticket-id ${JSON.stringify(TASK_ID)}})))`);
  });

  scoped(/^it escalates saying nothing of the ticket's own contribution is left to land$/, (ctx) => {
    assert.ok(ctx.plan.includes(':action :escalate'), `expected an escalate, got: ${ctx.plan}`);
    assert.ok(
      ctx.plan.includes('nothing of this ticket\'s own contribution to land'),
      `expected the BL-1343 refusal text, got: ${ctx.plan}`
    );
    cleanup(ctx);
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────────
  scoped(/^the fix is on main$/, () => {
    // Framing only - the Then step reads the live register file.
  });

  scoped(/^backlog\/standing-reds\.tsv carries no row for BL-1297's feature file$/, () => {
    const rows = fs.readFileSync(STANDING_REDS, 'utf8').split('\n');
    const stale = rows.filter((row) => row.includes('BL-1297-a-merge-commits-own-paths-are-not-empty.feature'));
    assert.deepEqual(stale, [], `expected no standing-red row for BL-1297's feature, found: ${stale.join('\n')}`);
  });
}

module.exports = { registerSteps };
