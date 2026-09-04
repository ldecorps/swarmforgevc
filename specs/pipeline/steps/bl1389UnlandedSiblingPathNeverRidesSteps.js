'use strict';

// BL-1389: a path an unlanded sibling owns alone never rides another ticket's
// land.
//
// The tip-pure replay keeps every delivered path it cannot positively
// attribute to an unlanded sibling. "Unlanded" was decided once per TICKET,
// from the paths the per-SIBLING walk attributed to it - and that walk does not
// see the same set as the per-PATH walk the exclusion itself uses. On
// 2026-09-04 `path-owner-tickets` credited
// specs/pipeline/steps/bl1367ApprovalCarriesItsRulingSteps.js to BL-1367 alone
// with no untagged touch, while BL-1367's per-sibling set was six doc and
// evidence paths that did not contain it. Those six read landed, BL-1367 left
// the unlanded set, and its handler and a source file - neither on origin/main
// - rode into BL-1386's replay under BL-1386's approval. Only QA reading the
// replay diff by hand stopped it, because the report printed 17 landed names,
// 27 entangled ones, and not one path.
//
// Every scenario drives the REAL production entry point,
// swarmforge/scripts/land_step_cli.bb - the CLI QA runs - over a REAL
// repository with a REAL origin/main ref, through
// lib/bl1389UnlandedSiblingPathCli.bb. Never the pure lib functions beneath
// it: the defect is a decision made against a verdict computed elsewhere, and
// a driver that calls one function cannot see the two disagree.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1389UnlandedSiblingPathCli.bb');

const FEATURE =
  "BL-1389 A path an unlanded sibling owns alone never rides another ticket's land";

const SIBLING_HANDLER = 'specs/pipeline/steps/BL-9002SiblingSteps.js';
const SIBLING_SOURCE = 'extension/src/BL-9002-sibling.ts';
const OWN_FILE = 'backlog/active/BL-9001-own.yaml';
const SHARED_PATH = 'docs/reference/shared.md';

