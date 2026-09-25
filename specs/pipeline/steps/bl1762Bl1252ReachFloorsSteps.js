'use strict';

// BL-1762: step handlers for "bl1252's commit-guard properties reach their
// plan kinds by construction". Same two checks BL-1691's sweep already
// runs (source-text checks for the shared helper's own two call sites,
// then the real census CLI against the real repo tree) - scoped to the
// five bl1252*.property.test.js files this ticket fixes, never a
// reimplementation of BL-1584's classifier.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1762 bl1252's commit-guard properties reach their plan kinds by construction";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CENSUS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'sampled_reach_floor_census_cli.bb');
const BL1252_FILE_PATTERN = /^extension\/test\/bl1252.*\.property\.test\.js$/;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ─────────────────────────────────────────────────────────
  scoped(/^the source of (\S+) is read$/, (ctx, file) => {
    ctx.file = file;
    ctx.source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  });

  scoped(/^it derives a draw count through runsPerCell from helpers\/reachFloors$/, (ctx) => {
    assert.match(
      ctx.source,
      /require\(['"]\.\/helpers\/reachFloors['"]\)/,
      `${ctx.file} does not require ./helpers/reachFloors`
    );
    assert.match(ctx.source, /runsPerCell\(/, `${ctx.file} never calls runsPerCell(`);
  });

  scoped(/^it asserts a reach floor through assertReachFloor from helpers\/reachFloors$/, (ctx) => {
    assert.match(ctx.source, /assertReachFloor\(/, `${ctx.file} never calls assertReachFloor(`);
  });

  // ── Scenario 02 ─────────────────────────────────────────────────────────
  scoped(/^the sampled reach floor census CLI runs$/, (ctx) => {
    const result = spawnSync('bb', [CENSUS_CLI, '.'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, `census CLI failed: ${result.stderr}`);
    ctx.rows = new Map(
      result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [file, verdict] = line.split('\t');
          return [file, verdict];
        })
    );
  });

  scoped(/^it reads every extension\/test\/bl1252\*\.property\.test\.js file as constructed$/, (ctx) => {
    ctx.bl1252Files = [...ctx.rows.keys()].filter((file) => BL1252_FILE_PATTERN.test(file));
    assert.ok(ctx.bl1252Files.length > 0, 'expected at least one bl1252*.property.test.js row from the census');
    for (const file of ctx.bl1252Files) {
      assert.equal(ctx.rows.get(file), 'constructed', `${file} reads "${ctx.rows.get(file)}", expected "constructed"`);
    }
  });

  scoped(/^it reads exactly (\d+) such files$/, (ctx, count) => {
    assert.equal(ctx.bl1252Files.length, Number(count), `expected exactly ${count} bl1252 files, got: ${JSON.stringify(ctx.bl1252Files)}`);
  });
}

module.exports = { registerSteps };
