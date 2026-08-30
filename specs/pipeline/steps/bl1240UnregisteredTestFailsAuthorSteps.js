'use strict';

// BL-1240: step handlers for "An unregistered test file fails the ticket that
// adds it". Every scenario drives the REAL send path - swarm_handoff.sh over
// a real git fixture, via lib/bl1240UnregisteredTestGateCli.sh - never the
// gate lib in isolation. A gate that decides correctly and is not wired in
// refuses nothing, and a scenario that called the decision directly would
// report green for exactly that: the shape BL-1235's architect bounce caught
// the same day this was written.
//
// Scenario 04 is the one exception and deliberately so: "the manifest is
// validated" is suite_inventory_cli.bb, so that scenario runs the real CLI.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'An unregistered test file fails the ticket that adds it';
const CLI = path.join(__dirname, 'lib', 'bl1240UnregisteredTestGateCli.sh');

// The file the fixture's parcel adds, and the one an EARLIER parcel left
// unregistered in the tree. Scenario 03 is only meaningful if the two are
// different files, so they are named here rather than matched loosely.
const PARCEL_FILE = 'test_bl9240_new.sh';
const SOMEONE_ELSES_FILE = 'test_bl9999_someone_elses.sh';

function run(mode) {
  const out = execFileSync('bash', [CLI, mode], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a parcel that is ready to move to the next stage$/, (ctx) => {
    ctx.bl1240 = {};
  });

  scoped(/^the parcel adds a file under the test directory$/, (ctx) => {
    ctx.bl1240.addsTestFile = true;
  });

  scoped(/^the parcel adds no file under the test directory$/, (ctx) => {
    ctx.bl1240.addsTestFile = false;
  });

  scoped(/^that file has no row in the suite manifest$/, (ctx) => {
    ctx.bl1240.mode = 'unregistered';
  });

  scoped(/^that file has a row in the suite manifest$/, (ctx) => {
    ctx.bl1240.mode = 'registered';
  });

  // Scenario 03's load-bearing Given: the tree is dirty with somebody else's
  // omission on every run of this feature, so "the forward proceeds" below is
  // a claim about parcel scope, not about a clean tree.
  scoped(/^test files added by earlier parcels are unregistered$/, (ctx) => {
    ctx.bl1240.mode = 'clean';
    ctx.bl1240.expectUntouchedDrift = true;
  });

  scoped(/^the parcel is forwarded$/, (ctx) => {
    const st = ctx.bl1240;
    assert.ok(st.mode, 'the scenario set no fixture mode');
    st.result = run(st.mode);
  });

  scoped(/^the forward is refused$/, (ctx) => {
    const { result } = ctx.bl1240;
    assert.notEqual(result.exitCode, 0, `expected the forward refused, got: ${JSON.stringify(result)}`);
    // Refused means not sent. A gate that printed a complaint and delivered
    // anyway would leave the omission exactly where it was.
    assert.equal(result.delivered, false, `expected no delivery on refusal, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the forward proceeds$/, (ctx) => {
    const st = ctx.bl1240;
    assert.equal(st.result.exitCode, 0, `expected the forward to proceed, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.delivered, true, `expected delivery, got: ${JSON.stringify(st.result)}`);
    if (st.expectUntouchedDrift) {
      assert.ok(
        !st.result.stderr.includes(SOMEONE_ELSES_FILE),
        `the gate is tree-scoped: it complained about another parcel's file: ${st.result.stderr}`
      );
    }
  });

  scoped(/^the refusal names the file and the row it needs$/, (ctx) => {
    const { result } = ctx.bl1240;
    assert.ok(result.stderr.includes(PARCEL_FILE), `the refusal does not name the file: ${result.stderr}`);
    assert.ok(
      result.stderr.includes('suite-manifest.tsv'),
      `the refusal does not name the manifest: ${result.stderr}`
    );
    // The row itself, tab-separated and ready to paste - the whole reason for
    // moving the check to the author is that acting on it is one edit.
    assert.ok(
      result.stderr.includes(`${PARCEL_FILE}\tstanding`),
      `the refusal does not quote the row the file needs: ${result.stderr}`
    );
    // ...and it does not decide the lane on the author's behalf.
    assert.ok(result.stderr.includes('excluded'), `the refusal offers no exclusion lane: ${result.stderr}`);
  });

  // ── scenario 04 ─────────────────────────────────────────────────────────

  scoped(/^a manifest row whose first column names no file under the test directory$/, (ctx) => {
    ctx.bl1240.mode = 'validate';
  });

  scoped(/^the manifest is validated$/, (ctx) => {
    ctx.bl1240.result = run('validate');
  });

  scoped(/^the validation fails and names that row$/, (ctx) => {
    const { result } = ctx.bl1240;
    assert.notEqual(result.exitCode, 0, `the validation passed a row that registers nothing: ${JSON.stringify(result)}`);
    const output = `${result.stderr}${result.stdout}`;
    assert.ok(output.includes('BL-9240'), `the validation does not name the row: ${output}`);
    // Named as malformed, not as a missing file: "restore the file" would
    // send the reader hunting for a file that never existed.
    assert.ok(
      output.includes('not a test file name'),
      `the row is reported as a missing file rather than a malformed row: ${output}`
    );
  });
}

module.exports = { registerSteps };
