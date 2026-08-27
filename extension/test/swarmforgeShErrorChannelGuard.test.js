const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  findStdoutErrorEcho,
  scanScriptText,
  scanScriptFile,
} = require('../../specs/pipeline/steps/lib/swarmforgeShErrorChannel');

// BL-947: gives the launcher error-channel guard a standing home in the ONE
// suite every parcel runs (npm test/npm run coverage), matching the
// tempDirTrapGuard/tmuxReaperGuard/constitutionDocCitations precedent - a
// check parked only under specs/pipeline/test/ rots unrun, and 27 sites
// patched one at a time is exactly how this defect returns.

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'swarmforge.sh');

test('a raw stdout error echo is flagged', () => {
  const reason = findStdoutErrorEcho('  echo -e "${RED}Error:${RESET} something broke"');
  assert.ok(reason, 'expected a violation reason');
});

test('an error echo redirected to stderr is not flagged', () => {
  assert.equal(findStdoutErrorEcho('  echo -e "${RED}Error:${RESET} $*" >&2'), null);
});

test('an ordinary non-error line is not flagged', () => {
  assert.equal(findStdoutErrorEcho('  echo -e "${GREEN}OK${RESET} launched"'), null);
});

test('scanScriptText reports 1-indexed line numbers naming the offending text', () => {
  const text = 'ok line\necho -e "${RED}Error:${RESET} bad"\nok again\n';
  const violations = scanScriptText(text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
  assert.match(violations[0].text, /bad/);
});

// BL-947's own gate: the real launcher script has zero raw stdout error
// echoes. The error_msg helper's own body (the one legitimate
// `${RED}Error` echo left) passes because it carries the >&2 itself.
test('the real swarmforge.sh has zero error echoes left on stdout', () => {
  const violations = scanScriptFile(SCRIPT_PATH);
  assert.deepEqual(
    violations,
    [],
    `expected zero stdout error echoes, found:\n${violations
      .map((v) => `line ${v.line}: ${v.text}`)
      .join('\n')}`
  );
});

// The scan is only meaningful while error reporting actually goes through
// the helper - a rename or removal of error_msg would silently blank the
// corpus the scan protects, so pin both halves: the helper exists with its
// stderr redirect, and real call sites use it.
test('error_msg exists, routes to stderr, and is actually called', () => {
  const text = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(text, /error_msg\(\)\s*\{\s*\n\s*echo -e "\$\{RED\}Error:\$\{RESET\} \$\*" >&2/, 'expected the error_msg helper with a >&2 body');
  const callSites = (text.match(/^\s*error_msg "/gm) || []).length;
  assert.ok(callSites >= 27, `expected at least 27 error_msg call sites, found ${callSites}`);
});
