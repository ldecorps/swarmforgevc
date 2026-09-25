'use strict';

// BL-1699's declared invariant 1: "No text an aider seat is given at
// launch or bootstrap (launch arguments excepted) contains a path that
// exists in the repository or the basename of any file under
// swarmforge/scripts." aider-bootstrap-text (prompt_engine_lib.bb) is a
// pure function of role and an optional two-pack note - exercised here
// across a generated population of role names (the seven pipeline roles,
// the coordinator's own distinct branch, and arbitrary unknown role
// strings a future pack might name) and coord-notes (absent, or the
// two-pack overlay sentence), asserting neither branch's output contains
// any git-tracked repo path or any basename of a file under
// swarmforge/scripts. The seat's two static role notes
// (swarmforge/roles/aider/coder.note, generic.note - loaded via --read,
// a launch argument, but their CONTENT is still text the model reads) are
// checked against the same predicate directly, since they are fixed
// files, not a generator's output.
//
// Declared invariant 2 ("For every non-aider provider in every pack
// conf, the generated launch line and bootstrap text are byte-identical
// to the output of main before this ticket") is not a pure module a
// generator can drive - it quantifies over swarmforge.sh's real launch-
// script assembly across every real pack conf file, same disposition
// BL-1697/BL-1698's own invariant 2 used. Encoded instead by scenario 06
// of specs/pipeline/steps/bl1699AiderSeatLaunchAndBootstrapSteps.js
// ("a Claude seat's launch line and bootstrap are unchanged"), which
// regenerates every pack's launch scripts and bootstrap texts against a
// `git archive main` checkout and diffs every non-aider provider's output
// byte-for-byte (QA bounce D3, 2026-09-25: the prior header named a
// golden-fixture comparison in test_aider_seat_launch_config.sh that does
// not exist - the invariant itself held, only this pointer was wrong).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_lib.bb');

function gitLines(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const REPO_PATHS = gitLines(['ls-files']);
const SCRIPTS_BASENAMES = Array.from(
  new Set(gitLines(['ls-files', 'swarmforge/scripts']).map((p) => path.basename(p)))
);

// BL-1699 QA bounce D2 (2026-09-25): aider's own file-mention rule adds
// any REPLY WORD that exactly equals a tracked relative path, a directory
// PREFIX of one, or (for this ticket's own launch config) a
// swarmforge/scripts basename - never a substring match, and never with a
// length floor (the D1 leaks QA found were "swarm" (5 chars) and "seat"
// (4), both below the old 6-char floor, and "backlog"/"scripts", both
// directories the old REPO_PATHS - files only - never listed at all).
const DIR_PREFIXES = new Set();
for (const p of REPO_PATHS) {
  const parts = p.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    DIR_PREFIXES.add(parts.slice(0, i).join('/'));
  }
}
const FORBIDDEN_WORDS = new Set([...REPO_PATHS, ...DIR_PREFIXES, ...SCRIPTS_BASENAMES]);

// Whole-word match: split on whitespace, strip leading/trailing
// punctuation a sentence would carry (quotes, periods, commas, colons,
// parens) but keep internal path separators/dots, exactly the shape a
// real tracked path or basename would appear as when correctly embedded.
function words(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w./-]+/, '').replace(/[^\w./-]+$/, ''))
    .filter(Boolean);
}

function forbiddenHit(text) {
  for (const word of words(text)) {
    if (FORBIDDEN_WORDS.has(word)) {
      return { kind: 'forbidden-word', value: word };
    }
  }
  return null;
}

// Non-vacuity: the predicate itself must catch every shape QA's own bounce
// found, including the two short words a length-floor check missed.
assert.ok(
  forbiddenHit('...then run `swarmforge/scripts/ready_for_next.sh` once...'),
  'forbiddenHit must flag a real repo path embedded in prose'
);
assert.ok(forbiddenHit('inspect swarm and backlog state'), 'forbiddenHit must flag the short tracked file "swarm"');
assert.ok(forbiddenHit('this is a seat running aider'), 'forbiddenHit must flag the short scripts basename "seat"');
assert.ok(forbiddenHit('promote from backlog/paused into backlog/active'), 'forbiddenHit must flag directory prefixes');
assert.equal(forbiddenHit('nothing to see here'), null);
assert.equal(forbiddenHit('a seating chart'), null, 'must be whole-word, never a substring match');

// BL-1699 QA bounce D1's own fix: aider-bootstrap-text takes a two-pack?
// boolean (never the shared coord-note, which names backlog/paused and
// backlog/active for every OTHER provider) and builds its own path-free
// sentence internally.
function aiderBootstrapText(role, twoPack) {
  const expr = `(load-file "${LIB}") (print (prompt-engine-lib/aider-bootstrap-text ${JSON.stringify(role)} ${twoPack ? 'true' : 'false'}))`;
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
}

const KNOWN_ROLES = ['coordinator', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

test('aider-bootstrap-text never leaks a repo path or a swarmforge/scripts basename', () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.constantFrom(...KNOWN_ROLES), fc.stringMatching(/^[a-z][a-z-]{2,12}$/)),
      fc.boolean(),
      (role, twoPack) => {
        const text = aiderBootstrapText(role, twoPack);
        const hit = forbiddenHit(text);
        assert.equal(hit, null, `${role}/two-pack=${twoPack}: leaked ${hit && hit.kind} "${hit && hit.value}"`);
      }
    ),
    { numRuns: 15 }
  );
});

test('the static aider role notes carry no repo path or scripts basename', () => {
  const fs = require('node:fs');
  for (const rel of ['swarmforge/roles/aider/coder.note', 'swarmforge/roles/aider/generic.note']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const hit = forbiddenHit(text);
    assert.equal(hit, null, `${rel}: leaked ${hit && hit.kind} "${hit && hit.value}"`);
  }
});
