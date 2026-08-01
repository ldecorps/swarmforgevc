const assert = require('node:assert/strict');
const fc = require('fast-check');
const { buildBubblePairingDeepLink } = require('../out/concierge/residentSpyTunnelNotify');

// BL-716 dns-05 (architect property pass): buildBubblePairingDeepLink encodes
// an arbitrary origin+token pair into a swarmforge-bubble://pair query string
// for Bubble's deep-link handler to decode on the phone. The unit suite pins
// a handful of literal examples; this is an encode/decode-shape invariant
// (query-parameter round-trip) that should hold across the input range, not
// just the examples picked by hand — a token containing '&', '=', or unicode
// is exactly the case a fixed-string suite would miss. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).

test('property: buildBubblePairingDeepLink preserves origin and token for any live URL/token pair', () => {
  fc.assert(
    fc.property(fc.webUrl(), fc.string(), (liveUrlBase, token) => {
      const base = new URL(liveUrlBase);
      const liveUrl = `${base.origin}${base.pathname}?token=${encodeURIComponent(token)}`;
      const deepLink = buildBubblePairingDeepLink(liveUrl);
      const parsed = new URL(deepLink);
      assert.equal(parsed.protocol, 'swarmforge-bubble:');
      assert.equal(parsed.searchParams.get('url'), base.origin);
      assert.equal(parsed.searchParams.get('token'), token);
    })
  );
});
