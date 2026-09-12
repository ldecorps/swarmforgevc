'use strict';

// BL-1543 acceptance: test_handoffd_master_checkout_drift_wiring.sh (BL-839)
// is re-tensed to the live BL-1139 repair contract and proven against the
// REAL handoffd.bb - never a restatement of what the daemon should do. Every
// verdict here comes from actually running the standing shell suite and
// reading its own stdout, which is itself produced by that suite parsing the
// real daemon's Telegram OPERATOR-topic outbox (JSON-asserted inside the
// suite, not merely grepped) - see the suite's own header for why the
// fixture roots cannot be re-inspected after the run: the suite's own EXIT
// trap removes them before control returns here, which is the very thing
// scenario 02 is proving stays true.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FEATURE_NAME = "BL-1543 The drift wiring test asserts the daemon's live repair contract";

const KNOWN_SUITE = 'swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh';

function knownSuite(file) {
  assert.equal(file, KNOWN_SUITE, `unknown suite example value "${file}"`);
  return file;
}

function runSuite() {
  return spawnSync('bash', [path.join(REPO_ROOT, KNOWN_SUITE)], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 120000,
  });
}

function outputOf(run) {
  return `${run.stdout || ''}${run.stderr || ''}`;
}

function passLines(run) {
  return (run.stdout || '').split('\n').filter((l) => l.startsWith('PASS:'));
}

function findPassLine(ctx, caseNum) {
  const line = ctx.bl1543.passes.find((l) => l.startsWith(`PASS: ${caseNum}:`));
  assert.ok(line, `no PASS: ${caseNum}: line in:\n${ctx.bl1543.passes.join('\n')}`);
  return line;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the wiring test "(.+)" which boots the real handoffd\.bb against a disposable repository$/, (ctx, file) => {
    knownSuite(file);
    ctx.bl1543 = {};
  });

  // ── shared When: run the suite once per scenario, cache the result ──────
  scoped(/^the standing suite runs "(.+)"$/, (ctx, file) => {
    knownSuite(file);
    if (!ctx.bl1543) ctx.bl1543 = {};
    if (!ctx.bl1543.run) ctx.bl1543.run = runSuite();
  });

  // ── scenario 01 ───────────────────────────────────────────────────────
  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { run } = ctx.bl1543;
    const failures = outputOf(run)
      .split('\n')
      .filter((l) => l.startsWith('FAIL:'));
    assert.deepEqual(failures, [], `failed checks:\n${failures.join('\n')}\nfull output:\n${outputOf(run)}`);
    assert.equal(run.status, 0, `suite exited ${run.status}\n${outputOf(run)}`);
  });

  scoped(/^the run reports exactly (\d+) passed cases$/, (ctx, count) => {
    const expected = Number(count);
    const passes = passLines(ctx.bl1543.run);
    assert.equal(
      passes.length,
      expected,
      `expected exactly ${expected} PASS lines, got ${passes.length}:\n${passes.join('\n')}`
    );
    ctx.bl1543.passes = passes;
  });

  scoped(/^case "(\d+)" reports the OPERATOR outbox carrying one "(.+)" line naming "(.+)"$/, (ctx, caseNum, restoredPrefix, drivenPath) => {
    const line = findPassLine(ctx, caseNum);
    assert.ok(line.includes(restoredPrefix), `case ${caseNum} PASS line missing "${restoredPrefix}": ${line}`);
    assert.ok(line.includes(drivenPath), `case ${caseNum} PASS line missing "${drivenPath}": ${line}`);
  });

  scoped(/^case "(\d+)" reports the drifted script matching main after the sweep$/, (ctx, caseNum) => {
    const line = findPassLine(ctx, caseNum);
    assert.ok(line.includes('matches main after the sweep'), `case ${caseNum} PASS line does not report a match against main: ${line}`);
  });

  scoped(/^case "(\d+)" reports no "(.+)" warning line for the restored episode$/, (ctx, caseNum, warnPrefix) => {
    const line = findPassLine(ctx, caseNum);
    assert.ok(line.includes(warnPrefix), `case ${caseNum} PASS line missing "${warnPrefix}": ${line}`);
    assert.ok(line.includes('no'), `case ${caseNum} PASS line does not read as a negative report: ${line}`);
  });

  scoped(/^case "(\d+)" reports a warning stating the running code is not the landed code while "(.+)" is present, with the script left modified$/, (ctx, caseNum, lockPath) => {
    const line = findPassLine(ctx, caseNum);
    assert.ok(line.includes(lockPath), `case ${caseNum} PASS line missing "${lockPath}": ${line}`);
    assert.ok(line.includes('not the landed code'), `case ${caseNum} PASS line missing the stakes statement: ${line}`);
    assert.ok(line.includes('modified'), `case ${caseNum} PASS line does not report the file left modified: ${line}`);
  });

  // ── scenario 02: no process/dir rooted in a printed fixture survives ────
  scoped(/^no process whose command line names a printed fixture root survives the run$/, (ctx) => {
    const { run } = ctx.bl1543;
    const roots = (run.stdout || '')
      .split('\n')
      .filter((l) => l.startsWith('fixture root: '))
      .map((l) => l.slice('fixture root: '.length).trim());
    assert.ok(roots.length >= 2, `expected at least 2 printed fixture roots, got: ${JSON.stringify(roots)}`);
    ctx.bl1543.roots = roots;
    for (const root of roots) {
      const probe = spawnSync('pgrep', ['-af', root], { encoding: 'utf8' });
      // pgrep exits 1 (no match) when nothing survives - that is the pass case.
      assert.notEqual(
        probe.status,
        0,
        `a process still names fixture root ${root}:\n${probe.stdout}`
      );
    }
  });

  scoped(/^no printed fixture root still exists on disk$/, (ctx) => {
    const fs = require('node:fs');
    for (const root of ctx.bl1543.roots) {
      assert.ok(!fs.existsSync(root), `fixture root ${root} still exists on disk after the run`);
    }
  });
}

module.exports = { registerSteps };
