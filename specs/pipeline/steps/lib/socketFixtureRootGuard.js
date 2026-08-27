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

// Any `tmpdir()` call, whatever the receiver: `os.tmpdir()`, a destructured
// `tmpdir()`, `require('os').tmpdir()`. The long base is the VALUE, so the
// spelling that produced it must not decide whether the gate sees it.
const TMPDIR_CALL = /\btmpdir\s*\(\s*\)/;

// A binding whose value comes from tmpdir(): `const base = os.tmpdir()`.
// Captured so a root built from the alias is still recognised as the long
// base - hoisting it into a variable is the most natural way to write this
// and was invisible to the original single-form pattern.
const TMPDIR_ALIAS = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\btmpdir\s*\(\s*\)/g;

const MKDTEMP_CALL = /\bmkdtempSync\s*\(/g;

// Quoted-string CONTENTS are blanked before the long-base check (and only
// there - SOCKET_REFERENCE deliberately keeps literals, since real socket
// paths live in them). Real code never spells `os.tmpdir()` inside a quoted
// string; a file that contains that text in a literal is carrying an
// EXAMPLE, which is what BL-948's own acceptance steps do. Without this,
// broadening the rule makes the gate read this parcel's test DATA as a call
// site. Template literals are left intact on purpose: `${os.tmpdir()}` is a
// real spelling, and its tmpdir call is an expression, not text.
function blankQuotedStrings(code) {
  return code
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

// The argument text of one `mkdtempSync(` call, sliced by paren balance so
// the check reads that call's OWN base rather than anything else on the
// line. Unbalanced source (a truncated fragment) yields what is there.
function mkdtempArgText(code, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(openParenIndex + 1, i);
    }
  }
  return code.slice(openParenIndex + 1);
}

// BL-948 invariant 1, applied to the RULE as well as to the roster: a gate
// that recognises exactly one syntactic form is a hand-maintained list of
// spellings rather than of file names, and the fourth recurrence only has
// to be written differently. Measured 2026-08-20: the original pattern
// caught 1 of 6 realistic long-base spellings. Every `mkdtempSync(` call is
// therefore inspected for a tmpdir() reference of any spelling, including
// one reached through a local alias.
function rootsAtLongBase(rawCode) {
  const code = blankQuotedStrings(rawCode);
  const aliases = [];
  for (const match of code.matchAll(TMPDIR_ALIAS)) aliases.push(match[1]);

  for (const call of code.matchAll(MKDTEMP_CALL)) {
    const args = mkdtempArgText(code, call.index + call[0].length - 1);
    if (TMPDIR_CALL.test(args)) return true;
    if (aliases.some((name) => new RegExp(`\\b${name}\\b`).test(args))) return true;
  }
  return false;
}

function findSocketFixtureRootViolation(filePath, text) {
  const code = stripFullLineComments(text);
  if (!SOCKET_REFERENCE.test(code)) {
    return null;
  }
  if (!rootsAtLongBase(code)) {
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

module.exports = { findSocketFixtureRootViolation, scanForSocketFixtureRootViolations, rootsAtLongBase };
