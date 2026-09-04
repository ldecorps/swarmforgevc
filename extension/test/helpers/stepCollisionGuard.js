'use strict';

// BL-1277: the standing guard's core, shared between the vitest guard
// (extension/test/bl1277UnscopedStepCollisionGuard.test.js), the two
// invariant property tests, and the BL-1277 acceptance step handlers - one
// enumeration, one verdict path, so every lane drives the SAME guard rather
// than a re-statement of it.
//
// The verdict comes from the registry's OWN entries: each step file is loaded
// and asked to register into a fresh createStepRegistry(), and the collision
// set is computed from registry.listDefinitions(). Nothing here reads
// step-file source text looking for `registry.define` - a source scan would
// disagree with the registry the acceptance run actually uses the moment a
// file registers through a local wrapper, a loop, or a shared helper (several
// already do).

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findExtensionRoot } = require('./materializedRegistryGuard');

const EXTENSION_ROOT = findExtensionRoot(__dirname);
const REPO_ROOT = path.dirname(EXTENSION_ROOT);
const STEPS_INDEX = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'index.js');
const STEP_REGISTRY = path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry.js');
const VERDICT_MARKER = 'BL1277_COLLISION_VERDICT ';

// The shipped step files are exactly the ones steps/index.js pulls in, in the
// order it pulls them in - taken from the module system's own parent/child
// record rather than by globbing the directory. A glob would also sweep up the
// `*Only.js` focused entry points, each of which re-exports another file's
// registerSteps; those would then look like a second file registering every
// one of that file's patterns, and the guard would refuse a repository that is
// in fact clean.
function shippedStepFiles(indexPath = STEPS_INDEX) {
  const resolved = require.resolve(indexPath);
  require(resolved);
  const record = require.cache[resolved];
  if (!record) {
    throw new Error(`stepCollisionGuard: ${indexPath} did not land in require.cache`);
  }
  return record.children.map((child) => child.filename);
}

function patternKey(pattern) {
  return `${pattern.source} ${pattern.flags}`;
}

// One entry per step file: which patterns it registers unscoped. Only the
// unscoped ones can shadow another file.
function registrationsByFile(stepFiles) {
  const { createStepRegistry } = require(STEP_REGISTRY);
  return stepFiles.map((file) => {
    const registry = createStepRegistry();
    require(file).registerSteps(registry);
    const unscoped = [];
    for (const { pattern, featureName } of registry.listDefinitions()) {
      if (!featureName) {
        unscoped.push(pattern);
      }
    }
    return { file, unscoped };
  });
}

// A collision is one pattern registered unscoped by two or more DIFFERENT
// files. A single file registering the same text twice shadows nobody but
// itself and is not this ticket's defect.
function findUnscopedCollisions(stepFiles) {
  const byPattern = new Map();
  for (const { file, unscoped } of registrationsByFile(stepFiles)) {
    for (const pattern of unscoped) {
      const key = patternKey(pattern);
      let entry = byPattern.get(key);
      if (!entry) {
        entry = { pattern, files: [] };
        byPattern.set(key, entry);
      }
      if (!entry.files.includes(file)) {
        entry.files.push(file);
      }
    }
  }
  const collisions = [];
  for (const { pattern, files } of byPattern.values()) {
    if (files.length > 1) {
      collisions.push({ pattern: pattern.source, files });
    }
  }
  return collisions.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

// Repository files read better relative to the repo root; a synthetic file
// written to a temp tree (the guard's own tests) is named in full, because a
// `../../..`-prefixed relative path would name it worse, not better.
function relativize(file) {
  const rel = path.relative(REPO_ROOT, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

function formatRefusal(collisions) {
  const lines = [
    `${collisions.length} step pattern(s) are registered unscoped by more than one step file.`,
    'Whichever file steps/index.js loads first answers that step text for EVERY feature,',
    "so the other files' scenarios silently run the wrong handler against the wrong fixture.",
    'Pin each to its own feature with registry.defineScoped(pattern, handler, FEATURE).',
    '',
  ];
  for (const { pattern, files } of collisions) {
    lines.push(`  ${pattern}`);
    for (const file of files) {
      lines.push(`    - ${relativize(file)}`);
    }
  }
  return lines.join('\n');
}

// The whole verdict in one call: { ok, collisions, message }.
function collisionVerdict(stepFiles) {
  const files = stepFiles || shippedStepFiles();
  const collisions = findUnscopedCollisions(files);
  return {
    ok: collisions.length === 0,
    collisions,
    message: collisions.length === 0 ? '' : formatRefusal(collisions),
  };
}

// The shipped-repository verdict is computed in a CHILD process, for the same
// reason BL-968's guard spawns the resolver: loading all ~800 shipped step
// files pulls in whatever they pull in (several reach `node:test`, which
// derails vitest's own collection if it is imported into a worker), and a
// guard must not be able to break the lane it runs in. The child runs THIS
// file's `collisionVerdict` - one verdict path, two processes.
function shippedCollisionVerdict(indexPath) {
  const args = [__filename];
  if (indexPath) {
    args.push(indexPath);
  }
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  // Several shipped step files import `node:test`, whose runner prints its own
  // TAP report to stdout at exit - so the verdict is found by MARKER, never as
  // "the last line", which would be whatever TAP happened to flush last.
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith(VERDICT_MARKER));
  if (!line) {
    throw new Error(`stepCollisionGuard: child exited ${res.status} with no verdict: ${res.stderr || ''}`.trim());
  }
  return JSON.parse(line.slice(VERDICT_MARKER.length));
}

function main(argv) {
  const indexPath = argv[2];
  const files = shippedStepFiles(indexPath || STEPS_INDEX);
  const verdict = collisionVerdict(files);
  return { verdict, ok: verdict.ok };
}

if (require.main === module) {
  const { verdict, ok } = main(process.argv);
  process.stdout.write(`${VERDICT_MARKER}${JSON.stringify(verdict)}\n`);
  process.exitCode = ok ? 0 : 1;
}

module.exports = {
  REPO_ROOT,
  main,
  shippedCollisionVerdict,
  STEPS_INDEX,
  shippedStepFiles,
  registrationsByFile,
  findUnscopedCollisions,
  formatRefusal,
  collisionVerdict,
};
