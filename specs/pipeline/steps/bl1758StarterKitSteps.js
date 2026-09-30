'use strict';

// BL-1758: step handlers for "A greenfield target gets a launchable
// starter kit from the local swarmforgevc checkout". Drives the REAL
// install_starter_kit.bb and the REAL swarm wrapper / swarmforge.sh
// parser against throwaway fixture roots - never a reimplementation of
// either.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1758 A greenfield target gets a launchable starter kit from the local swarmforgevc checkout';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'install_starter_kit.bb');
const SWARM_WRAPPER = path.join(REPO_ROOT, 'swarm');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

function ensure(ctx) {
  if (!ctx.bl1758) {
    ctx.bl1758 = { root: trackedTmpRoot('bl1758-target-') };
  }
  return ctx.bl1758;
}

function fileHashes(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        walk(p);
      } else {
        out.set(path.relative(root, p), crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
      }
    }
  };
  walk(root);
  return out;
}

function runInstaller(st, swarmName) {
  const r = spawnSync('bb', [INSTALLER, st.root, swarmName || 'test-swarm'], { encoding: 'utf8' });
  st.installExit = r.status;
  st.installOut = `${r.stdout || ''}${r.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture target containing only README\.md$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(path.join(st.root, 'README.md'), 'hello\n');
  });

  scoped(/^a fixture target the starter kit was installed into$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(path.join(st.root, 'README.md'), 'hello\n');
    runInstaller(st, 'test-swarm');
    assert.equal(st.installExit, 0, `expected the install to succeed, got: ${st.installOut}`);
  });

  scoped(/^a fixture target that already holds a swarmforge directory$/, (ctx) => {
    const st = ensure(ctx);
    fs.mkdirSync(path.join(st.root, 'swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(st.root, 'swarmforge', 'sentinel.txt'), 'pre-existing\n');
    st.beforeHashes = fileHashes(st.root);
  });

  scoped(/^a fixture target holding the swarm wrapper and no swarmforge\/scripts$/, (ctx) => {
    const st = ensure(ctx);
    fs.copyFileSync(SWARM_WRAPPER, path.join(st.root, 'swarm'));
    fs.chmodSync(path.join(st.root, 'swarm'), 0o755);
  });

  scoped(/^the starter kit is installed into it from the local checkout$/, (ctx) => {
    const st = ensure(ctx);
    runInstaller(st, 'test-swarm');
  });

  scoped(/^the installed swarmforge\.sh parses the installed swarmforge\.conf and mono-router\.conf$/, (ctx) => {
    const st = ensure(ctx);
    const installedSh = path.join(st.root, 'swarmforge', 'scripts', 'swarmforge.sh');
    const runParse = (configFile) => {
      const r = spawnSync('zsh', ['-f', '-c', `SWARMFORGE_CONFIG='${configFile}' source '${installedSh}' '${st.root}'; parse_config`], {
        encoding: 'utf8',
      });
      return `${r.stdout || ''}${r.stderr || ''}`;
    };
    st.confParseOut = runParse(path.join(st.root, 'swarmforge', 'swarmforge.conf'));
    st.packParseOut = runParse(path.join(st.root, 'swarmforge', 'packs', 'mono-router.conf'));
  });

  scoped(/^every line is accepted$/, (ctx) => {
    const st = ensure(ctx);
    // "every line" is the per-line syntax check (Invalid config line N) -
    // never the separate post-loop "No windows defined" structural check,
    // which swarmforge.conf (a metadata-only conf: tooling_root/swarm_name,
    // no window lines) legitimately does not satisfy on its own; it is
    // read for its config lines by other tools, never launched bare.
    assert.doesNotMatch(st.confParseOut, /Invalid config line/, `swarmforge.conf: ${st.confParseOut}`);
    assert.doesNotMatch(st.packParseOut, /Invalid config line/, `mono-router.conf: ${st.packParseOut}`);
    assert.doesNotMatch(st.packParseOut, /No windows defined/, `mono-router.conf should parse fully: ${st.packParseOut}`);
  });

  scoped(/^the target holds swarmforge\/scripts, swarmforge\/git-hooks and swarmforge\/handoff-protocol\.md$/, (ctx) => {
    const st = ensure(ctx);
    for (const rel of ['swarmforge/scripts', 'swarmforge/git-hooks', 'swarmforge/handoff-protocol.md']) {
      assert.ok(fs.existsSync(path.join(st.root, rel)), `expected ${rel} to exist`);
    }
    assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'scripts', 'swarmforge.sh')), 'expected swarmforge.sh among the copied scripts');
    // BL-1801-class gap, hardener-found: terminal-adapters/ is load-bearing
    // at launch (swarmforge.sh's terminal-adapter check requires it to
    // exist and be executable) but lives in a NESTED subdirectory of
    // scripts/ - a non-recursive copy would pass every check above
    // (scripts/ exists, scripts/swarmforge.sh exists) while silently
    // dropping it, and a fresh target's launch would fail with "Required
    // terminal adapter not found". Assert a nested file specifically.
    assert.ok(
      fs.existsSync(path.join(st.root, 'swarmforge', 'scripts', 'terminal-adapters', 'none.sh')),
      'expected a nested terminal-adapters/ file to be copied (non-recursive copy regression)'
    );
  });

  scoped(/^it holds swarmforge\/constitution\.prompt and constitution articles 01 to 05 and workflow\.prompt$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'constitution.prompt')));
    for (const f of ['01_roles.md', '02_handoffs.md', '03_backlog.md', '04_quality_gates.md', '05_amendments.md', 'workflow.prompt']) {
      assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'constitution', 'articles', f)), `expected article ${f}`);
    }
  });

  scoped(/^it holds swarmforge\/packs\/mono-router\.conf and mono-router\.prompt$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'packs', 'mono-router.conf')));
    assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'packs', 'mono-router.prompt')));
  });

  scoped(/^it holds one role prompt for every role mono-router\.conf names$/, (ctx) => {
    const st = ensure(ctx);
    const conf = fs.readFileSync(path.join(st.root, 'swarmforge', 'packs', 'mono-router.conf'), 'utf8');
    const roles = [...conf.matchAll(/^window\s+(\S+)/gm)].map((m) => m[1]);
    assert.ok(roles.length > 0, 'expected at least one window line in mono-router.conf');
    for (const role of roles) {
      assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'roles', `${role}.prompt`)), `expected a role prompt for ${role}`);
    }
  });

  scoped(/^it holds no project\.prompt, engineering\.prompt or local-engineering\.prompt from the checkout$/, (ctx) => {
    const st = ensure(ctx);
    for (const f of ['project.prompt', 'engineering.prompt', 'local-engineering.prompt']) {
      assert.ok(!fs.existsSync(path.join(st.root, 'swarmforge', 'constitution', f)), `expected no ${f} in the installed target`);
    }
  });

  scoped(/^it holds no constitution\/articles\/reference directory$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(!fs.existsSync(path.join(st.root, 'swarmforge', 'constitution', 'articles', 'reference')), 'expected no reference/ directory');
  });

  scoped(/^none of its role prompts is a copy of the checkout's own swarmforge\/roles prompt$/, (ctx) => {
    const st = ensure(ctx);
    const installedDir = path.join(st.root, 'swarmforge', 'roles');
    for (const f of fs.readdirSync(installedDir)) {
      const checkoutOwn = path.join(REPO_ROOT, 'swarmforge', 'roles', f);
      if (fs.existsSync(checkoutOwn)) {
        const installedText = fs.readFileSync(path.join(installedDir, f), 'utf8');
        const ownText = fs.readFileSync(checkoutOwn, 'utf8');
        assert.notEqual(installedText, ownText, `expected ${f} to be the generic starter-kit prompt, not this checkout's own role prompt`);
      }
    }
  });

  scoped(/^its swarmforge\.conf carries "config tooling_root" naming the local checkout$/, (ctx) => {
    const st = ensure(ctx);
    const conf = fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    assert.match(conf, /^config tooling_root \S+/m, `expected a config tooling_root line, got:\n${conf}`);
    assert.ok(conf.includes(REPO_ROOT) || conf.includes(fs.realpathSync(REPO_ROOT)), 'expected tooling_root to name this checkout');
  });

  scoped(/^it records the checkout commit the kit was copied from$/, (ctx) => {
    const st = ensure(ctx);
    const conf = fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    assert.match(conf, /[0-9a-f]{40}/, `expected a 40-hex commit sha recorded somewhere in the conf, got:\n${conf}`);
  });

  scoped(/^it declares "config swarm_name" with the swarm name the install was given$/, (ctx) => {
    const st = ensure(ctx);
    const conf = fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    assert.match(conf, /^config swarm_name test-swarm$/m, `expected "config swarm_name test-swarm", got:\n${conf}`);
  });

  scoped(/^the target's launch runs its git setup$/, (ctx) => {
    const st = ensure(ctx);
    spawnSync('git', ['init', '-q'], { cwd: st.root });
    const installedSh = path.join(st.root, 'swarmforge', 'scripts', 'swarmforge.sh');
    const r = spawnSync(
      'zsh',
      ['-f', '-c', `source '${installedSh}' '${st.root}'; ensure_commit_size_guard`],
      { encoding: 'utf8' }
    );
    st.gitSetupOut = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^core\.hooksPath is swarmforge\/git-hooks and that directory holds the kit's hooks$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('git', ['-C', st.root, 'config', 'core.hooksPath'], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), 'swarmforge/git-hooks', `expected core.hooksPath swarmforge/git-hooks, got: ${r.stdout} / ${st.gitSetupOut}`);
    assert.ok(fs.existsSync(path.join(st.root, 'swarmforge', 'git-hooks', 'pre-commit')), 'expected the kit hooks to be present');
  });

  scoped(/^no \.git\/hooks\/commit-msg exists$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(!fs.existsSync(path.join(st.root, '.git', 'hooks', 'commit-msg')), 'expected no stray .git/hooks/commit-msg');
  });

  scoped(/^the swarm wrapper runs$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bash', [path.join(st.root, 'swarm')], { encoding: 'utf8', cwd: st.root });
    st.wrapperExit = r.status;
    st.wrapperOut = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^no download is attempted$/, (ctx) => {
    const st = ensure(ctx);
    assert.doesNotMatch(st.wrapperOut, /curl|tar -xz|swarm-forge\/archive/, `expected no download attempt, got: ${st.wrapperOut}`);
  });

  scoped(/^it exits non-zero naming the starter kit install$/, (ctx) => {
    const st = ensure(ctx);
    assert.notEqual(st.wrapperExit, 0, `expected a non-zero exit, got 0: ${st.wrapperOut}`);
    assert.match(st.wrapperOut, /install_starter_kit\.bb/, `expected the refusal to name install_starter_kit.bb, got: ${st.wrapperOut}`);
  });

  scoped(/^the install exits non-zero naming the existing swarmforge directory$/, (ctx) => {
    const st = ensure(ctx);
    assert.notEqual(st.installExit, 0, `expected a non-zero exit, got 0: ${st.installOut}`);
    assert.match(st.installOut, /swarmforge/, `expected the refusal to name the swarmforge directory, got: ${st.installOut}`);
  });

  scoped(/^every file in the target is byte-identical to before$/, (ctx) => {
    const st = ensure(ctx);
    const after = fileHashes(st.root);
    assert.deepEqual([...after.entries()].sort(), [...st.beforeHashes.entries()].sort(), 'expected the target to be untouched');
  });
}

module.exports = { registerSteps };
