'use strict';

// BL-924: step handlers for "a byte-identical hot-synced copy never
// blocks a worktree merge". Drives the real
// swarmforge/scripts/clear_identical_untracked_and_merge.bb against real,
// disposable git fixture repos - never a reimplementation of the
// collision-clearing decision. Fixture discipline (per the ticket's own
// notes): every fixture lives under this process's own mkdtemp root,
// never a live .worktrees/ path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TOOL = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'clear_identical_untracked_and_merge.bb');

const FEATURE = 'a byte-identical hot-synced copy never blocks a worktree merge';

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// main tracks foo.sh from the start; the role branch's pointer is created
// there too - BEFORE main later adds bar.sh/baz.sh - the exact "role
// worktree is behind main" shape a real relaunch's sync_worktree_scripts()
// then hot-syncs untracked copies of bar.sh/baz.sh into. The worktree
// checkout itself is deferred to the end, after every top-level commit -
// otherwise a later `git add -A` at the top level would pick up the
// linked worktree's own .git file as a spurious "embedded git repository".
function mkRepoWithDivergedRole() {
  const root = mkTmp('sfvc-bl924-root-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'foo.sh'), 'echo foo\n');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', 'role']);
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'bar.sh'), 'echo bar\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'baz.sh'), 'echo baz\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'main: add bar.sh and baz.sh']);
  const wt = path.join(root, '.worktrees', 'role');
  git(root, ['worktree', 'add', '-q', wt, 'role']);
  return { root, wt };
}

function mainTrackedContent(root, relPath) {
  return git(root, ['show', `main:${relPath}`]);
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const COPY_MODES = {
  'identical to': 'identical',
  'different from': 'different',
};

function knownCopyMode(token) {
  if (!Object.prototype.hasOwnProperty.call(COPY_MODES, token)) {
    throw new Error(`unknown <copy> token: ${token}`);
  }
  return COPY_MODES[token];
}

function runMergeTool(wt) {
  try {
    const stdout = execFileSync('bb', [TOOL, wt, 'main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a role worktree carrying untracked hot-synced copies of paths that main tracks$/,
    (ctx) => {
      const { root, wt } = mkRepoWithDivergedRole();
      ctx.root = root;
      ctx.wt = wt;
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^an untracked copy whose content is (identical to|different from) the tracked version on main$/,
    (ctx, token) => {
      const mode = knownCopyMode(token);
      const barPath = path.join(ctx.wt, 'swarmforge', 'scripts', 'bar.sh');
      ctx.trackedBarContent = mainTrackedContent(ctx.root, 'swarmforge/scripts/bar.sh');
      fs.writeFileSync(barPath, mode === 'identical' ? ctx.trackedBarContent : 'echo bar LOCALLY MODIFIED\n');
      ctx.barPath = barPath;
      ctx.beforeHead = git(ctx.wt, ['rev-parse', 'HEAD']).trim();
    },
    FEATURE
  );

  registry.defineScoped(
    /^that worktree merges main$/,
    (ctx) => {
      ctx.result = runMergeTool(ctx.wt);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the merge (completes without manual clearing|is refused rather than overwriting it)$/,
    (ctx, token) => {
      if (token === 'completes without manual clearing') {
        assert.equal(ctx.result.exitCode, 0, `expected the merge to complete, got exit ${ctx.result.exitCode}. output:\n${ctx.result.output}`);
        assert.equal(git(ctx.wt, ['status', '--short']).trim(), '', 'expected a clean worktree after the merge');
        assert.equal(fs.readFileSync(ctx.barPath, 'utf8'), ctx.trackedBarContent, "expected bar.sh to match main's tracked content after the merge");
      } else {
        assert.notEqual(ctx.result.exitCode, 0, `expected the merge to be refused, got exit 0. output:\n${ctx.result.output}`);
        assert.equal(fs.readFileSync(ctx.barPath, 'utf8'), 'echo bar LOCALLY MODIFIED\n', 'expected the modified content to still be there after the refusal');
        assert.equal(git(ctx.wt, ['rev-parse', 'HEAD']).trim(), ctx.beforeHead, 'expected no merge to have happened (HEAD unchanged) after the refusal');
      }
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^several untracked copies differ from the tracked versions on main$/,
    (ctx) => {
      fs.writeFileSync(path.join(ctx.wt, 'swarmforge', 'scripts', 'bar.sh'), 'echo bar LOCALLY MODIFIED\n');
      fs.writeFileSync(path.join(ctx.wt, 'swarmforge', 'scripts', 'baz.sh'), 'echo baz LOCALLY MODIFIED\n');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the refusal names every colliding path at once, not the first one only$/,
    (ctx) => {
      assert.notEqual(ctx.result.exitCode, 0, `expected the merge to be refused, got exit 0. output:\n${ctx.result.output}`);
      assert.match(ctx.result.output, /swarmforge\/scripts\/bar\.sh/, `expected bar.sh named in the one refusal, got:\n${ctx.result.output}`);
      assert.match(ctx.result.output, /swarmforge\/scripts\/baz\.sh/, `expected baz.sh named in the SAME refusal, got:\n${ctx.result.output}`);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^an untracked file in the worktree whose content is on no branch$/,
    (ctx) => {
      ctx.notesPath = path.join(ctx.wt, 'swarmforge', 'scripts', 'my_local_notes.txt');
      fs.writeFileSync(ctx.notesPath, 'irreplaceable scratch notes, on no branch\n');
    },
    FEATURE
  );

  registry.defineScoped(
    /^that file is left in place untouched$/,
    (ctx) => {
      assert.equal(ctx.result.exitCode, 0, `expected the merge to succeed (the notes file is not a collision), got exit ${ctx.result.exitCode}. output:\n${ctx.result.output}`);
      assert.equal(fs.readFileSync(ctx.notesPath, 'utf8'), 'irreplaceable scratch notes, on no branch\n', 'expected the no-branch-content file to survive untouched');
      assert.ok(!ctx.result.output.includes('my_local_notes.txt'), `expected the notes file to never even be mentioned, got:\n${ctx.result.output}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
