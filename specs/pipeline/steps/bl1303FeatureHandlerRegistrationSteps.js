'use strict';

// BL-1303: a feature file on `main` always resolves to a runnable step handler.
//
// Every scenario builds a REAL scratch git repository on the REAL branch the
// scenario names and runs the REAL guard
// (swarmforge/scripts/check_feature_handler_registration.sh) against it. The
// branch is the thing scenario 05 is about, so it is a real checked-out
// branch rather than a stubbed answer; and the tree is real files, because
// "the handler file exists but is absent from the registry" is a statement
// about a tree on disk.
//
// The guard resolves its checker from its OWN checkout, so a scratch repo
// needs no compiled extension of its own - only this repository's.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_feature_handler_registration.sh');

const FEATURE = 'A feature file on main always resolves to a runnable step handler';

const FEATURES_DIR = 'specs/features';
const STEPS_DIR = 'specs/pipeline/steps';
const REGISTRY = `${STEPS_DIR}/index.js`;
const LIB_DIR = `${STEPS_DIR}/lib`;

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitEnv() });
}

// A leaked GIT_DIR/GIT_WORK_TREE would point every scratch repo's git at
// whatever repository this run was launched from.
function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

/**
 * Builds a scratch repo on `branch`.
 *
 * `tickets` is one entry per ticket: 'registered' (handler named in the
 * registry), 'unregistered' (handler file present, registry silent), or
 * 'missing-sibling' (registered handler executing a lib script that is not in
 * the tree). `registryReadable: false` leaves no registry file at all.
 */
function buildRepo({ branch, tickets, registryReadable = true }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1303-'));
  fs.mkdirSync(path.join(repo, FEATURES_DIR), { recursive: true });
  fs.mkdirSync(path.join(repo, LIB_DIR), { recursive: true });

  const built = [];
  const required = [];
  tickets.forEach((shape, index) => {
    const id = 900 + index + 1;
    const feature = `${FEATURES_DIR}/BL-${id}-fixture.feature`;
    const handler = `${STEPS_DIR}/bl${id}FixtureSteps.js`;
    const script = `${LIB_DIR}/bl${id}FixtureCli.sh`;
    fs.writeFileSync(path.join(repo, feature), `Feature: fixture ${id}\n`, 'utf8');
    const body =
      shape === 'missing-sibling'
        ? "const path = require('node:path');\n" +
          `const CLI = path.join(__dirname, 'lib', 'bl${id}FixtureCli.sh');\n` +
          'module.exports = { registerSteps() {}, CLI };\n'
        : 'module.exports = { registerSteps() {} };\n';
    fs.writeFileSync(path.join(repo, handler), body, 'utf8');
    if (shape !== 'unregistered') {
      required.push(`bl${id}FixtureSteps`);
    }
    built.push({ shape, feature, handler, script });
  });

  if (registryReadable) {
    const lines = required.map((name) => `  require('./${name}'),`).join('\n');
    fs.writeFileSync(path.join(repo, REGISTRY), `const DOMAINS = [\n${lines}\n];\n`, 'utf8');
  }

  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', branch);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture');
  return { repo, built };
}

