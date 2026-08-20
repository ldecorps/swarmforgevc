'use strict';

// BL-948: the fixture-root gate for socket-building acceptance fixtures.
//
// swarm_socket_lib.bb refuses (fail-closed, BL-367) any unix-socket path
// over 100 chars. macOS resolves os.tmpdir() under /var/folders/<hash>/
// <hash>/T/, so a fixture root created there plus
// .swarmforge/tmux/<hash>.sock overruns the guard and a scenario fails on
// the refusal instead of the behaviour it asserts - hit by three separate
// step files on 2026-08-19 (BL-817, BL-938, BL-944's evidence), each
// patched locally. This gate is what makes the fourth recurrence
// impossible: a step file that BUILDS OR REFERENCES a control socket may
// not root its fixtures at os.tmpdir().
//
// Invariant 1 (BL-948): the gate defines the adoption set BY INSPECTION of
// each file's own text at gate time - never a checked-in roster of paths,
// which goes stale on the next step file and reproduces the one-at-a-time
// patching this ticket ends. A file is in scope iff BOTH hold:
//   - its code references a control socket (.swarmforge/tmux, tmux-socket,
//     or a .sock path), and
//   - it creates a fixture root at the long base
//     (fs.mkdtempSync(path.join(os.tmpdir(), ...))).
// Fixtures that never touch a socket are deliberately out of scope - the
// long base is harmless there and a sweep would be churn (BL-948
// constraints). The remedy for a flagged file is
// lib/socketFixtureRoot.js's mkSocketFixtureRoot.
//
// One implementation of these rules: the standing suite gate
// (extension/test/socketFixtureShortRootGuard.test.js), the generative
// property coverage, and the BL-948 acceptance steps all require THIS
// module - never a re-statement of the regexes.

const fs = require('node:fs');
const path = require('node:path');

// Full-line comments are stripped before the socket-reference check so
// prose about sockets (several fixtures document why they avoid the long
// base) never pulls a file into scope; string literals are kept - they are
// exactly where real socket paths live.
function stripFullLineComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const SOCKET_REFERENCE = /\.swarmforge\/tmux|tmux-socket|\.sock\b/;
const LONG_BASE_ROOT = /mkdtempSync\(\s*path\.join\(\s*os\.tmpdir\(\)/;

function findSocketFixtureRootViolation(filePath, text) {
  const code = stripFullLineComments(text);
  if (!SOCKET_REFERENCE.test(code)) {
    return null;
  }
  if (!LONG_BASE_ROOT.test(code)) {
    return null;
  }
  return {
    file: filePath,
    reason:
      'builds or references a control socket but roots its fixture at os.tmpdir() ' +
      '(long on macOS; the socket path overruns swarm_socket_lib.bb\'s 100-char ' +
      'guard) - use lib/socketFixtureRoot.js\'s mkSocketFixtureRoot instead',
  };
}

function scanForSocketFixtureRootViolations(dir) {
  const violations = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...scanForSocketFixtureRootViolations(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const violation = findSocketFixtureRootViolation(full, fs.readFileSync(full, 'utf8'));
      if (violation) violations.push(violation);
    }
  }
  return violations;
}

module.exports = { findSocketFixtureRootViolation, scanForSocketFixtureRootViolations };
