'use strict';

// BL-1877: step handlers for "A commit runs only the property files its
// change reaches" - check_property_suite_drift.sh (BL-570) now computes a
// reach before running the property lane (property_reach.js), and
// falls back to the whole lane only when that reach cannot be computed.
//
// Each scenario builds a throwaway git repo under /tmp (BL-1390: proven by
// git rev-parse --git-common-dir before any mutating git command), with
// its own copy of the guard, the libs it sources, and
// property_reach.js alongside them (SCRIPT_DIR resolution requires
// the reach script sit next to the guard). A recording suite command
// (bash -c that appends its own "$@" to a file) stands in for the real
// `npm run test:properties` / `npx vitest run` invocation, so the
// scenario can see exactly which files (if any) the guard asked it to run
// - never a *_FORCE_RESULT bypass.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD_LIBS = [
  'check_property_suite_drift.sh',
  'property_reach.js',
  'property_suite_shared_repo_guard.sh',
  'incoming_merge_parent_lib.sh',
  'property_suite_standing_allowlist_lib.sh',
];

function state(ctx) {
  if (!ctx.bl1877) ctx.bl1877 = {};
  return ctx.bl1877;
}

function sh(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assertFixtureRoot(root) {
  const gitCommonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  assert.ok(
    path.resolve(root, gitCommonDir).startsWith(root),
    `fixture root ${root} does not own its own .git (git-common-dir: ${gitCommonDir}) - refusing to run mutating git commands`,
  );
}

function initFixtureRepo() {
  const root = trackedTmpRoot('bl1877-');
  sh('git', ['init', '-q', '-b', 'main'], root);
  assertFixtureRoot(root);
  sh('git', ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init'], root);

  for (const name of GUARD_LIBS) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, name), path.join(root, name));
  }
  fs.chmodSync(path.join(root, 'check_property_suite_drift.sh'), 0o755);
  fs.mkdirSync(path.join(root, 'extension', 'out', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extension', 'test'), { recursive: true });

  const allowlistHeader = fs.readFileSync(
    path.join(SCRIPTS_DIR, 'property_suite_standing_allowlist.tsv'),
    'utf8',
  ).split('\n')[0];
  fs.writeFileSync(path.join(root, 'property_suite_standing_allowlist.tsv'), `${allowlistHeader}\n`);

  const recordFile = path.join(root, 'record.txt');
  const recorderScript = path.join(root, 'record.sh');
  fs.writeFileSync(
    recorderScript,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(recordFile)}\nexit 0\n`,
  );
  fs.chmodSync(recorderScript, 0o755);

  // The guard hands the reached files only to its own default suite
  // (`npx vitest run --config vitest.properties.config.mjs <files>`), after
  // `npm run compile`. Stub both on PATH: npm succeeds, npx records only
  // the property-file arguments it was given.
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  fs.mkdirSync(path.join(root, 'extension', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(binDir, 'npm'), '#!/usr/bin/env bash\nexit 0\n');
  fs.writeFileSync(
    path.join(binDir, 'npx'),
    `#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in *.property.test.js) printf '%s\\n' "$a";; esac; done > ${JSON.stringify(recordFile)}\nexit 0\n`,
  );
  fs.chmodSync(path.join(binDir, 'npm'), 0o755);
  fs.chmodSync(path.join(binDir, 'npx'), 0o755);

  return { root, recordFile, recorderScript, binDir };
}

function stageFile(root, relPath, content = 'v1') {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  sh('git', ['add', relPath], root);
}

function runGuard(fx, defaultSuite) {
  const guard = path.join(fx.root, 'check_property_suite_drift.sh');
  const args = defaultSuite ? [guard] : [guard, fx.recorderScript];
  const env = { ...process.env, PATH: `${fx.binDir}${path.delimiter}${process.env.PATH}` };
  const result = spawnSync('bash', args, { cwd: fx.root, encoding: 'utf8', env });
  fx.status = result.status;
  fx.stderr = result.stderr || '';
  fx.stdout = result.stdout || '';
  fx.recordedArgs = fs.existsSync(fx.recordFile)
    ? fs.readFileSync(fx.recordFile, 'utf8').split('\n').filter(Boolean)
    : null;
}

