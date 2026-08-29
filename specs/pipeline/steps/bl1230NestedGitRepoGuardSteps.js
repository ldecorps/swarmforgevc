'use strict';

// BL-1230: step handlers for the leaked-nested-git-repository check. Drives
// the REAL findNestedGitRepositories (extension/test/helpers/nestedGitRepoGuard.js)
// against a fixture working tree — never a reimplementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { findNestedGitRepositories } = require('../../../extension/test/helpers/nestedGitRepoGuard');

const FEATURE = 'A git repository leaked inside the working tree is caught, not left to hijack git';

function gitInit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
}

// Fixture-root hygiene (BL-971/BL-529 pattern): every root the Background
// creates is registered for removal at process exit, and each new Background
// removes the previous scenario's root eagerly, so neither a passing nor a
// throwing scenario leaves a tmp dir behind.
const fixtureRoots = [];
function registerFixtureRoot(root) {
  fixtureRoots.push(root);
}
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a repository working tree$/, (ctx) => {
    if (ctx.bl1230 && ctx.bl1230.root) {
      fs.rmSync(ctx.bl1230.root, { recursive: true, force: true });
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1230-tree-'));
    registerFixtureRoot(root);
    gitInit(root);
    ctx.bl1230 = { root };
  });

  scoped(/^a git repository exists at "([^"]+)"$/, (ctx, relPath) => {
    const dir = path.join(ctx.bl1230.root, relPath.replace(/\/\.git$/, ''));
    // Reproduces the real 2026-08-27 incident's actual order: the directory
    // already held tracked content BEFORE the nested repo appeared, which
    // is WHY `git status` afterward stays silent about it (a nested .git is
    // invisible to git regardless, but an UNTRACKED directory would at
    // least show up as `??` — this fixture must not accidentally rely on
    // that different, easier-to-notice symptom instead of the real one).
    const fixtureFile = path.join(dir, 'BL-0001-x.yaml');
    if (!fs.existsSync(fixtureFile)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fixtureFile, 'id: BL-0001\n');
      execFileSync('git', ['add', '--', path.relative(ctx.bl1230.root, fixtureFile)], { cwd: ctx.bl1230.root });
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'],
        { cwd: ctx.bl1230.root }
      );
    }
    gitInit(dir);
  });

  scoped(/^the worktree gitfile "([^"]+)" exists$/, (ctx, relPath) => {
    const full = path.join(ctx.bl1230.root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'gitdir: /elsewhere/.git/worktrees/coder\n');
  });

  scoped(/^the repository's own root "([^"]+)" exists$/, (ctx) => {
    // Already created by the Background's `gitInit(root)` — nothing to do.
  });

  scoped(/^a nested repository under "([^"]+)" exists$/, (ctx, dirName) => {
    gitInit(path.join(ctx.bl1230.root, dirName, 'some-pkg'));
  });

  // BL-1246: the exemption is git's own answer, so the fixture writes a real
  // .gitignore and lets `git check-ignore` decide - a fixture that stubbed
  // the predicate would prove only that the seam is wired.
  scoped(/^a repository inside the git-ignored directory "([^"]+)" exists$/, (ctx, dirName) => {
    const bare = dirName.replace(/\/$/, '');
    fs.writeFileSync(path.join(ctx.bl1230.root, '.gitignore'), `/${bare}/\n`);
    gitInit(path.join(ctx.bl1230.root, bare, 'evilmerge'));
  });

  scoped(/^nothing inside "([^"]+)" is reported$/, (ctx, dirName) => {
    const bare = dirName.replace(/\/$/, '');
    const inside = ctx.bl1230.violations.filter((v) => v.path === bare || v.path.startsWith(`${bare}/`));
    assert.deepEqual(
      inside,
      [],
      `the ignored directory ${bare} must be exempt, but these were reported: ${JSON.stringify(inside)}`
    );
  });

  scoped(/^no git repository is nested inside the working tree$/, (ctx) => {
    fs.mkdirSync(path.join(ctx.bl1230.root, 'backlog', 'active'), { recursive: true });
    fs.writeFileSync(path.join(ctx.bl1230.root, 'backlog', 'active', 'BL-1-x.yaml'), 'id: BL-1\n');
  });

  scoped(/^"git status" reports the working tree clean$/, (ctx) => {
    // The preceding "a git repository exists at ..." step already tracked
    // the leaked directory's content before git-init'ing inside it (the
    // real incident's actual order) - this step only confirms that
    // invisibility, it does not need to create it.
    const status = execFileSync('git', ['status', '--short'], { cwd: ctx.bl1230.root, encoding: 'utf8' });
    assert.equal(status.trim(), '', `fixture must reproduce a clean git status, got:\n${status}`);
  });

  scoped(/^the leaked-repository check runs$/, (ctx) => {
    ctx.bl1230.violations = findNestedGitRepositories(ctx.bl1230.root);
  });

  scoped(/^"([^"]+)" is reported$/, (ctx, relPath) => {
    assert.ok(
      ctx.bl1230.violations.some((v) => v.path === relPath),
      `expected ${relPath} among violations, got: ${JSON.stringify(ctx.bl1230.violations)}`
    );
  });

  scoped(/^nothing is reported$/, (ctx) => {
    assert.deepEqual(ctx.bl1230.violations, []);
  });

  scoped(/^the report says a git command run from that directory resolves to it$/, (ctx) => {
    const v = ctx.bl1230.violations.find((x) => x.path === 'backlog/.git');
    assert.ok(v, 'expected a violation for backlog/.git');
    assert.match(v.reason, /resolves to this nested repository/);
  });

  scoped(/^"([^"]+)" still exists$/, (ctx, relPath) => {
    assert.ok(fs.existsSync(path.join(ctx.bl1230.root, relPath)), `expected ${relPath} to still exist`);
  });
}

module.exports = { registerSteps };
