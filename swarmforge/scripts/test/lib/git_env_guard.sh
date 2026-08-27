# BL-1200: sourced by a fixture or a suite entry point to strip an inherited
# GIT_DIR/GIT_WORK_TREE redirect before any git command in this process runs,
# so a fixture's own `git init`/`git commit` cannot be pointed at whatever
# repository an ambient environment variable happens to name (the shell twin
# of BL-1196's extension/test/helpers/gitEnvGuardSetup.js).
#
# Unsets rather than overrides: a test that deliberately sets either variable
# AFTER sourcing this file, for its own purposes, still works - this only
# clears a value inherited from the calling shell at source time.
#
# Safe to source more than once, and safe under `set -u` when neither
# variable was set to begin with - `unset` on a name that is already unset is
# a no-op in every POSIX shell, never an error.
unset GIT_DIR GIT_WORK_TREE
