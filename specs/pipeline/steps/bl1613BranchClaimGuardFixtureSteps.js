'use strict';

// BL-1613: step handlers for "The branch-claim guard test's fixture is a
// complete swarm root". Drives the REAL test_branch_claim_guard.sh against
// the real repository tree (no mocked git, no copied fixture) - the
// fixture's own conformance to what the launcher would persist is exactly
// what this feature is about, so reading and running the real committed
// file is the only honest technique.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1613 The branch-claim guard test's fixture is a complete swarm root";

// A shell statement split across a backslash-continued line (this fixture's
// own printf-then-redirect style) reads as two separate lines under a
// naive per-line scan. Joins each `...\` line with the one after it before
// any line-based matching below, so a statement's pieces are always seen
// together regardless of how the author wrapped it.
function logicalLines(source) {
  const raw = source.split('\n');
  const joined = [];
  let acc = null;
  for (const line of raw) {
    const piece = acc === null ? line : `${acc} ${line.trim()}`;
    if (/\\\s*$/.test(line)) {
      acc = piece.replace(/\\\s*$/, '');
    } else {
      joined.push(piece);
      acc = null;
    }
  }
  if (acc !== null) joined.push(acc);
  return joined;
}
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT_REL = 'swarmforge/scripts/test/test_branch_claim_guard.sh';
const SCRIPT_PATH = path.join(REPO_ROOT, SCRIPT_REL);
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the source of swarmforge\/scripts\/test\/test_branch_claim_guard\.sh is read$/, (ctx) => {
    ctx.source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  });

  scoped(/^the fixture writes a swarm-identity carrying active_backlog_max_depth_conf_path$/, (ctx) => {
    assert.match(
      ctx.source,
      /swarm-identity["']?\s*$|\.swarmforge\/swarm-identity/m,
      'expected a write targeting .swarmforge/swarm-identity'
    );
    const identityWrite = logicalLines(ctx.source).find(
      (line) => line.includes('.swarmforge/swarm-identity') && line.includes('printf')
    );
    assert.ok(identityWrite, `expected a printf writing .swarmforge/swarm-identity, got source with no such line`);
    assert.ok(
      identityWrite.includes('active_backlog_max_depth_conf_path'),
      `expected the swarm-identity write to carry active_backlog_max_depth_conf_path, got: ${identityWrite}`
    );
  });

  scoped(/^the fixture creates the tracked conf that path names before any claim runs$/, (ctx) => {
    const lines = logicalLines(ctx.source);
    const identityIdx = lines.findIndex(
      (line) => line.includes('.swarmforge/swarm-identity') && line.includes('printf')
    );
    const firstClaimIdx = lines.findIndex((line) => /drop_handoff|drop_note|run_ready\b/.test(line));
    assert.ok(identityIdx >= 0, 'expected to find the swarm-identity write line');
    assert.ok(firstClaimIdx >= 0, 'expected to find at least one claim-driving line');
    assert.ok(
      identityIdx < firstClaimIdx,
      `expected the identity write (line ${identityIdx}) before the first claim (line ${firstClaimIdx})`
    );
    // The conf path named is swarmforge/swarmforge.conf (relative to the
    // fixture ROOT, per conf-file-path's own identity-root resolution) -
    // the fixture must create that file before the identity write commits
    // to naming it, so a later claim's read never race a missing target.
    const confCreateIdx = lines.findIndex(
      (line) => line.includes('swarmforge/swarmforge.conf') && !line.includes('printf')
    );
    assert.ok(confCreateIdx >= 0, 'expected a line creating swarmforge/swarmforge.conf');
    assert.ok(
      confCreateIdx <= identityIdx,
      `expected the conf file created (line ${confCreateIdx}) at or before the identity write (line ${identityIdx})`
    );
  });

  scoped(/^the branch-claim guard shell test is executed from the repository root$/, (ctx) => {
    const result = spawnSync('bash', [SCRIPT_REL], { cwd: REPO_ROOT, encoding: 'utf8' });
    ctx.rc = result.status;
    ctx.stdout = result.stdout || '';
    ctx.stderr = result.stderr || '';
  });

  scoped(/^it exits 0 with every case reported as PASS$/, (ctx) => {
    assert.equal(ctx.rc, 0, `expected exit 0, got rc=${ctx.rc} stdout=${ctx.stdout} stderr=${ctx.stderr}`);
    assert.ok(!/^FAIL:/m.test(ctx.stdout + ctx.stderr), `expected no FAIL line, got: ${ctx.stdout}${ctx.stderr}`);
    assert.match(ctx.stdout, /^ALL PASS$/m, `expected a final ALL PASS line, got: ${ctx.stdout}`);
  });

  scoped(
    /^the shell tests under swarmforge\/scripts\/test that drive the task claim path are scanned for an empty-stderr assertion$/,
    (ctx) => {
      const files = fs.readdirSync(TEST_DIR).filter((name) => name.startsWith('test_') && name.endsWith('.sh'));
      const matches = [];
      for (const name of files) {
        const text = fs.readFileSync(path.join(TEST_DIR, name), 'utf8');
        if (!text.includes('swarm-identity')) continue;
        const drivesClaimPath = /ready_for_next_task|ready_for_next\.sh/.test(text);
        const assertsEmptyStderr = /-z\s+"\$ERR"/.test(text);
        if (drivesClaimPath && assertsEmptyStderr) matches.push(name);
      }
      ctx.emptyStderrAssertingClaimDrivers = matches;
    }
  );

  scoped(/^exactly 1 such test is found and it is test_branch_claim_guard\.sh$/, (ctx) => {
    const matches = ctx.emptyStderrAssertingClaimDrivers;
    assert.equal(matches.length, 1, `expected exactly 1 match, got: ${JSON.stringify(matches)}`);
    assert.equal(matches[0], 'test_branch_claim_guard.sh', `expected test_branch_claim_guard.sh, got: ${matches[0]}`);
  });
}

module.exports = { registerSteps };
