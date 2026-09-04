'use strict';

// BL-1371: step handlers are found by their own file, never by a line in a
// shared list.
//
// Registration used to be a `require('./blNNNSteps')` line appended to a
// hand-maintained array in index.js. That made one file a co-owner of every
// ticket in the project, and three distinct incident classes came out of the
// coupling (the Article 4.2 merge over-charge, BL-1324's replay leak, and
// BL-1356's land entanglement) - none of them a defect in the gate reporting
// it. A handler discovered from its own file needs no shared edit at all, and
// cannot be unregistered by a revert that leaves the file behind.
//
// The trade, stated rather than glossed: the array was explicit and
// greppable, and a file only joined the suite when someone added a line.
// Under discovery a half-finished handler on a branch joins by existing. That
// is acceptable ONLY because a file that cannot be required fails the run
// loudly, naming it (loadStepHandlerModules below) - never a silent skip.
//
// This module is deliberately free of any require of the extension tree or of
// a handler module at load time, so requiring it costs nothing and it stays
// unit-testable with injected fs.

const fs = require('node:fs');
const path = require('node:path');

// A step handler file is one whose name ends in this suffix. Mirrored in
// extension/src/tools/featureHandlerRegistrationTypes.ts as
// HANDLER_FILE_SUFFIX for the BL-1303 registration guard, which reasons about
// the same set statically; extension/test/bl1371StepDiscovery.test.js asserts
// the two literals agree (BL-897 - a constant mirrored across a language
// boundary needs a test pinning both sides).
const HANDLER_FILE_SUFFIX = 'Steps.js';

/**
 * The step handler file names directly in `dir`, sorted by name.
 *
 * Sorted rather than insertion-ordered because discovery has no insertion
 * order to preserve, and a deterministic order is what makes a run
 * reproducible. Verified equivalent to the old array order at the time of the
 * change: over the 18164 concrete steps in specs/features/, every one
 * resolved to the SAME handler under both orders, and no two handler files
 * register the same unscoped pattern (evidence in the parcel).
 *
 * Subdirectories (steps/lib/) are not handlers: a lib module joins the run by
 * being required from a handler, exactly as before.
 */
function stepHandlerFileNames(dir, { readdir = fs.readdirSync } = {}) {
  return readdir(dir, { withFileTypes: true })
    .filter((entry) => (typeof entry.isDirectory === 'function' ? !entry.isDirectory() : true))
    .map((entry) => (typeof entry.name === 'string' ? entry.name : String(entry)))
    .filter((name) => name.endsWith(HANDLER_FILE_SUFFIX))
    .sort();
}

/**
 * Requires every discovered handler file and keeps the ones that export a
 * `registerSteps` function.
 *
 * A file that exports no steps contributes nothing and does NOT fail the run -
 * the steps directory has always carried focused entry modules and helpers
 * beside the handlers. A file that THROWS when required fails the whole load,
 * with the failure naming the file and carrying the original stack, so a
 * broken handler can never be silently skipped into a green run.
 */
function loadStepHandlerModules(dir, { readdir, requireModule = require } = {}) {
  const loaded = [];
  for (const name of stepHandlerFileNames(dir, { readdir })) {
    const full = path.join(dir, name);
    let handlerModule;
    try {
      handlerModule = requireModule(full);
    } catch (err) {
      const detail = err && err.stack ? err.stack : String(err);
      throw new Error(`step handler ${name} could not be loaded (${full}): ${detail}`);
    }
    if (handlerModule && typeof handlerModule.registerSteps === 'function') {
      loaded.push({ name, module: handlerModule });
    }
  }
  return loaded;
}

/** Registers every discovered handler's steps into `registry`, in name order. */
function registerDiscoveredSteps(registry, dir, deps = {}) {
  for (const { module: handlerModule } of loadStepHandlerModules(dir, deps)) {
    handlerModule.registerSteps(registry);
  }
}

module.exports = {
  HANDLER_FILE_SUFFIX,
  stepHandlerFileNames,
  loadStepHandlerModules,
  registerDiscoveredSteps,
};
