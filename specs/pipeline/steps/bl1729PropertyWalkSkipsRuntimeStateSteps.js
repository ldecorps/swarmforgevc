'use strict';

// BL-1729: step handlers for "A property-lane repository walk never reads
// the checkout's runtime state". Drives the REAL walkFilesTolerant
// (extension/test/helpers/tolerantTreeWalk.js, BL-1443) against a REAL
// fixture git repository - never a restatement of its exclusion logic.
// Scenario 01's "never opened" is proven with a spying fsImpl recording
// every path passed to readFileSync, so a mutation that filters the
// RESULT after reading everything (rather than skipping the read itself)
// still fails - the exact distinction the ticket's own approval_context
// draws ("observable, not just 'filtered out after reading'").

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { walkFilesTolerant } = require('../../../extension/test/helpers/tolerantTreeWalk');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const GUARD_FUNCTION_NAME = 'bl1729GuardFn';
const GUARD_DEFINITION = `function ${GUARD_FUNCTION_NAME}() {}\n`;

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// BL-1390: proven isolated (git-common-dir resolves inside the fixture
// root) BEFORE any further git write - the same posture this codebase's
// other fixture-root builders (bl1563FixtureHelpers.js,
// operatorRuntimeFixtureGitRoot.js) already establish, kept as its own
// small copy here rather than a reach into either ticket's private helper
// ("small live-glue duplicated across independent test surfaces, no
// shared lifecycle worth coupling"). BL-1636: the root itself comes from
// fixtureReaper's trackedTmpRoot, never a raw fs.mkdtempSync - the standing
// step-handler-tmp-root-census guard requires every new handler's mkdtemp
// root to be reaper-tracked, the census itself frozen against new entries.
function mkFixtureRepo() {
  const root = trackedTmpRoot('bl1729-property-walk-');
  git(root, 'init', '-q');
  const commonDir = git(root, 'rev-parse', '--git-common-dir').trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  return root;
}

function writeTracked(root, rel, content, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return abs;
}

// Written directly to disk, never committed - a runtime directory's content
// is gitignored in the real checkout this fixture stands in for, and
// walkFilesTolerant reads the real filesystem regardless of git status
// anyway (it is not gitignore-aware), so tracking status itself is not
// what the walk's exclusion depends on.
function writeUntracked(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function findFunctionDefinitionFiles(rootDir, functionName, fsImpl) {
  const pattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
  const found = [];
  for (const { path: full, content: text } of walkFilesTolerant(rootDir, { extension: '.js', withContent: true, fsImpl })) {
    if (pattern.test(text)) {
      found.push(full);
    }
  }
  return found;
}

function spyingFsImpl(openedPaths) {
  return {
    readdirSync: (...args) => fs.readdirSync(...args),
    readFileSync: (p, ...args) => {
      openedPaths.push(p);
      return fs.readFileSync(p, ...args);
    },
  };
}

const RUNTIME_DIR_REL = { '.swarmforge/': '.swarmforge', 'tmp/': 'tmp' };

function registerSteps(registry) {
  registry.define(/^a fixture git repository whose \.gitignore lists \.swarmforge\/ and tmp\/$/, (ctx) => {
    ctx.root = mkFixtureRepo();
    writeTracked(ctx.root, '.gitignore', '.swarmforge/\ntmp/\n', 'seed: gitignore');
  });

  registry.define(/^a tracked \.js file in a nested source directory that defines the guard function$/, (ctx) => {
    ctx.trackedFile = writeTracked(ctx.root, path.join('src', 'lib', 'guard.js'), GUARD_DEFINITION, 'seed: tracked guard definition');
  });

  registry.define(/^the runtime directory (\S+) at the repository root holds a \.js file that also defines the guard function$/, (ctx, dirText) => {
    if (!Object.prototype.hasOwnProperty.call(RUNTIME_DIR_REL, dirText)) {
      throw new Error(`BL-1729: unrecognized <dir> example value "${dirText}"`);
    }
    const dirName = RUNTIME_DIR_REL[dirText];
    ctx.decoyFile = writeUntracked(ctx.root, path.join(dirName, 'decoy.js'), GUARD_DEFINITION);
  });

  registry.define(/^the shared property-lane tree walk reads the \.js files under the repository root$/, (ctx) => {
    ctx.openedPaths = [];
    ctx.found = findFunctionDefinitionFiles(ctx.root, GUARD_FUNCTION_NAME, spyingFsImpl(ctx.openedPaths));
  });

  registry.define(/^the file under (\S+) is never opened$/, (ctx) => {
    if (ctx.openedPaths.includes(ctx.decoyFile)) {
      throw new Error(`expected ${ctx.decoyFile} never opened by the walk; it was read`);
    }
  });

  registry.define(/^the only file found defining the guard function is the tracked one$/, (ctx) => {
    assert.deepEqual(ctx.found, [ctx.trackedFile]);
  });

  registry.define(/^a second tracked \.js file in another source directory also defines the guard function$/, (ctx) => {
    ctx.trackedFile2 = writeTracked(ctx.root, path.join('src', 'other', 'guard2.js'), GUARD_DEFINITION, 'seed: second tracked guard definition');
  });

  registry.define(/^both tracked files are found defining the guard function$/, (ctx) => {
    assert.deepEqual(ctx.found.slice().sort(), [ctx.trackedFile, ctx.trackedFile2].sort());
  });
}

module.exports = { registerSteps };
