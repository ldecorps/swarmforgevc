'use strict';

// BL-1905: a fixture's own copy of the scripts tree. The receive and
// completion dispatchers (ready_for_next*, done_with_current*) cd into their
// own scripts dir before they run, so the REAL ones receive and complete in
// the checkout that holds the real scripts, as the fixture's role, against
// the live mailbox. Run the copy this installs instead: its cd lands inside
// the fixture's checkout. That checkout must be a git checkout or a linked
// worktree of the fixture, so that the copy's git root is the fixture's.
// BL-998's shell fixtures do the same through lib/install_scripts.sh.

const fs = require('node:fs');
const path = require('node:path');

const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'swarmforge', 'scripts');

// Copies every top-level .bb and .sh of the real scripts dir into
// <checkout>/swarmforge/scripts (executable) and returns that dir.
function installScripts(checkout) {
  const dest = path.join(checkout, 'swarmforge', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    const full = path.join(REAL_SCRIPTS_DIR, name);
    if ((name.endsWith('.bb') || name.endsWith('.sh')) && fs.statSync(full).isFile()) {
      fs.copyFileSync(full, path.join(dest, name));
      fs.chmodSync(path.join(dest, name), 0o755);
    }
  }
  return dest;
}

module.exports = { installScripts };
