'use strict';

// BL-868 invariant 2: "Every Vitest configuration that executes test files
// registers the shared isolation guards; a lane cannot exist without them."
// This is the pure check the property test below fuzzes and the
// BL-868-property-lane-isolation-guards-04 acceptance scenario applies to
// the two real config files. It reads SOURCE TEXT rather than importing the
// config module, so it works uniformly whether the config is ESM or CJS and
// never actually executes a config file's side effects (os.totalmem(),
// requiring compiled output that may not exist yet, etc).
const REQUIRED_SETUP_BASENAMES = Object.freeze(['tmpDirSetup.js', 'envRestoreGuardSetup.js']);

// A setupFiles entry can be single- or double-quoted and may use any
// relative prefix ('./test/helpers/x.js', 'test/helpers/x.js', '../x.js') -
// only the basename is load-bearing for "is the guard registered", so match
// on that rather than pinning one exact path spelling.
function findMissingIsolationGuards(configSourceText, requiredBasenames = REQUIRED_SETUP_BASENAMES) {
  return requiredBasenames.filter((basename) => !configSourceText.includes(basename));
}

function configRegistersIsolationGuards(configSourceText, requiredBasenames = REQUIRED_SETUP_BASENAMES) {
  return findMissingIsolationGuards(configSourceText, requiredBasenames).length === 0;
}

module.exports = { REQUIRED_SETUP_BASENAMES, findMissingIsolationGuards, configRegistersIsolationGuards };
