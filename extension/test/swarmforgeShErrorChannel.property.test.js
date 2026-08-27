const assert = require('node:assert/strict');
const fc = require('fast-check');
const { findStdoutErrorEcho, scanScriptText } = require('../../specs/pipeline/steps/lib/swarmforgeShErrorChannel');

// BL-947 (coder.prompt's Invariants section - first authorship rests with
// the coder): coder-authored property tests for this ticket's declared
// invariant 1 - "stdout of swarmforge.sh carries values, never
// diagnostics". The invariant quantifies over the launcher's shell script,
// not a pure JS module; its executable encoding is the enforcement
// mechanism itself - the pure classifier in
// specs/pipeline/steps/lib/swarmforgeShErrorChannel.js, which is what
// keeps every present AND future error line off stdout. These properties
// prove the classifier's verdict is a function of exactly two things (the
// error-echo shape, the stderr redirect) across generated message content,
// indentation and redirect spelling - so the standing guard can neither
// miss a raw error echo however its message reads, nor false-positive a
// value-producing line into being "switched off" as noise (the ticket's
// own invariant-1 warning). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from unit/coverage/mutation.
//
// Invariant 2 ("a failure that already had a specific reason keeps naming
// it - this ticket changes the CHANNEL, never the text and never the exit
// status") is NOT encoded here: it quantifies over the DIFF's own scope
// (which bytes of which messages changed), not over a pure function's
// behaviour across generated inputs - no generator input's variation
// exercises "did the fix rewrite a message". Verified instead by the
// mechanical shape of the fix (every site's message string is passed to
// error_msg verbatim; the helper emits the identical
// `${RED}Error:${RESET} <msg>` bytes, only on fd 2 - confirmed
// byte-identical on the live socket-refusal reproduction before/after)
// and by acceptance scenario 02, which asserts the refusal still names
// the limit, the offending path and its measured length. Recorded per
// BL-654's stated-reason rule.
//
// Non-vacuity, checked by hand before landing: making findStdoutErrorEcho
// ignore the redirect (always flag the shape) fails the never-flagged
// property on its first redirected case; making it always return null
// fails the always-flagged property just as fast. Restored, all pass.

const msgArb = fc.stringMatching(/^[A-Za-z0-9 '_.$/{}():-]{0,60}$/);
const indentArb = fc.constantFrom('', '  ', '    ', '\t');
const redirectArb = fc.constantFrom('>&2', '1>&2', ' >&2', '  >&2');

test('property: a raw error echo is always flagged, whatever its message or indentation', () => {
  fc.assert(
    fc.property(indentArb, msgArb, (indent, msg) => {
      const line = `${indent}echo -e "\${RED}Error:\${RESET} ${msg}"`;
      assert.ok(findStdoutErrorEcho(line), `expected a violation for: ${line}`);
    }),
    { numRuns: 300 }
  );
});

test('property: an error echo with a stderr redirect is never flagged, whatever the redirect spelling', () => {
  fc.assert(
    fc.property(indentArb, msgArb, redirectArb, (indent, msg, redirect) => {
      const line = `${indent}echo -e "\${RED}Error:\${RESET} ${msg}" ${redirect}`;
      assert.equal(findStdoutErrorEcho(line), null, `expected no violation for: ${line}`);
    }),
    { numRuns: 300 }
  );
});

test('property: a value-producing or non-error line is never flagged, whatever it prints', () => {
  const nonErrorLineArb = fc.oneof(
    msgArb.map((m) => `echo "${m}"`),
    msgArb.map((m) => `echo -e "\${GREEN}OK\${RESET} ${m}"`),
    msgArb.map((m) => `TMUX_SOCKET="$(bb resolve.bb "${m}")"`),
    msgArb.map((m) => `# ${m}`),
    fc.constant('error_msg "some failure reason"')
  );
  fc.assert(
    fc.property(nonErrorLineArb, (line) => {
      assert.equal(findStdoutErrorEcho(line), null, `expected no violation for: ${line}`);
    }),
    { numRuns: 300 }
  );
});

test('property: scanScriptText finds every raw echo in a generated script, at its exact 1-indexed line', () => {
  const cleanLineArb = fc.oneof(
    msgArb.map((m) => `echo "${m}"`),
    msgArb.map((m) => `# ${m}`),
    fc.constant('error_msg "reason"'),
    msgArb.map((m) => `echo -e "\${RED}Error:\${RESET} ${m}" >&2`)
  );
  const rawLineArb = msgArb.map((m) => `echo -e "\${RED}Error:\${RESET} ${m}"`);
  const lineArb = fc.oneof({ arbitrary: cleanLineArb, weight: 3 }, { arbitrary: rawLineArb, weight: 1 });

  fc.assert(
    fc.property(fc.array(lineArb, { minLength: 1, maxLength: 30 }), (lines) => {
      const expected = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^echo -e "\$\{RED\}Error/.test(lines[i]) && !/>&2$/.test(lines[i])) {
          expected.push(i + 1);
        }
      }
      const found = scanScriptText(lines.join('\n')).map((v) => v.line);
      assert.deepEqual(found, expected);
    }),
    { numRuns: 200 }
  );
});
