'use strict';

// BL-1696's two declared invariants.
//
// Invariant 1: "Every `seat` invocation runs at most the one script or git
// subcommand its verb names, and a refused invocation (malformed argument,
// verb outside the role's set, unknown verb) runs nothing and leaves the
// working tree unchanged." Encoded as a CONSTRUCTED catalog of malformed
// specs (one per required-argument shape, per verb, plus an unknown verb)
// crossed with every named role (including unset) - the acceptance
// feature's own scenario 02 exercises eight of these combinations; this
// property sweeps every verb's own malformed shapes against every role, a
// far larger reach than the acceptance scenario alone.
//
// Invariant 2: "No caller-supplied argument is ever evaluated by a shell:
// each reaches its script as one argv element, and text arguments
// containing a dollar sign, a backtick, a backslash or a double quote are
// refused." The four forbidden-character classes are CONSTRUCTED as real
// shell-injection idioms targeting a marker file unique to each fixture -
// a generator drawing arbitrary strings would reach these specific
// characters, in a specific injectable shape, essentially never. A second,
// randomized sweep then varies filler text, character position, and which
// field (ask text vs. note message) carries the forbidden character.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { makeSeatFixture } = require('./helpers/seatFixture');

const ALL_ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator'];
const FIXTURE_ROLES = ['coordinator', 'coder', 'cleaner', 'QA'];

// One malformed shape per required-argument rule, plus an unknown verb.
// Every entry is refused (exit 2) regardless of which role runs it: either
// the argument shape is wrong, or (for a role missing the verb entirely,
// e.g. coordinator/handoff) the verb itself is refused before arguments
// are even inspected - both are the SAME observable outcome the invariant
// describes.
const MALFORMED_SPECS = [
  { verb: 'next', args: ['unexpected'] },
  { verb: 'done', args: ['unexpected'] },
  { verb: 'ask', args: [] },
  { verb: 'ask', args: ['one', 'two'] },
  { verb: 'note', args: ['cleaner', '5', 'short priority'] },
  { verb: 'note', args: ['ghost-role', '50', 'unknown role'] },
  { verb: 'note', args: ['cleaner', '50', 'a'.repeat(81)] },
  { verb: 'handoff', args: ['ghost-role', 'BL-7'] },
  { verb: 'handoff', args: ['cleaner', '7'] },
  { verb: 'handoff', args: ['cleaner'] },
  { verb: 'merge', args: ['ghost-role', 'deadbeefde'] },
  { verb: 'merge', args: ['cleaner', 'not-a-sha'] },
  { verb: 'merge', args: ['cleaner'] },
  { verb: 'test', args: ['unexpected'] },
  { verb: 'rebase', args: ['main'] },
  { verb: 'bogus-verb', args: [] },
];

test('invariant 1: every catalogued malformed shape, against every role (including unset), runs nothing and leaves the tree unchanged', () => {
  const fx = makeSeatFixture();
  try {
    fx.writeRolesFile(FIXTURE_ROLES);
    const baseline = fx.statusPorcelain();
    const reach = new Set();
    const roles = [...ALL_ROLES, null];
    for (const spec of MALFORMED_SPECS) {
      for (const role of roles) {
        reach.add(`${spec.verb}\u0000${JSON.stringify(spec.args)}\u0000${role}`);
        const result = fx.run(role, [spec.verb, ...spec.args]);
        assert.equal(
          result.status,
          2,
          `spec ${JSON.stringify(spec)} role ${role}: expected exit 2, got ${result.status}: ${result.stderr}`
        );
      }
    }
    // Reach floor: every (spec, role) pair was actually driven, not just
    // planned - a filtered or short-circuited loop would silently shrink
    // this without failing any single iteration's own assertion.
    assert.equal(reach.size, MALFORMED_SPECS.length * roles.length);
    assert.equal(
      fx.recordedCalls().length,
      0,
      `a script call was recorded across the sweep: ${JSON.stringify(fx.recordedCalls())}`
    );
    assert.equal(fx.statusPorcelain(), baseline, 'the working tree changed across the sweep');
  } finally {
    fx.cleanup();
  }
});

function markerPath(fx) {
  return path.join(fx.root, 'MARKER');
}

// Invariant 2, non-vacuous by construction: each payload is a real
// shell-injection idiom that would create MARKER if `seat` (or anything it
// calls) ever handed caller text to a shell for evaluation instead of
// refusing it outright.
function forbiddenPayloads(fx) {
  const marker = markerPath(fx);
  return [
    { name: 'dollar-subshell', text: `pre$(touch ${marker})post` },
    { name: 'backtick-subshell', text: `pre\`touch ${marker}\`post` },
    { name: 'backslash-escape', text: `pre\\ntouch ${marker}` },
    { name: 'double-quote-break', text: `pre" ; touch ${marker} ; echo "post` },
  ];
}

test('invariant 2: a forbidden-character payload is refused and never reaches a shell, for every required character class', () => {
  const fx = makeSeatFixture();
  try {
    fx.writeRolesFile(FIXTURE_ROLES);
    const reach = new Set();
    for (const { name, text } of forbiddenPayloads(fx)) {
      reach.add(name);
      const result = fx.run('coder', ['ask', text]);
      assert.equal(result.status, 2, `${name}: expected exit 2, got ${result.status}: ${result.stderr}`);
      assert.ok(!fs.existsSync(markerPath(fx)), `${name}: MARKER exists - the payload reached a shell`);
    }
    for (const n of ['dollar-subshell', 'backtick-subshell', 'backslash-escape', 'double-quote-break']) {
      assert.ok(reach.has(n), `reach floor: ${n} was never constructed`);
    }
    assert.equal(fx.recordedCalls().length, 0, 'a script call was recorded during the injection sweep');
  } finally {
    fx.cleanup();
  }
});

const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-';
const forbiddenCharArb = fc.constantFrom('$', '`', '\\', '"');
const fillerArb = fc
  .array(fc.constantFrom(...SAFE_CHARS.split('')), { minLength: 0, maxLength: 15 })
  .map((chars) => chars.join(''));
const positionArb = fc.constantFrom('start', 'middle', 'end');
const fieldArb = fc.constantFrom('ask-text', 'note-message');

test('invariant 2: any argument containing a forbidden character is refused, across ask/note and every position', () => {
  const fx = makeSeatFixture();
  try {
    fx.writeRolesFile(FIXTURE_ROLES);
    const baseline = fx.statusPorcelain();
    fc.assert(
      fc.property(forbiddenCharArb, fillerArb, fillerArb, positionArb, fieldArb, (badChar, pre, post, pos, field) => {
        const text =
          pos === 'start' ? badChar + pre + post : pos === 'end' ? pre + post + badChar : pre + badChar + post;
        assert.ok(text.includes(badChar), 'reach floor: the constructed text must carry the forbidden character');
        const args = field === 'ask-text' ? ['ask', text] : ['note', 'cleaner', '50', text];
        const result = fx.run('coder', args);
        assert.equal(
          result.status,
          2,
          `char=${JSON.stringify(badChar)} field=${field} pos=${pos} text=${JSON.stringify(text)}: expected exit 2, got ${result.status}`
        );
      }),
      { numRuns: 60 }
    );
    assert.equal(
      fx.recordedCalls().length,
      0,
      `a script call was recorded during the forbidden-character sweep: ${JSON.stringify(fx.recordedCalls())}`
    );
    assert.equal(fx.statusPorcelain(), baseline, 'the working tree changed during the forbidden-character sweep');
  } finally {
    fx.cleanup();
  }
});