function runGuard(repo) {
  const result = spawnSync('bash', [GUARD, repo], { encoding: 'utf8', env: gitEnv() });
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function state(ctx) {
  if (!ctx.bl1303) {
    ctx.bl1303 = { tickets: [], registryReadable: true };
  }
  return ctx.bl1303;
}

function build(ctx, branch) {
  const s = state(ctx);
  const { repo, built } = buildRepo({
    branch,
    tickets: s.tickets,
    registryReadable: s.registryReadable,
  });
  s.repo = repo;
  s.built = built;
  try {
    s.result = runGuard(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

/** What the refusal must name, per the phrase the scenario uses. */
function namedArtifact(s, phrase) {
  const first = (shape) => s.built.find((entry) => entry.shape === shape);
  switch (phrase) {
    case 'offending feature file':
      return first('unregistered').feature.split('/').pop();
    case 'unregistered handler':
      return first('unregistered').handler.split('/').pop();
    case 'missing sibling script':
      return first('missing-sibling').script.split('/').pop();
    case 'unreadable step registry':
      return REGISTRY;
    default:
      throw new Error(`unmapped artifact phrase: ${phrase}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  // Both lines describe the fixture every scenario builds; they are asserted
  // against the built repository once the When step has created it.

  scoped(/^a repository whose acceptance features live in "([^"]+)\/"$/, (ctx, dir) => {
    assert.equal(dir, FEATURES_DIR);
    state(ctx).featuresDir = dir;
  });

  scoped(/^a step registry at "([^"]+)"$/, (ctx, registryPath) => {
    assert.equal(registryPath, REGISTRY);
    state(ctx).registryPath = registryPath;
  });

  // ── Given: the tree under examination ───────────────────────────────────

  scoped(/^a feature file whose every step matches a registered handler$/, (ctx) => {
    state(ctx).tickets = ['registered'];
  });

  scoped(
    /^a feature file whose handler file exists but is absent from the step registry$/,
    (ctx) => {
      state(ctx).tickets = ['unregistered'];
    }
  );

  scoped(
    /^a registered handler that executes a sibling script under "([^"]+)"$/,
    (ctx, libDir) => {
      assert.equal(libDir.replace(/\/$/, ''), LIB_DIR);
      state(ctx).tickets = ['missing-sibling'];
    }
  );

  scoped(/^that sibling script is absent from the tree being committed$/, (ctx) => {
    // buildRepo writes the handler that reaches for it and never writes the
    // script itself - this line is the assertion that it really is absent.
    assert.deepEqual(state(ctx).tickets, ['missing-sibling']);
  });

  scoped(/^a tree carrying (\d+) distinct unrunnable feature files$/, (ctx, count) => {
    const n = Number(count);
    assert.ok(n >= 2, 'the point of this scenario is more than one offender');
    state(ctx).tickets = Array.from({ length: n }, () => 'unregistered');
  });

  scoped(/^a step registry that cannot be read$/, (ctx) => {
    const s = state(ctx);
    s.tickets = ['registered'];
    s.registryReadable = false;
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the feature-handler registration guard runs on "([^"]+)"$/, (ctx, branch) => {
    build(ctx, branch);
    const s = state(ctx);
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh')),
      true
    );
    assert.ok(s.result, 'the guard did not run');
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the guard passes$/, (ctx) => {
    const { result } = state(ctx);
    assert.equal(result.status, 0, `the guard refused: ${result.out}`);
  });

  scoped(/^it reports no offending feature$/, (ctx) => {
    assert.equal(state(ctx).result.out.trim(), '');
  });

  scoped(/^the guard refuses$/, (ctx) => {
    const { result } = state(ctx);
    assert.equal(result.status, 1, `the guard allowed an unrunnable tree: ${result.out}`);
  });

  scoped(/^the refusal names the "([^"]+)"$/, (ctx, phrase) => {
    const s = state(ctx);
    assert.match(
      s.result.out,
      new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `the refusal did not use the words "${phrase}": ${s.result.out}`
    );
    const artifact = namedArtifact(s, phrase);
    assert.ok(
      s.result.out.includes(artifact),
      `the refusal named the kind but not the artifact ${artifact}: ${s.result.out}`
    );
  });

  scoped(/^the refusal names all (\d+) feature files$/, (ctx, count) => {
    const s = state(ctx);
    const expected = s.built.map((entry) => entry.feature.split('/').pop());
    assert.equal(expected.length, Number(count));
    for (const feature of expected) {
      assert.ok(
        s.result.out.includes(feature),
        `the refusal stopped before ${feature}: ${s.result.out}`
      );
    }
    assert.match(s.result.out, new RegExp(`${count} offending artifact`));
  });
}

module.exports = { registerSteps };
