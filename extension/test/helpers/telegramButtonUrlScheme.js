'use strict';

// BL-1060: the one place "which URL schemes may a Telegram inline-keyboard
// `url:` button carry" is stated, so every test that pins a Telegram-facing
// button asserts the property the Bot API actually enforces rather than the
// identifier the code happens to pass.
//
// The distinction is the whole ticket. Both button tests asserted
// `button.url === buildBubblePairingDeepLink(live)`. They passed. They would
// have passed forever, while every live call returned
//
//   400 Bad Request: inline keyboard button URL
//   'swarmforge-bubble://pair?...' is invalid: Unsupported URL protocol
//
// because equality against the value under test cannot notice that the value
// is the wrong KIND of thing. A scheme check can.
//
// `web_app` buttons are a different field with a different rule (Telegram
// requires https there and validates it separately), and `callback_data`
// buttons carry no URL at all - only `url:` is in scope here.

// tg: is accepted by the Bot API alongside http(s). It is included because the
// rule being modelled is Telegram's, not "https only" - narrowing it here
// would make this helper reject a button Telegram would have taken, which is
// a different bug from the one it exists to catch.
const ACCEPTED_BUTTON_URL_SCHEMES = Object.freeze(['http:', 'https:', 'tg:']);

function schemeOf(url) {
  // Deliberately not `new URL(url).protocol`: a value the Bot API rejects is
  // frequently one WHATWG-URL cannot parse either, and throwing would turn a
  // violation this helper exists to name into an unhandled error at the call
  // site. A leading-scheme match reports the offending scheme in exactly the
  // cases that matter.
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:)/.exec(String(url ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Every `url:` button in one inline keyboard whose scheme Telegram rejects.
 * Returns [] for a clean keyboard - callers assert on the array, so a
 * violation always arrives with the text and scheme that caused it.
 */
function findButtonUrlSchemeViolations(keyboard) {
  const rows = Array.isArray(keyboard) ? keyboard : [];
  const violations = [];
  for (const row of rows) {
    for (const button of Array.isArray(row) ? row : []) {
      if (!button || typeof button.url !== 'string' || button.url === '') {
        continue;
      }
      const scheme = schemeOf(button.url);
      if (scheme === null || !ACCEPTED_BUTTON_URL_SCHEMES.includes(scheme)) {
        violations.push({
          text: button.text,
          url: button.url,
          scheme: scheme ?? '(no scheme)',
        });
      }
    }
  }
  return violations;
}

/** A one-line reason naming the offending scheme, for assertion messages. */
function describeViolations(violations) {
  return violations
    .map((v) => `"${v.text}" carries scheme ${v.scheme}, which Telegram rejects (accepted: ${ACCEPTED_BUTTON_URL_SCHEMES.join(', ')})`)
    .join('; ');
}

module.exports = { ACCEPTED_BUTTON_URL_SCHEMES, findButtonUrlSchemeViolations, describeViolations, schemeOf };
