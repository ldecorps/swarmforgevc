'use strict';

// BL-1060 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "No inline-keyboard button this extension emits carries a
//   url: whose scheme Telegram rejects. A button url is http(s); a
//   custom-scheme URI reaches the user only through a page Telegram will
//   open, never as the button url itself."
//
//   Invariant 2: "A test pinning a Telegram-facing button asserts the
//   property the API enforces - the scheme - not merely the identifier the
//   code happens to pass."
//
// Invariant 1 says "no button THIS EXTENSION emits", not "no button in the two
// call sites BL-1060 fixed", so the builders are DISCOVERED from the compiled
// tree rather than hand-listed: a keyboard builder added next month is covered
// the day it lands, with nobody remembering to add it here. The discovery is
// floored (P1c) so it can never quietly cover zero builders and pass.
//
// Invariant 2 is the reason this file exists at all. Both original tests
// asserted `button.url === buildBubblePairingDeepLink(live)` and passed
// forever while every live call returned "Unsupported URL protocol" - the
// identifier was right and the KIND of value was wrong, and equality cannot
// tell those apart. P2 is that claim made executable: the shared checker must
// REFUSE the exact value the old tests accepted.
//
// REACH, asserted rather than hoped for. The generator draws tunnel URLs, not
// button objects: a drawn button object would let the property assert about
// shapes the builders can never produce while never exercising the builders
// themselves. Tokens are drawn to include the characters that survive
// encodeURIComponent differently (&, =, #, space, unicode), because the pair
// URL is assembled by string concatenation around one encodeURIComponent call
// and a token that changes the URL's SHAPE - not just its text - is how an
// https URL turns into something the API would reject.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const {
  ACCEPTED_BUTTON_URL_SCHEMES,
  findButtonUrlSchemeViolations,
  describeViolations,
} = require('./helpers/telegramButtonUrlScheme');
const {
  buildBubblePairingDeepLink,
  buildResidentSpyTunnelUrls,
} = require('../out/concierge/residentSpyTunnelNotify');

const OUT = path.join(__dirname, '..', 'out');
const SRC = path.join(__dirname, '..', 'src');

function walk(dir, ext, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, acc);
    else if (entry.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

// Every exported keyboard builder in the compiled tree. Named by convention
// (`build*Buttons`), which is the convention this codebase already follows -
// and P1c fails loudly if that convention stops finding anything, rather than
// letting the property pass over an empty set.
function discoverKeyboardBuilders() {
  const found = [];
  for (const file of walk(OUT, '.js')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/exports\.(build[A-Za-z0-9_]*Buttons)\b/g)) {
      const mod = require(file);
      if (typeof mod[m[1]] === 'function') {
        found.push({ name: m[1], fn: mod[m[1]], file: path.relative(OUT, file) });
      }
    }
  }
  return found;
}

const BUILDERS = discoverKeyboardBuilders();

const tunnelUrl = fc
  .record({
    host: fc.constantFrom('foo.trycloudflare.com', 'bubble.musicalsifu.com', 'a-b-c.example.org'),
    token: fc.oneof(
      fc.stringMatching(/^[A-Za-z0-9]{1,24}$/),
      // The characters that make a token change the URL's SHAPE, not just its
      // text - exactly where an https URL can stop being one.
      fc.constantFrom('a&b=c', 'tok#frag', 'has space', 'ünïcødé', 'a/b?c', '')
    ),
  })
  .map(({ host, token }) => `https://${host}/resident-spy?token=${encodeURIComponent(token)}`);

test('property (invariant 1): every discovered keyboard builder emits only accepted button schemes', () => {
  let invocations = 0;
  fc.assert(
    fc.property(tunnelUrl, (live) => {
      const urls = buildResidentSpyTunnelUrls(new URL(live).origin, new URL(live).searchParams.get('token') ?? '');
      for (const { name, fn, file } of BUILDERS) {
        let keyboard;
        try {
          keyboard = fn(urls);
        } catch {
          // A builder taking a different argument shape is not evidence of a
          // violation; P1c is what stops the whole property degrading to
          // "everything threw, nothing was checked".
          continue;
        }
        invocations += 1;
        const violations = findButtonUrlSchemeViolations(keyboard);
        assert.deepEqual(violations, [],
          `${file}::${name} — ${describeViolations(violations)}`);
      }
    }),
    { numRuns: 200 }
  );
  // P1c: the discovery actually reached the builders. Without this floor a
  // renamed convention, an empty out/, or a builder that always throws would
  // make every run above vacuous and still green.
  assert.ok(invocations >= 200,
    `the property invoked only ${invocations} builder call(s) - discovery found ${BUILDERS.length} builder(s), so it is covering far less than it claims`);
});

test('property (invariant 1): the discovery finds every keyboard builder the compiled tree exports', () => {
  const exported = new Set();
  for (const file of walk(OUT, '.js')) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/exports\.(build[A-Za-z0-9_]*Buttons)\b/g)) {
      exported.add(m[1]);
    }
  }
  assert.ok(exported.size > 0, 'no keyboard builders found at all - compile out/ before running this');
  assert.deepEqual(
    [...exported].sort(),
    [...new Set(BUILDERS.map((b) => b.name))].sort(),
    'a builder is exported but was not discovered - the property would silently skip it'
  );
});

test('property (invariant 2): the checker REFUSES the exact value the old tests accepted', () => {
  let refused = 0;
  fc.assert(
    fc.property(tunnelUrl, (live) => {
      // buildBubblePairingDeepLink is what both builders passed at HEAD, and
      // what both tests asserted equality against. A checker that does not
      // refuse it would have let the live 400 through exactly as they did.
      const deepLink = buildBubblePairingDeepLink(live);
      const violations = findButtonUrlSchemeViolations([
        [{ text: 'Update Bubble pairing', url: deepLink }],
      ]);
      assert.equal(violations.length, 1, `the app-scheme URI was accepted: ${deepLink}`);
      assert.ok(!ACCEPTED_BUTTON_URL_SCHEMES.includes(violations[0].scheme));
      assert.match(describeViolations(violations), new RegExp(violations[0].scheme.replace(':', ':')));
      refused += 1;
    }),
    { numRuns: 200 }
  );
  assert.ok(refused >= 200, `the refusal path ran only ${refused} time(s)`);
});

test('property (invariant 1): no source button literal passes a custom-scheme deep link as a url', () => {
  // The static half. A builder that takes an argument shape the dynamic half
  // cannot construct would slip past it; this reads the source instead, so a
  // future call site is caught at the point it is written.
  const offenders = [];
  for (const file of walk(SRC, '.ts')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/url:\s*([A-Za-z_$][A-Za-z0-9_$.]*)/g)) {
      if (/deeplink$/i.test(m[1].split('.').pop())) {
        offenders.push(`${path.relative(SRC, file)}: url: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `a custom-scheme deep link is passed as an inline-button url - it must reach the user through a page Telegram will open: ${offenders.join('; ')}`);
});
