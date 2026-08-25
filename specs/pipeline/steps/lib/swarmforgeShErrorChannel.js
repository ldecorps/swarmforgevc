'use strict';

// BL-947: the load-bearing "every error-reporting line in swarmforge.sh
// writes to stderr" check - mirrors tmuxReaperGuard.js's shape (pure
// classifier + thin file read) for the error-channel concern this ticket
// closes. swarmforge.sh had 27 `echo -e "${RED}Error:${RESET} ..."` lines,
// none redirected to stderr, so a caller capturing stderr saw silence on
// every failure path and a caller capturing a command-substitution VALUE
// (the control socket path is the live example) got the error text mixed
// into it - BL-944's evidence misdiagnosed a socket-path refusal as "no
// output" for exactly this reason.
//
// The fix routes every site through one `error_msg()` helper whose body
// carries the `>&2`; this scanner is what keeps the next error line from
// being added on the wrong channel (27 sites patched one at a time is how
// this returns - the ticket's own words). An error-reporting line is any
// line carrying the `${RED}Error` echo shape; it passes only if it
// redirects to stderr itself (the helper's own body does) - every other
// error site is expected to call error_msg, which this scanner does not
// need to see to trust, because a raw echo is the only way to get the
// shape WITHOUT the helper's redirect.

const fs = require('node:fs');

const ERROR_ECHO_SHAPE = /echo\s+-e\s+"\$\{RED\}Error/;
const STDERR_REDIRECT = /\s1?>&2\s*(#.*)?$/;

// Pure: classify one line. Returns null when the line is fine (not an
// error echo at all, or an error echo that redirects to stderr), or a
// reason string when it is a raw stdout error echo.
function findStdoutErrorEcho(line) {
  if (!ERROR_ECHO_SHAPE.test(line)) {
    return null;
  }
  if (STDERR_REDIRECT.test(line.trimEnd())) {
    return null;
  }
  return 'error echo without a >&2 redirect - diagnostics must leave by stderr (BL-947)';
}

// Pure: scan a whole script's text. Returns [{line, text, reason}] for
// every raw stdout error echo, 1-indexed line numbers.
function scanScriptText(text) {
  const violations = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const reason = findStdoutErrorEcho(lines[i]);
    if (reason) {
      violations.push({ line: i + 1, text: lines[i].trim(), reason });
    }
  }
  return violations;
}

// Impure: read the real script and scan it.
function scanScriptFile(scriptPath) {
  return scanScriptText(fs.readFileSync(scriptPath, 'utf8'));
}

module.exports = { findStdoutErrorEcho, scanScriptText, scanScriptFile };
