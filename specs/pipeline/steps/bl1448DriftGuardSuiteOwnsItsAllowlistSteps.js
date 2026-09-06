'use strict';

// BL-1448: step handlers for "BL-1448 The drift-guard suite decides its own
// allowlist, never the live one". Drives the REAL
// test_property_suite_drift_guard.sh shell suite (all 25 cases) from a
// scratch copy of the tree, varying only the scratch copy's OWN
// property_suite_standing_allowlist.tsv - the live one at
// swarmforge/scripts/property_suite_standing_allowlist.tsv is never read or
// written by this handler (BL-1390). The suite's allowlist-dependent cases
// (11-13d, 21) install their own guard-copy fixture (this ticket's fix), so
// the scratch copy's live-file row count and content must never change the
// suite's verdict - proving exactly that is this feature.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1448 The drift-guard suite decides its own allowlist, never the live one';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUITE_REL = path.join('swarmforge', 'scripts', 'test', 'test_property_suite_drift_guard.sh');
const ALLOWLIST_REL = path.join('swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');

const FIXTURE_PREFIX = 'bl1448-driftguard-';

const KNOWN_ROW_COUNTS = new Set([0, 1, 3]);

// BL-971: sweep stale fixture dirs by prefix BEFORE the run too - a killed
// prior run traps nothing in its own finally. Scoped to this ticket's own
// tmp prefix only, never a shared/production path.
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function chmodShFilesIn(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.isFile() && dirent.name.endsWith('.sh')) {
      fs.chmodSync(path.join(dir, dirent.name), 0o755);
    }
  }
}

// Everything the copied suite's own cases (through case 07's full-delegation
// wiring check) read off the copy's computed REPO_ROOT: the whole
// swarmforge/ tree (scripts + git-hooks - every guard run_commit_guards.sh
// or a hook names must physically exist; deriveCommitGuardFixtureSet's own
// walk throws on a missing one, BL-1398) plus the two JS libs case 07
// requires by absolute repo-relative path. Copied wholesale rather than
// hand-enumerated further - a hand list of exactly these is the same
// staleness shape BL-1398 replaced.
function buildScratchTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  fixtureRoots.push(root);

  fs.cpSync(path.join(REPO_ROOT, 'swarmforge'), path.join(root, 'swarmforge'), { recursive: true });

  fs.mkdirSync(path.join(root, 'extension', 'test', 'helpers'), { recursive: true });
  fs.cpSync(
    path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'),
    path.join(root, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'),
  );

  fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps', 'lib'), { recursive: true });
  fs.cpSync(
    path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1409PropertyGuardWiring.js'),
    path.join(root, 'specs', 'pipeline', 'steps', 'lib', 'bl1409PropertyGuardWiring.js'),
  );

  // fs.cpSync does not reliably carry the execute bit across every
  // platform/Node version - re-assert it rather than trust the copy.
  chmodShFilesIn(path.join(root, 'swarmforge', 'scripts'));
  chmodShFilesIn(path.join(root, 'swarmforge', 'scripts', 'test'));
  for (const hook of fs.readdirSync(path.join(root, 'swarmforge', 'git-hooks'))) {
    fs.chmodSync(path.join(root, 'swarmforge', 'git-hooks', hook), 0o755);
  }

  return root;
}

function writeAllowlist(root, rows) {
  const header = fs.readFileSync(path.join(REPO_ROOT, ALLOWLIST_REL), 'utf8').split('\n')[0];
  const lines = [header, ...rows.map((f) => `${f}\tallowlist\tBL-1448 fixture live-row (must be inert)`)];
  fs.writeFileSync(path.join(root, ALLOWLIST_REL), lines.join('\n') + '\n');
}

function runSuite(root) {
  const result = spawnSync('bash', [path.join(root, SUITE_REL)], { encoding: 'utf8', timeout: 180_000 });
  return { rc: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a scratch copy of the guard, its libs and the suite whose allowlist file holds (\d+) data rows$/,
    (ctx, rowsStr) => {
      const rows = Number(rowsStr);
      assert.ok(KNOWN_ROW_COUNTS.has(rows), `unknown <rows> example value: ${rowsStr}`);
      sweepStaleFixtures();
      ctx.root = buildScratchTree();
      const fillerRows = Array.from({ length: rows }, (_, i) => `test/bl1448LiveFillerRow${i}.property.test.js`);
      writeAllowlist(ctx.root, fillerRows);
    },
  );

  scoped(/^a scratch copy whose allowlist file gains a row for the fixture's non-allowlisted red$/, (ctx) => {
    sweepStaleFixtures();
    ctx.root = buildScratchTree();
    // The suite's default non-allowlisted RED fixture fails
    // "extension/test/pipelineBoard.property.test.js"; the allowlist
    // normalizes away the extension/ prefix (ps_allowlist_normalize_file),
    // so the live-format row names it as "test/pipelineBoard.property.test.js".
    writeAllowlist(ctx.root, ['test/pipelineBoard.property.test.js']);
  });

  scoped(/^the drift-guard suite runs against the scratch copy$/, (ctx) => {
    ctx.result = runSuite(ctx.root);
  });

  scoped(/^it passes every case$/, (ctx) => {
    try {
      assert.equal(ctx.result.rc, 0, `expected the suite to pass, got rc ${ctx.result.rc}:\n${ctx.result.out}`);
      assert.match(ctx.result.out, /^ALL PASS$/m, `expected a final "ALL PASS" line, got:\n${ctx.result.out}`);
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
