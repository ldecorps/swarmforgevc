'use strict';

// BL-1030 declared invariants 1 and 2 (property authorship rests with the
// coder, first pass - BL-654):
//
//   1. "Every forbidden flag that would reach the shell as its own token is
//      refused, and no token that merely contains one as a substring is
//      refused."
//   2. "A configured stop command the guard cannot tokenize is refused, never
//      admitted - the guard fails closed."
//
// Invariant 1 is a claim about what the SHELL would do, not about what our
// tokenizer thinks, so REAL bash is the oracle: every admissible draw is run
// through `bash -c "printf ..."` and the words bash actually produces decide
// what the verdict should have been. A property that compared the guard
// against my own splitter would be checking a function against itself, which
// is the shape of the defect this ticket fixes (four green assertions written
// in a shape the caller could not produce).
//
// The generator constructs collisions rather than hoping for them, per the
// coder prompt's generator-reach rule: a look-alike token is DERIVED from a
// forbidden flag by the transformation the old code conflated - substring
// containment - so every look-alike draw is a genuine collision candidate.
// Drawing paths and flags independently would make a real collision
// vanishingly rare and the property would pass while proving nothing.
//
// All draws reach the REAL Babashka predicate in ONE batched call: load-file
// dominates a bb invocation, and a call per draw buys no extra coverage.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - the token test replaced by substring containment
//     (`(some #(str/includes? cmd %) forbidden-stop-flags)`): RED on the first
//     look-alike draw, "refused a token that only CONTAINS a forbidden flag".
//   break 2 - tokenize-command's operator handling removed, so `--full;`
//     stays fused to its separator: RED in the compound-command sweep, "a
//     forbidden flag following a shell operator was admitted". Note it is NOT
//     red in the first sweep: that generator is deliberately operator-free so
//     bash can be its oracle, which is exactly why the third test exists.
//   break 3 - stop-invocation-verdict admitting when tokenize-command returns
//     nil (fail OPEN instead of closed): RED on the first unreadable draw,
//     "a command the guard cannot read was admitted".
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const EXPEDITE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_lib.bb');

const FORBIDDEN = ['--sweep-inbox', '--reset-worktrees', '--full'];
const DRAWS = 60;

