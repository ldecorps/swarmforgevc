const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { writeFleetTelegramCreds, readFleetTelegramCreds } = require('../out/onboarding/fleetTelegramCredsStore');

// BL-436: writeFleetTelegramCreds / readFleetTelegramCreds is a
// round-trip pair (encode-then-decode = identity) over the swarm's own
// Telegram identity - exactly the property-testing shape the architect
// role owns (engineering.prompt's property-testing carve-out). The
// existing example-based unit test (fleetTelegramCredsStore.test.js)
// pins one hand-picked value; this runs the same round-trip invariant
// over a broad generated range of botToken/chatId strings and bridgePort
// numbers. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs's `test/**/*.property.test.js` glob) -
// never the normal unit/coverage/mutation run.
//
// Every case writes into its own fresh os.tmpdir() fixture standing in
// for the HOST home directory - never the real $HOME.

const credsArbitrary = fc.record({
  botToken: fc.string({ minLength: 1, maxLength: 200 }),
  chatId: fc.string({ minLength: 1, maxLength: 50 }),
  bridgePort: fc.integer({ min: 1, max: 65535 }),
});

test('property: writeFleetTelegramCreds then readFleetTelegramCreds round-trips any creds value', () => {
  fc.assert(
    fc.property(fc.webSegment().filter((s) => s.length > 0), credsArbitrary, (swarmName, creds) => {
      const home = mkTmpDir('sfvc-fleet-telegram-creds-prop-');

      writeFleetTelegramCreds(home, swarmName, creds);

      // fc.record() produces a null-prototype object; spread into a plain
      // one so the comparison is on values only, not prototype identity.
      assert.deepEqual(readFleetTelegramCreds(home, swarmName), { ...creds });
    }),
    { numRuns: 50 }
  );
});
