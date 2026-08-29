'use strict';

const fc = require('fast-check');

// BL-1247: the BL-593 telemetry property test's scope generator, extracted
// so the property test and this ticket's acceptance step handlers drive ONE
// generator, not two (required_wiring - same posture as bounceKeyPairArb.js
// under BL-768). requireLoadBearingMeta (mutationRunTelemetry.ts) refuses a
// scope that is blank after trimming; fc.string()'s default charset
// includes the space character, so an unfiltered fc.string() draws
// whitespace-only strings the guard correctly rejects. Filtering to
// non-blank keeps the domain wide (any real scope still round-trips) while
// never drawing a value the contract refuses.
const nonBlankScope = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim() !== '');

module.exports = { nonBlankScope };