const rng = (() => {
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
const randInt = (n) => Math.floor(rng() * n);
const randNth = (xs) => xs[randInt(xs.length)];
const randWord = () => {
  let w = '';
  for (let i = 0, n = 3 + randInt(7); i < n; i += 1) w += String.fromCharCode(97 + randInt(26));
  return w;
};

// Every generated character comes from this alphabet, so a draw handed to the
// bash oracle can do nothing but split into words.
const safePath = () => `/${randWord()}/${randWord()}-${randWord()}`;

// ── the collision constructor ───────────────────────────────────────────
// A look-alike is DERIVED from a forbidden flag, never drawn beside one.
// These are the four ways a real target path can carry a flag's spelling
// without being that flag.
const LOOKALIKE_SHAPES = [
  (flag) => `/repos${flag}-fix`, // embedded mid-path
  (flag) => `/repos/${randWord()}${flag}`, // suffix
  (flag) => `${flag.slice(2)}`, // the flag without its dashes
  (flag) => `/repos/${flag.replace(/^--/, '')}-${randWord()}`, // spelling only
];

// A quoted look-alike: the flag IS a whole word inside the token, but the
// quotes make the token one word, so it is not a flag. This is the case a
// naive "split on whitespace then compare" would get wrong in the other
// direction.
const quotedLookalike = (flag) => `'/repos/my ${flag} target'`;

function buildAdmissibleDraw() {
  // No operators, no expansions, balanced quotes: bash can be the oracle.
  const parts = ['./stop-swarm.sh'];
  const kind = randInt(3);
  if (kind === 0) {
    parts.push(randNth(FORBIDDEN)); // a real flag, as its own token
  } else if (kind === 1) {
    parts.push(randNth(LOOKALIKE_SHAPES)(randNth(FORBIDDEN)));
  } else {
    parts.push(quotedLookalike(randNth(FORBIDDEN)));
  }
  if (randInt(3) === 0) parts.push(safePath());
  return parts.join(' ');
}

// ── the fail-closed constructor ─────────────────────────────────────────
// Each shape breaks readability in a different way, and each is built by
// mutilating an otherwise ordinary command so the draw stays realistic.
const UNREADABLE_SHAPES = [
  () => `./stop-swarm.sh '${randNth(FORBIDDEN)}`, // unterminated single quote
  () => `./stop-swarm.sh "${randNth(FORBIDDEN)}`, // unterminated double quote
  () => `./stop-swarm.sh ${safePath()}\\`, // dangling escape
  () => `./stop-swarm.sh $${randWord().toUpperCase()}`, // parameter expansion
  () => `./stop-swarm.sh $(cat ${randWord()})`, // command substitution
  () => `./stop-swarm.sh \`cat ${randWord()}\``, // backquoted substitution
];

// What bash really does with a command line. Only ever called on draws built
// by buildAdmissibleDraw, which contain no operator and no expansion - the
// words are all `printf` ever sees.
function bashWords(command) {
  const res = spawnSync('bash', ['-c', `printf '%s\\0' ${command}`], { encoding: 'buffer' });
  assert.equal(res.status, 0, `the bash oracle failed on: ${command}`);
  const out = res.stdout.toString('utf8');
  const words = out.split('\0');
  words.pop(); // trailing empty after the final NUL
  return words;
}

// The REAL predicate, over every draw, in one call.
function guardVerdicts(commands) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${EXPEDITE_LIB}")
(println (json/generate-string
          (vec (for [c (json/parse-string (slurp *in*))]
                 (let [v (expedite-lib/stop-invocation-verdict c)]
                   {:ok (:ok? v)
                    :reason (some-> (:reason v) name)
                    :flag (:flag v)
                    :tokens (expedite-lib/tokenize-command c)})))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', input: JSON.stringify(commands) });
  assert.equal(res.status, 0, `the real expedite guard failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('BL-1030/BL-654 invariant 1: a forbidden flag is refused exactly when the SHELL makes it a token of its own', () => {
  const commands = [];
  for (let i = 0; i < DRAWS; i += 1) commands.push(buildAdmissibleDraw());

  const verdicts = guardVerdicts(commands);
  assert.equal(verdicts.length, commands.length, 'the guard must answer once per draw');

  let refusedCount = 0;
  let lookalikeCount = 0;

  commands.forEach((command, i) => {
    const words = bashWords(command);
    const guard = verdicts[i];

    // The tokenizer's claim is that it reproduces the shell. Check it, rather
    // than trusting it - everything below rests on it.
    assert.deepEqual(
      guard.tokens,
      words,
      `the guard tokenized differently from bash for: ${command}`
    );

    const shellForbidden = words.filter((w) => FORBIDDEN.includes(w));
    if (shellForbidden.length > 0) {
      refusedCount += 1;
      assert.equal(guard.ok, false, `bash produced a forbidden token that the guard admitted: ${command}`);
      assert.equal(guard.reason, 'forbidden-flag');
      assert.ok(
        shellForbidden.includes(guard.flag),
        `the guard blamed "${guard.flag}", which is not one of the forbidden words bash produced for: ${command}`
      );
    } else {
      lookalikeCount += 1;
      assert.equal(
        guard.ok,
        true,
        `refused a token that only CONTAINS a forbidden flag - a target path is not a flag: ${command}`
      );
      // And the containment really is there, or this half proves nothing.
      assert.ok(
        FORBIDDEN.some((flag) => command.includes(flag) || command.includes(flag.replace(/^--/, ''))),
        `generator error: an admitted draw carried no forbidden spelling at all: ${command}`
      );
    }
  });

  // Generator reach: an asserted floor, not a hoped-for one. Both halves of
  // the invariant have to be exercised or the sweep is one-sided.
  assert.ok(refusedCount >= 12, `generator coverage: only ${refusedCount} of ${DRAWS} draws were real flags (floor 12)`);
  assert.ok(
    lookalikeCount >= 12,
    `generator coverage: only ${lookalikeCount} of ${DRAWS} draws were substring look-alikes (floor 12)`
  );
});

// ── invariant 1, where bash cannot be the oracle ────────────────────────
// A compound command cannot be handed to `printf` - the shell would RUN its
// second half. So these draws carry a constructed expectation instead: the
// flag is placed where the shell unambiguously makes it a word of its own,
// and the guard has to find it there. This is the family the operator-free
// sweep above cannot reach, and it is where a tokenizer that fuses a flag to
// an adjacent separator hides.
const OPERATOR_SHAPES = [
  (flag) => `./stop-swarm.sh && ./stop-swarm.sh ${flag}`,
  (flag) => `./stop-swarm.sh; ./stop-swarm.sh ${flag}`,
  (flag) => `./stop-swarm.sh ${flag};`,
  (flag) => `./stop-swarm.sh ${flag} && ./stop-swarm.sh`,
  (flag) => `./stop-swarm.sh | ./stop-swarm.sh ${flag}`,
];

test('BL-1030/BL-654 invariant 1, compound commands: a flag beside a shell operator is still its own token', () => {
  const commands = [];
  const shapes = [];
  for (let i = 0; i < DRAWS; i += 1) {
    const shapeIndex = i % OPERATOR_SHAPES.length;
    shapes.push(shapeIndex);
    commands.push(OPERATOR_SHAPES[shapeIndex](randNth(FORBIDDEN)));
  }

  const verdicts = guardVerdicts(commands);
  commands.forEach((command, i) => {
    const guard = verdicts[i];
    assert.equal(guard.ok, false, `a forbidden flag following a shell operator was admitted: ${command}`);
    assert.equal(guard.reason, 'forbidden-flag', `refused for the wrong reason on: ${command}`);
    assert.ok(FORBIDDEN.includes(guard.flag), `the guard blamed "${guard.flag}", which is not a forbidden flag`);
    assert.ok(command.includes(guard.flag), `the guard blamed a flag the command does not carry: ${command}`);
    // The separator is a token in its own right, never fused onto the flag.
    assert.ok(
      guard.tokens.includes(guard.flag),
      `the flag was fused to its separator, so a whole-token test can never see it: ${JSON.stringify(guard.tokens)}`
    );
  });

  for (let s = 0; s < OPERATOR_SHAPES.length; s += 1) {
    const hits = shapes.filter((x) => x === s).length;
    assert.ok(hits >= 5, `generator coverage: operator shape ${s} reached only ${hits} times (floor 5)`);
  }

  // The other direction: an operator does not by itself make a command
  // forbidden, or this test would pass against a guard that refuses every
  // compound command.
  const safe = guardVerdicts(['./stop-swarm.sh && ./stop-swarm.sh', './stop-swarm.sh; ./stop-swarm.sh /repos/full-fix']);
  assert.deepEqual(safe.map((v) => v.ok), [true, true], 'a compound command with no forbidden flag was refused');
});

test('BL-1030/BL-654 invariant 2: a command the guard cannot tokenize is refused, never admitted', () => {
  const commands = [];
  const shapes = [];
  for (let i = 0; i < DRAWS; i += 1) {
    const shapeIndex = i % UNREADABLE_SHAPES.length;
    shapes.push(shapeIndex);
    commands.push(UNREADABLE_SHAPES[shapeIndex]());
  }

  const verdicts = guardVerdicts(commands);
  assert.equal(verdicts.length, commands.length);

  commands.forEach((command, i) => {
    const guard = verdicts[i];
    assert.equal(guard.ok, false, `a command the guard cannot read was admitted: ${command}`);
    assert.equal(
      guard.reason,
      'unreadable',
      `refused for the wrong reason ("${guard.reason}") - a fail-closed refusal must say it could not read the line: ${command}`
    );
    assert.equal(guard.tokens, null, `the tokenizer claimed to read a line it cannot: ${command}`);
  });

  // Every shape reached, so no single family of unreadability carries the run.
  for (let s = 0; s < UNREADABLE_SHAPES.length; s += 1) {
    const hits = shapes.filter((x) => x === s).length;
    assert.ok(hits >= 5, `generator coverage: unreadable shape ${s} reached only ${hits} times (floor 5)`);
  }

  // The other direction, so "refuses everything" cannot pass this test: the
  // ordinary command an operator actually configures is still admitted.
  const sane = guardVerdicts(['./stop-swarm.sh', `./stop-swarm.sh ${safePath()}`]);
  assert.deepEqual(
    sane.map((v) => v.ok),
    [true, true],
    'the guard refuses the default command - fail-closed must not mean fail-always'
  );
});
