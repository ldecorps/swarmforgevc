'use strict';

// BL-373: step handlers for "The launcher never overwrites git-tracked
// files in a role worktree" (the phantom-revert root cause). Drives the
// REAL sync_worktree_scripts() shell function (swarmforge.sh sourced,
// BL-089's own ZSH_EVAL_CONTEXT guard) against a real throwaway git
// fixture repo with a real role worktree - per the ticket's own testing
// note, the whole defect lives in the gap between "the file exists" and
// "git tracks the file", which only a real index can tell you, never a
// mock. The pure should-copy? decision is unit-tested directly in
// sync_worktree_scripts_lib_test_runner.bb; the shell-level wiring is also
// proven directly in test_sync_worktree_scripts_never_clobbers.sh (same
// fixture shape, deliberately mirrored here rather than shared, matching
// this codebase's established "small live-glue duplicated across
// independent test surfaces" posture).
//
// The fixture carries its OWN full copy of this repo's real
// swarmforge/scripts/ (not a hand-picked subset): swarmforge.sh sources
// several sibling scripts unconditionally at PARSE time (before the
// ZSH_EVAL_CONTEXT guard), so a partial fixture chases a cascade of
// "no such file" errors one dependency at a time.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// Safety net: every fixture root is a FULL COPY of this repo's real
// swarmforge/scripts/ (hundreds of files, see file header), so leaving
// even one behind on a thrown assertion leaks unboundedly across repeated
// acceptance runs. This DSL has no per-scenario teardown hook (see
// daemonWorkflowSteps.js's own comment on the same gap), so every root is
// tracked here and swept on process exit - the same liveFixtureRoots Set +
// process.on('exit', ...) pattern already used in
// roleLifecycleParkUnneededSteps.js and mergedCodeReachesDaemonsSteps.js.
const liveFixtureRoots = new Set();

process.on('exit', () => {
  for (const root of liveFixtureRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort - the process is already exiting
    }
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  liveFixtureRoots.add(root);
  return root;
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

const TRACKED_PATH_EXAMPLES = new Set(['swarmforge/scripts', 'swarmforge/profiles']);

// Builds a throwaway "master" fixture carrying a full copy of this repo's
// real swarmforge/scripts/ (see file header for why a subset chases a
// dependency cascade), plus a role worktree, ready for the sync to run
// against. testFilePath is the tracked_path Examples column value under
// test - the file the scenario diverges on lives under it.
function mkFixture(testFilePath) {
  const root = mkTmp('aps-sync-worktree-scripts-');
  mkdirp(path.join(root, 'swarmforge', 'roles'));
  mkdirp(path.join(root, 'swarmforge', 'profiles'));
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'specifier.prompt'), 'role prompt\n');
  execFileSync('cp', ['-R', REAL_SCRIPTS_DIR, path.join(root, 'swarmforge', 'scripts')]);
  fs.rmSync(path.join(root, 'swarmforge', 'scripts', 'test'), { recursive: true, force: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'profiles', 'default.conf'), 'profile body\n');
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    'config active_backlog_max_depth -1\nwindow specifier claude master --model x\nwindow coder claude coder --model x\n'
  );
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');

  const divergingFile = path.join(root, testFilePath, 'foo.bb');
  mkdirp(path.dirname(divergingFile));
  fs.writeFileSync(divergingFile, "master's foo body\n");

  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['worktree', 'add', '-q', '-b', 'coder', '.worktrees/coder']);

  return { root, divergingFile: path.join(root, '.worktrees', 'coder', testFilePath, 'foo.bb') };
}

function writeRuntimeStateFixtures(root) {
  const stateDir = path.join(root, '.swarmforge');
  mkdirp(stateDir);
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), 'fake-sessions\n');
  fs.writeFileSync(path.join(stateDir, 'roles.tsv'), 'fake-roles\n');
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), 'fake-socket\n');
  fs.writeFileSync(path.join(stateDir, 'tmux-env'), 'fake-env\n');
}

