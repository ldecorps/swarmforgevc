'use strict';

// BL-459: the load-bearing "every harness under swarmforge/scripts that
// creates a temp root registers a cleanup trap" check (fixture-process-
// leak-... no, tempdir-cleanup-trap-02) - mirrors extension/test/helpers/
// rawMkdtempGuard.js's own shape (BL-420) for the shell/bb side, so a NEW
// harness cannot silently reintroduce an un-cleaned /tmp leak.
//
// Scope is swarmforge/scripts ONLY (never swarmforge/vendor/) - the
// acceptance contract's own wording ("every shell/bb harness under
// swarmforge/scripts") excludes the vendored, pinned APS tooling, which is
// managed through the drift-watch review process (engineering.prompt), not
// hand-edited here.
//
// Granularity is FILE-LEVEL, not per-call-site: a file that creates a temp
// root (mktemp -d / fs/create-temp-dir) must ALSO contain a cleanup
// mechanism (a shell trap - directly or via the shared lib/tmp_cleanup.sh -
// or a bb shutdown hook / try+finally+delete-tree). This is deliberately
// coarser than correlating each individual call site, matching this
// ticket's own "shape is a trap, not a per-call proof" framing - a file
// that creates dirs and has no cleanup mechanism AT ALL is unambiguously a
// violation; a file that has the mechanism is trusted to apply it (the same
// trust boundary rawMkdtempGuard.js draws for the extension side, which
// bans the raw call ENTIRELY rather than proving each caller's own
// cleanliness).
const fs = require('node:fs');
const path = require('node:path');

const CREATES_SHELL_TMPDIR = /\bmktemp\s+-d\b/;
const HAS_SHELL_TRAP = /\btrap\b.*\bEXIT\b/;
const SOURCES_SHARED_TMP_CLEANUP = /tmp_cleanup\.sh/;

const CREATES_BB_TMPDIR = /fs\/create-temp-dir/;
const HAS_SHUTDOWN_HOOK = /addShutdownHook/;
const HAS_TRY_FINALLY_DELETE_TREE = /\(try\b[\s\S]*\(finally\b[\s\S]*delete-tree/;

// Exempt: the shared cleanup library itself carries the literal patterns as
// its own subject matter, not as a violation to detect. delete_tree calls
// on their own (outside a harness) are fine; this guard only cares about
// CREATION sites.
const SELF_EXEMPT_BASENAMES = new Set(['tmp_cleanup.sh']);

function shellFileViolation(text) {
  if (!CREATES_SHELL_TMPDIR.test(text)) {
    return null;
  }
  if (HAS_SHELL_TRAP.test(text) || SOURCES_SHARED_TMP_CLEANUP.test(text)) {
    return null;
  }
  return 'creates a temp root (mktemp -d) but has no EXIT trap and does not source lib/tmp_cleanup.sh';
}

function bbFileViolation(text) {
  if (!CREATES_BB_TMPDIR.test(text)) {
    return null;
  }
  if (HAS_SHUTDOWN_HOOK.test(text) || HAS_TRY_FINALLY_DELETE_TREE.test(text)) {
    return null;
  }
  return 'creates a temp root (fs/create-temp-dir) but has no shutdown hook and no try/finally delete-tree';
}

// Pure: given one file's own basename + text, returns a violation reason or
// null. Exported separately from the directory walk so a unit test can
// drive it directly against fixture strings, no filesystem needed.
function findTempDirTrapViolation(basename, text) {
  if (SELF_EXEMPT_BASENAMES.has(basename)) {
    return null;
  }
  if (basename.endsWith('.sh')) {
    return shellFileViolation(text);
  }
  if (basename.endsWith('.bb')) {
    return bbFileViolation(text);
  }
  return null;
}

// Impure: walks swarmforge/scripts (recursively, never swarmforge/vendor)
// and returns every violation found.
function scanForTempDirTrapViolations(scriptsDir) {
  const violations = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.sh') && !entry.name.endsWith('.bb')) {
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      const reason = findTempDirTrapViolation(entry.name, text);
      if (reason) {
        violations.push({ file: full, reason });
      }
    }
  }

  walk(scriptsDir);
  return violations;
}

module.exports = { findTempDirTrapViolation, scanForTempDirTrapViolations };
