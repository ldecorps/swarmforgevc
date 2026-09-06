'use strict';

// BL-1424: step handlers for "A commit that adds a test file registers it".
// Every scenario drives the REAL check_test_file_registration.sh (which
// execs the REAL check_test_file_registration_cli.bb, which load-files the
// REAL unregistered_test_gate_lib.bb) against a fixture repository under
// mkdtemp - never a reimplementation of the guard's own decision. Fixture
// shape follows the established convention (bl1428StandingRedRegisterCli.bb,
// bl1438PublishRepointsQaBranchSteps.js): a real `git init` repo under
// mkdtemp (BL-1390 - never the live checkout, never a linked worktree), the
// REAL guard script invoked with its cwd set to the fixture root so its own
// `git rev-parse --show-toplevel` resolves to the FIXTURE, never this repo.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'A commit that adds a test file registers it';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_test_file_registration.sh');
const TEST_DIR = 'swarmforge/scripts/test';
const MANIFEST = `${TEST_DIR}/suite-manifest.tsv`;

const FILE_SHAPE_RE = /^(test_[A-Za-z0-9_-]+\.sh|[A-Za-z0-9_-]+_test_runner\.bb)$/;

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function buildFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1424-'));
  fixtureRoots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');

  writeFile(root, MANIFEST, 'existing_test_runner.bb\tstanding\t\t\n');
  writeFile(root, 'seed.txt', 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');

  ctx.root = root;
}

function runGuard(ctx) {
  const result = spawnSync('bash', [GUARD_SH], { cwd: ctx.root, encoding: 'utf8' });
  ctx.result = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
}

// Explicit KNOWN_VALUES per the Scenario Outline handler rule: each phrase
// is a distinct fixture shape, never a passthrough.
const KNOWN_WORK = new Map([
  [
    'a staged test file that already has a manifest row',
    (ctx) => {
      writeFile(ctx.root, `${TEST_DIR}/registered_test_runner.bb`, 'probe\n');
      fs.appendFileSync(path.join(ctx.root, MANIFEST), 'registered_test_runner.bb\tstanding\t\t\n');
      git(ctx.root, 'add', '-A');
    },
  ],
  [
    'an unrelated file, leaving an earlier committed unregistered file untouched',
    (ctx) => {
      // Committed BEFORE the commit under test - pre-existing drift.
      writeFile(ctx.root, `${TEST_DIR}/test_stale.sh`, '#!/usr/bin/env bash\necho stale\n');
      git(ctx.root, 'add', '-A');
      git(ctx.root, 'commit', '-q', '-m', 'a stale unregistered file, already on HEAD');
      writeFile(ctx.root, 'README-unrelated.md', 'unrelated\n');
      git(ctx.root, 'add', '-A');
    },
  ],
  [
    'an unrelated file, leaving an unstaged unregistered file on disk untouched',
    (ctx) => {
      // On disk, but never `git add`-ed - invisible to the index.
      writeFile(ctx.root, `${TEST_DIR}/test_untracked.sh`, '#!/usr/bin/env bash\necho untracked\n');
      writeFile(ctx.root, 'README-unrelated.md', 'unrelated\n');
      git(ctx.root, 'add', '--', 'README-unrelated.md');
    },
  ],
  [
    'a change under docs/ with no test file at all',
    (ctx) => {
      writeFile(ctx.root, 'docs/note.md', 'note\n');
      git(ctx.root, 'add', '-A');
    },
  ],
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with a git-initialized main branch and a suite manifest holding one already-registered row$/,
    (ctx) => {
      buildFixture(ctx);
      assert.equal(git(ctx.root, 'status', '--porcelain'), '', 'expected the freshly built fixture to be clean');
    }
  );

  // ── shared When ──────────────────────────────────────────────────────
  scoped(/^check_test_file_registration\.sh runs in that repository$/, (ctx) => {
    runGuard(ctx);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the commit adds (.+) under the test directory with no manifest row$/, (ctx, file) => {
    assert.match(file, FILE_SHAPE_RE, `unexpected <file> example value: ${file}`);
    writeFile(ctx.root, `${TEST_DIR}/${file}`, '#!/usr/bin/env bash\necho probe\n');
    git(ctx.root, 'add', '-A');
  });

  scoped(/^it refuses naming (.+) and quoting the row it needs$/, (ctx, file) => {
    assert.match(file, FILE_SHAPE_RE, `unexpected <file> example value: ${file}`);
    assert.equal(ctx.result.rc, 1, `expected the guard to refuse, got: ${JSON.stringify(ctx.result)}`);
    assert.ok(ctx.result.err.includes(file), `expected the refusal to name ${file}, got: ${ctx.result.err}`);
    assert.ok(
      ctx.result.err.includes(`${file}\tstanding`),
      `expected the refusal to quote the row ${file} needs, got: ${ctx.result.err}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the commit's own staged scope is (.+)$/, (ctx, work) => {
    assert.ok(KNOWN_WORK.has(work), `unknown <work> example value: ${work}`);
    KNOWN_WORK.get(work)(ctx);
  });

  scoped(/^it exits 0 with no refusal$/, (ctx) => {
    assert.equal(ctx.result.rc, 0, `expected the guard to allow the commit, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the repository has no suite manifest at all, staged or committed$/, (ctx) => {
    git(ctx.root, 'rm', '-q', MANIFEST);
    git(ctx.root, 'commit', '-q', '-m', 'remove the suite manifest entirely');
    assert.ok(!fs.existsSync(path.join(ctx.root, MANIFEST)), 'expected the manifest to be gone from the working tree');
  });

  scoped(/^the commit stages a test file that would otherwise need a row$/, (ctx) => {
    writeFile(ctx.root, `${TEST_DIR}/test_orphan.sh`, '#!/usr/bin/env bash\necho orphan\n');
    git(ctx.root, 'add', '-A');
  });

  scoped(/^it warns on stderr and exits 0$/, (ctx) => {
    assert.equal(ctx.result.rc, 0, `expected the guard to fail open (exit 0), got: ${JSON.stringify(ctx.result)}`);
    assert.match(ctx.result.err, /WARNING/, `expected a WARNING on stderr, got: ${ctx.result.err}`);
  });
}

module.exports = { registerSteps };
