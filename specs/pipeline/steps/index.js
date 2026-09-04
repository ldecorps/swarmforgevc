'use strict';

// Combines every domain's step handlers into the project step registry.
//
// BL-1371: a handler is DISCOVERED from its own file. Until 2026-09-03 this
// module held a hand-maintained `DOMAINS` array of 937 `require('./blNNNSteps')`
// lines, so every ticket that added an acceptance scenario edited this one
// file. That coupling was not costing one gate - it produced three distinct
// incident classes, each of which presented as a different mystery:
//
//   - the Article 4.2 merge sweep charged essentially every merge-up with this
//     path, because it is the file both sides always touched (BL-1359);
//   - a tip-pure land replay leaked an unlanded sibling's require line into it
//     and blocked every commit to `main` until it was found (BL-1324);
//   - a land escalated because two BLOCKED tickets' require lines sat in the
//     same file as the approved ticket trying to land (BL-1356), which
//     deadlocked the land queue outright: a sibling's require line rides a
//     shared path WHOLE while its handler file cannot follow, so whichever
//     ticket landed first was refused on the others.
//
// None of those was a gate defect. Each gate correctly reported that a shared
// file carried another ticket's work. Registration being manual was the cause,
// and a handler discovered from its own file cannot be registered wrongly,
// lost by a revert, or leaked by a replay.
//
// The trade this makes, stated rather than glossed (ticket's own direction):
// the array was explicit and greppable, and a file only joined the suite when
// someone added a line - so a half-finished handler on a branch could not
// affect a run. Under discovery it joins by existing. loadHandler() below is
// what makes that acceptable: a file this directory cannot require fails the
// run loudly, naming it, rather than being skipped.
//
// Load order: discovery is sorted by file name, so it is deterministic but not
// the old append order. That is safe because resolution order can only matter
// to two DIFFERENT files registering the same pattern UNSCOPED, and BL-1277's
// standing guard (extension/test/bl1277UnscopedStepCollisionGuard.test.js)
// refuses exactly that state. A scoped registration is resolved by feature
// name, never by position.
const fs = require('node:fs');
const path = require('node:path');

// The discovery predicate: a top-level file in THIS directory whose name ends
// here. Kept as a named constant because guards outside this module assert on
// it (extension/test/helpers/materializedRegistryGuard.js) rather than
// restating the glob.
const HANDLER_SUFFIX = 'Steps.js';

// Non-recursive on purpose: steps/lib/ holds shared helpers, some of which end
// in `Steps.js` (lib/androidJvmDecisionSteps.js) and are required BY a handler
// rather than being one. The `*Only.js` focused entry points are excluded by
// the same predicate - each re-exports another file's registerSteps, and
// loading both would register every one of that file's patterns twice.
function discoverHandlerFiles(stepsDir = __dirname) {
  return fs
    .readdirSync(stepsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(HANDLER_SUFFIX))
    .sort()
    .map((name) => path.join(stepsDir, name));
}

// Invariant 2: discovery never silently skips what it could not require. The
// wrapper NAMES the file and keeps the original stack appended, because the
// module that actually failed may be a lib module several requires deep and
// the guard that reads this failure needs both names.
function loadHandler(file) {
  try {
    return require(file);
  } catch (cause) {
    const reason = (cause && cause.message) || String(cause);
    const failure = new Error(`specs/pipeline/steps: step handler ${file} could not be loaded: ${reason}`);
    failure.cause = cause;
    if (cause && cause.stack) {
      failure.stack = `${failure.stack}\ncaused by: ${cause.stack}`;
    }
    throw failure;
  }
}

function loadHandlers(stepsDir = __dirname) {
  return discoverHandlerFiles(stepsDir).map((file) => ({ file, domain: loadHandler(file) }));
}

function registerLoadedHandlers(registry, handlers) {
  for (const { domain } of handlers) {
    // A discovered file that exports no registerSteps contributes no steps and
    // does not fail the run - it loaded fine, it simply is not a handler.
    if (!domain || typeof domain.registerSteps !== 'function') {
      continue;
    }
    domain.registerSteps(registry);
  }
}

// EAGER, at module load, exactly as the DOMAINS array was. Requiring this
// registry loads every handler module, which is the semantics several guards
// are built on - BL-968's invariant 1 is a statement about what a step file may
// do AT MODULE LOAD, and its probe decides by requiring this file. Deferring
// the requires to the first registerSteps() call would leave that probe (and
// invariant 2's "fails the run loudly") passing on a tree that cannot load.
const HANDLERS = loadHandlers();

function registerSteps(registry) {
  registerLoadedHandlers(registry, HANDLERS);
}

module.exports = {
  registerSteps,
  registerLoadedHandlers,
  discoverHandlerFiles,
  loadHandlers,
  HANDLER_SUFFIX,
};
