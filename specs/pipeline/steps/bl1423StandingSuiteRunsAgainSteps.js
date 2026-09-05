'use strict';

// BL-1423: step handlers for "the standing Babashka suite runs again".
// Every scenario reads the PARCEL's own tracked swarmforge/scripts/test
// tree and suite-manifest.tsv via lib/bl1423StandingSuiteRunsAgainCli.sh,
// which runs the real suite_inventory_cli.bb and run_bb_suite.sh --list -
// never a reimplementation, and never a fixture copy (the tree at this
// commit is the contract, per the ticket's own framing).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "BL-1423 The standing Babashka suite runs again: the two hotfix test files are registered";
const CLI = path.join(__dirname, 'lib', 'bl1423StandingSuiteRunsAgainCli.sh');

function run(...args) {
  const out = execFileSync('bash', [CLI, ...args], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the parcel's own swarmforge\/scripts\/test tree and its suite-manifest\.tsv$/, (ctx) => {
    ctx.bl1423 = {};
  });

  // ── 01 ──────────────────────────────────────────────────────────────
  scoped(/^suite_inventory_cli\.bb is run against that tree$/, (ctx) => {
    ctx.bl1423.inventory = run('inventory');
  });

  scoped(/^it exits 0 reporting no problems$/, (ctx) => {
    const { inventory } = ctx.bl1423;
    assert.equal(inventory.exitCode, 0, `expected exit 0, got: ${JSON.stringify(inventory)}`);
    assert.match(inventory.output, /^suite inventory: ok/, `expected a clean inventory report, got: ${inventory.output}`);
  });

  // ── 02 (Scenario Outline) ───────────────────────────────────────────
  scoped(/^the manifest rows naming (.+) are collected$/, (ctx, file) => {
    ctx.bl1423.file = file;
    ctx.bl1423.result = run('rows-for', file);
  });

  scoped(/^there is exactly one such row$/, (ctx) => {
    assert.equal(ctx.bl1423.result.rows.length, 1, `expected exactly one row for ${ctx.bl1423.file}, got: ${JSON.stringify(ctx.bl1423.result.rows)}`);
  });

  scoped(/^its lane is standing with an empty date and an empty reason$/, (ctx) => {
    const [row] = ctx.bl1423.result.rows;
    assert.equal(row.lane, 'standing', `expected lane standing, got: ${JSON.stringify(row)}`);
    assert.equal(row.date, '', `expected an empty date, got: ${JSON.stringify(row)}`);
    assert.equal(row.reason, '', `expected an empty reason, got: ${JSON.stringify(row)}`);
  });

  scoped(/^run_bb_suite\.sh --list names (.+)$/, (ctx, file) => {
    assert.equal(file, ctx.bl1423.file, `Then's file (${file}) must match the When's file (${ctx.bl1423.file})`);
    assert.equal(ctx.bl1423.result.listed, true, `expected run_bb_suite.sh --list to name ${file}, got: ${JSON.stringify(ctx.bl1423.result)}`);
  });
}

module.exports = { registerSteps };