const FEATURE = 'BL-1877 A commit runs only the property files its change reaches';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with the property-suite guard and a recording suite command$/, (ctx) => {
    state(ctx).fx = initFixtureRepo();
  });

  scoped(/^a staged change to (.+)$/, (ctx, change) => {
    const { root } = state(ctx).fx;
    const st = state(ctx);

    if (change === 'one extension/src module that two property files import') {
      stageFile(root, 'extension/out/tools/sharedModule.js', 'module.exports = {};');
      stageFile(
        root,
        'extension/test/firstImporter.property.test.js',
        "require('../out/tools/sharedModule.js');\n",
      );
      stageFile(
        root,
        'extension/test/secondImporter.property.test.js',
        "require('../out/tools/sharedModule.js');\n",
      );
      stageFile(root, 'extension/src/tools/sharedModule.ts', 'export const x = 1;');
      st.expectedFiles = ['test/firstImporter.property.test.js', 'test/secondImporter.property.test.js'];
      return;
    }

    if (change === 'one property test file and nothing under extension/src') {
      stageFile(root, 'extension/test/standalone.property.test.js', "test('noop', () => {});\n");
      st.expectedFiles = ['test/standalone.property.test.js'];
      return;
    }

    if (change === 'one extension/src module whose reach cannot be computed') {
      stageFile(root, 'extension/src/tools/uncompiled.ts', 'export const y = 1;');
      // Deliberately no extension/out/tools/uncompiled.js - compile has
      // not produced what the reach graph needs, so it cannot be computed.
      return;
    }

    if (change === 'backlog evidence only') {
      stageFile(root, 'backlog/evidence/BL-9999-fixture.md', '# not a trigger path\n');
      return;
    }

    throw new Error(`unknown staged-change fixture shape: "${change}"`);
  });

  scoped(/^the property-suite guard runs$/, (ctx) => {
    // A reach scenario names its expected files; it runs the guard's own
    // default suite, the only path that receives the reach.
    runGuard(state(ctx).fx, Boolean(state(ctx).expectedFiles));
  });

  scoped(/^the suite command names exactly (.+)$/, (ctx, description) => {
    const st = state(ctx);
    assert.equal(st.fx.status, 0, `guard did not exit 0: ${st.fx.stderr}`);
    assert.ok(
      st.fx.recordedArgs !== null,
      `the recording command was never invoked, so no suite command ran (description: "${description}")`,
    );
    assert.deepEqual(
      [...st.fx.recordedArgs].sort(),
      [...st.expectedFiles].sort(),
      `expected the suite command to name exactly ${JSON.stringify(st.expectedFiles)} (${description}), got ${JSON.stringify(st.fx.recordedArgs)}`,
    );
  });

  scoped(/^it does not name the whole property lane$/, (ctx) => {
    const { stderr } = state(ctx).fx;
    const out = `${stderr}${state(ctx).fx.stdout}`;
    assert.doesNotMatch(out, /property-suite-guard: whole lane/, `the guard fell back to the whole lane: ${out}`);
    assert.match(
      out,
      /property-suite-guard: running the \d+ property files the staged change reaches/,
      `expected the guard to announce the reached files it runs, got: ${out}`,
    );
  });

  scoped(/^the suite command runs the whole property lane$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.fx.status, 0, `guard did not exit 0: ${st.fx.stderr}`);
    assert.match(
      st.fx.stderr,
      /^property-suite-guard: run$/m,
      `expected the bare whole-lane "run" marker (no "reached:" annotation), got: ${st.fx.stderr}`,
    );
    assert.deepEqual(
      st.fx.recordedArgs,
      [],
      `expected the whole-lane suite command to be invoked with no reach-narrowed file args, got ${JSON.stringify(st.fx.recordedArgs)}`,
    );
  });

  scoped(/^the suite command is not run$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.fx.status, 0, `guard did not exit 0: ${st.fx.stderr}`);
    assert.equal(
      st.fx.recordedArgs,
      null,
      `expected the recording command to never run, but it was invoked with ${JSON.stringify(st.fx.recordedArgs)}`,
    );
    assert.match(st.fx.stderr, /property-suite-guard: skip-paths/, `expected the skip-paths marker, got: ${st.fx.stderr}`);
  });
}

module.exports = { registerSteps };