function runSync(root) {
  const script = `source '${path.join(root, 'swarmforge', 'scripts', 'swarmforge.sh')}' '${root}'; parse_config; sync_worktree_scripts`;
  const result = spawnSync('zsh', ['-c', script], { encoding: 'utf8' });
  return { ok: result.status === 0, stdout: (result.stdout || '') + (result.stderr || '') };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a swarm whose role worktrees are checkouts of the target repository$/, () => {
    // Narrative only - each scenario's own Given builds its own fixture.
  });

  registry.define(/^every role worktree starts with a clean working tree$/, () => {
    // Narrative only - a freshly committed git worktree already is one.
  });

  // ── launcher-never-clobbers-tracked-worktree-files-01 ───────────────────
  registry.define(/^the target repository git-tracks "([^"]+)"$/, (ctx, trackedPath) => {
    if (!TRACKED_PATH_EXAMPLES.has(trackedPath)) {
      throw new Error(`unrecognized tracked_path in Examples table: "${trackedPath}"`);
    }
    ctx.trackedPath = trackedPath;
    const { root, divergingFile } = mkFixture(trackedPath);
    ctx.root = root;
    ctx.divergingFile = divergingFile;
    fs.writeFileSync(divergingFile, "coder branch's MERGED fix, not yet on main\n");
    git(path.join(root, '.worktrees', 'coder'), ['add', '-A']);
    git(path.join(root, '.worktrees', 'coder'), ['commit', '-q', '-m', 'coder: merge a script fix']);
    ctx.beforeContent = fs.readFileSync(divergingFile, 'utf8');
    writeRuntimeStateFixtures(root);
  });

  registry.define(/^the swarm is launched$/, (ctx) => {
    ctx.syncResult = runSync(ctx.root);
    if (!ctx.syncResult.ok) {
      throw new Error(`expected sync_worktree_scripts to run cleanly, got: ${ctx.syncResult.stdout}`);
    }
  });

  registry.define(/^"([^"]+)" in every role worktree is unmodified$/, (ctx, trackedPath) => {
    if (trackedPath !== ctx.trackedPath) {
      throw new Error(`unexpected tracked_path in Then step: "${trackedPath}" (scenario set up "${ctx.trackedPath}")`);
    }
    const after = fs.readFileSync(ctx.divergingFile, 'utf8');
    if (after !== ctx.beforeContent) {
      throw new Error(`expected the role branch's merged, tracked file to survive the sync unmodified; before=[${ctx.beforeContent}] after=[${after}]`);
    }
  });

  registry.define(/^every role worktree reports no uncommitted changes$/, (ctx) => {
    const status = execFileSync('git', ['-C', path.join(ctx.root, '.worktrees', 'coder'), 'status', '--short'], { encoding: 'utf8' });
    if (status.trim() !== '') {
      throw new Error(`expected the role worktree to report no uncommitted changes after the sync, got: ${status}`);
    }
  });

  // ── launcher-never-clobbers-tracked-worktree-files-02 ───────────────────
  registry.define(/^the target repository git-tracks the swarm scripts$/, (ctx) => {
    const { root, divergingFile } = mkFixture('swarmforge/scripts');
    ctx.root = root;
    ctx.divergingFile = divergingFile;
    writeRuntimeStateFixtures(root);
  });

  registry.define(/^a role branch has merged a script change that main does not yet have$/, (ctx) => {
    fs.writeFileSync(ctx.divergingFile, "coder branch's MERGED fix, not yet on main\n");
    git(path.join(ctx.root, '.worktrees', 'coder'), ['add', '-A']);
    git(path.join(ctx.root, '.worktrees', 'coder'), ['commit', '-q', '-m', 'coder: merge a script fix']);
    ctx.mergedContent = fs.readFileSync(ctx.divergingFile, 'utf8');
  });

  registry.define(/^the swarm is relaunched$/, (ctx) => {
    ctx.syncResult = runSync(ctx.root);
    if (!ctx.syncResult.ok) {
      throw new Error(`expected sync_worktree_scripts to run cleanly, got: ${ctx.syncResult.stdout}`);
    }
  });

  registry.define(/^that role worktree still contains the change$/, (ctx) => {
    const after = fs.readFileSync(ctx.divergingFile, 'utf8');
    if (after !== ctx.mergedContent) {
      throw new Error(`expected the relaunch to leave the role branch's merged change intact; expected=[${ctx.mergedContent}] got=[${after}]`);
    }
  });

  // ── launcher-never-clobbers-tracked-worktree-files-03 ───────────────────
  registry.define(/^the target repository does not git-track the swarm scripts$/, (ctx) => {
    ctx.root = mkTmp('aps-sync-worktree-scripts-foreign-');
    mkdirp(path.join(ctx.root, 'swarmforge', 'roles'));
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'constitution.prompt'), '');
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'roles', 'specifier.prompt'), 'role prompt\n');
    execFileSync('cp', ['-R', REAL_SCRIPTS_DIR, path.join(ctx.root, 'swarmforge', 'scripts')]);
    fs.rmSync(path.join(ctx.root, 'swarmforge', 'scripts', 'test'), { recursive: true, force: true });
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'scripts', 'foo.bb'), "master's foo body\n");
    fs.writeFileSync(
      path.join(ctx.root, 'swarmforge', 'swarmforge.conf'),
      'config active_backlog_max_depth -1\nwindow specifier claude master --model x\nwindow coder claude coder --model x\n'
    );
    // The foreign target's OWN history never tracked swarmforge/ at all.
    fs.writeFileSync(path.join(ctx.root, '.gitignore'), 'swarmforge/\n.swarmforge/\n');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['add', '-A', '--', '.gitignore']);
    git(ctx.root, ['commit', '-q', '-m', 'init']);
    git(ctx.root, ['worktree', 'add', '-q', '-b', 'coder', '.worktrees/coder']);
  });

  registry.define(/^a role worktree has no swarm scripts of its own$/, (ctx) => {
    fs.rmSync(path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts'), { recursive: true, force: true });
    writeRuntimeStateFixtures(ctx.root);
  });

  registry.define(/^that role worktree has the swarm scripts available to run$/, (ctx) => {
    const delivered = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts', 'foo.bb');
    if (!fs.existsSync(delivered)) {
      throw new Error(`expected a target repo that does not git-track swarmforge/ to still receive the scripts, sync output: ${ctx.syncResult.stdout}`);
    }
  });

  // ── launcher-never-clobbers-tracked-worktree-files-04 ───────────────────
  registry.define(/^every role worktree has the current session, role, and tmux-socket state$/, (ctx) => {
    const stateDir = path.join(ctx.root, '.worktrees', 'coder', '.swarmforge');
    const expectations = {
      'sessions.tsv': 'fake-sessions\n',
      'roles.tsv': 'fake-roles\n',
      'tmux-socket': 'fake-socket\n',
      'tmux-env': 'fake-env\n',
    };
    for (const [file, expected] of Object.entries(expectations)) {
      const got = fs.readFileSync(path.join(stateDir, file), 'utf8');
      if (got !== expected) {
        throw new Error(`expected ${file} to be delivered to the role worktree as ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      }
    }
  });

  // ── launcher-never-clobbers-tracked-worktree-files-05 ───────────────────
  registry.define(/^the launcher reports that it left the tracked paths to git$/, (ctx) => {
    if (!/left to git \(tracked\): swarmforge\/scripts\/foo\.bb/.test(ctx.syncResult.stdout)) {
      throw new Error(`expected the sync to report leaving the tracked foo.bb to git, got: ${ctx.syncResult.stdout}`);
    }
  });
}

module.exports = { registerSteps };