function runFixture(shape) {
  const out = execFileSync('bb', [FIXTURE_CLI, shape], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 900_000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^origin\/main holds sibling "(BL-\d+)"'s feature file$/, (ctx) => {
    // The landed path that used to carry the whole ticket-level verdict: a
    // feature file is minted at spec time and lands long before the pipeline
    // work it describes.
    ctx.bl1389 = { shape: 'base' };
  });

  scoped(
    /^the tip carries "(BL-\d+)"'s handler and a source file under commits tagged "(BL-\d+)"$/,
    (ctx) => {
      ctx.bl1389.tipCarriesSiblingWork = true;
    }
  );

  scoped(/^the tip carries landing ticket "(BL-\d+)"'s own files$/, (ctx) => {
    ctx.bl1389.tipCarriesOwnWork = true;
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^"(BL-\d+)" is approved$/, (ctx) => {
    ctx.bl1389.shape = 'approved';
  });

  scoped(/^the tip carries a path both "(BL-\d+)" and "(BL-\d+)" changed$/, (ctx) => {
    // Only ever after the approved Given: BL-1375's passenger rule is about an
    // APPROVED sibling riding on a path the landing ticket also owns.
    ctx.bl1389.shape = 'shared';
  });

  scoped(
    /^origin\/main also holds "(BL-\d+)"'s handler and source file with its own lines$/,
    (ctx) => {
      ctx.bl1389.shape = 'all-landed';
    }
  );

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the land step replays "(BL-\d+)"$/, (ctx) => {
    assert.ok(ctx.bl1389.shape, 'no fixture shape was chosen');
    ctx.bl1389.report = runFixture(ctx.bl1389.shape);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^"(BL-\d+)" reads unlanded$/, (ctx, id) => {
    const { report } = ctx.bl1389;
    assert.ok(
      report.entangled.includes(id),
      `${id} was not reported as an unlanded sibling: ${JSON.stringify(report.lines)}`
    );
    assert.ok(
      !report.landed.some(([landedId]) => landedId === id),
      `${id} was reported landed as well as unlanded: ${JSON.stringify(report.landed)}`
    );
  });

  scoped(/^the replay excludes "(BL-\d+)"'s handler and source file$/, (ctx) => {
    const { report } = ctx.bl1389;
    // Both, and by their absence from the replayed COMMIT - not merely by a
    // line in the report. What lands is the tree, and QA had to diff exactly
    // this to find the defect.
    for (const p of [SIBLING_HANDLER, SIBLING_SOURCE]) {
      assert.ok(
        !report.replayPaths.includes(p),
        `${p} rode into the replay: ${JSON.stringify(report.replayPaths)}`
      );
    }
  });

  scoped(/^the report carries EXCLUDED_SIBLING_PATH for each naming "(BL-\d+)"$/, (ctx, id) => {
    const { report } = ctx.bl1389;
    for (const p of [SIBLING_HANDLER, SIBLING_SOURCE]) {
      assert.ok(
        report.excluded.some(([excludedPath, owner]) => excludedPath === p && owner === id),
        `no EXCLUDED_SIBLING_PATH line names ${p} and ${id}: ${JSON.stringify(report.excluded)}`
      );
    }
  });

  scoped(/^"(BL-\d+)"'s own files are in the replay$/, (ctx) => {
    const { report } = ctx.bl1389;
    assert.ok(
      report.replayPaths.includes(OWN_FILE),
      `the landing ticket's own file did not land: ${JSON.stringify(report.replayPaths)}`
    );
  });

  scoped(/^the shared path is in the replay$/, (ctx) => {
    const { report } = ctx.bl1389;
    assert.ok(
      report.replayPaths.includes(SHARED_PATH),
      `the shared path was dropped, so BL-1375's passenger rule did not survive: ${JSON.stringify(report.replayPaths)}`
    );
  });

  scoped(/^the report names "(BL-\d+)" as a passenger$/, (ctx, id) => {
    assert.ok(
      ctx.bl1389.report.passengers.includes(id),
      `${id} did not ride as a passenger: ${JSON.stringify(ctx.bl1389.report.lines)}`
    );
  });

  scoped(/^the tree guards ran against the replayed tree$/, (ctx) => {
    const { report } = ctx.bl1389;
    // replay! runs the guards ONLY when a passenger actually rides, and a
    // refusal is an escalate rather than a replay - so a passenger line beside
    // a zero exit is the guards having run and passed. Asserted together: the
    // exit alone would also be true of a replay that carried nobody.
    assert.ok(
      report.passengers.length > 0,
      `no passenger rode, so a clean exit proves nothing about the guards: ${JSON.stringify(report.lines)}`
    );
    assert.equal(
      report.exit,
      0,
      `the guards refused the replayed tree: ${JSON.stringify(report.lines)}`
    );
  });

  scoped(/^"(BL-\d+)" reads landed$/, (ctx, id) => {
    const { report } = ctx.bl1389;
    assert.ok(
      report.landed.some(([landedId]) => landedId === id),
      `${id} was not reported as landed: ${JSON.stringify(report.lines)}`
    );
  });

  scoped(/^the LANDED_SIBLING line for "(BL-\d+)" names the path that decided it$/, (ctx, id) => {
    const { report } = ctx.bl1389;
    const row = report.landed.find(([landedId]) => landedId === id);
    assert.ok(row, `${id} is not named as landed at all: ${JSON.stringify(report.landed)}`);
    assert.equal(
      row.length,
      2,
      `the LANDED_SIBLING line names no path, so the verdict still has to be re-derived by hand: ${JSON.stringify(row)}`
    );
    assert.ok(row[1] && row[1].length > 0, `the deciding path is empty: ${JSON.stringify(row)}`);
  });

  scoped(/^every excluded path is named with the sibling it was credited to$/, (ctx) => {
    const { report } = ctx.bl1389;
    // The paths absent from the replay that the report does NOT account for
    // are exactly what a human would have to diff the tip to find.
    assert.ok(report.excluded.length > 0, 'nothing was reported as excluded at all');
    for (const row of report.excluded) {
      assert.equal(row.length, 2, `an EXCLUDED_SIBLING_PATH line names no sibling: ${JSON.stringify(row)}`);
      assert.ok(row[0] && row[1], `an EXCLUDED_SIBLING_PATH line is incomplete: ${JSON.stringify(row)}`);
    }
    for (const p of [SIBLING_HANDLER, SIBLING_SOURCE]) {
      assert.ok(
        report.excluded.some(([excludedPath]) => excludedPath === p),
        `${p} is absent from the replay and unaccounted for in the report: ${JSON.stringify(report.excluded)}`
      );
    }
  });

  scoped(/^every landed sibling is named with its deciding path$/, (ctx) => {
    const { report } = ctx.bl1389;
    for (const row of report.landed) {
      assert.equal(
        row.length,
        2,
        `a LANDED_SIBLING line names no deciding path: ${JSON.stringify(row)}`
      );
    }
  });
}

module.exports = { registerSteps };
