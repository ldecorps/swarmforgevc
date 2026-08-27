'use strict';

// BL-997/BL-897 invariant 2: "when the check fails it names both literals,
// so the drift is diagnosable without reading both languages and without
// knowing which side moved." One shared function - the acceptance step
// handler (bl997BusyMarkerAgreementSteps.js), the regular test
// (bl997BusyMarkerAgreement.test.js), and the property test
// (bl997BusyMarkerAgreement.property.test.js) all call THIS, never a
// second hand-rolled comparison, so the message contract cannot drift
// between them.
function checkAgreement(babashkaVerdict, typescriptVerdict) {
  if (babashkaVerdict !== typescriptVerdict) {
    throw new Error(`babashka=${babashkaVerdict} typescript=${typescriptVerdict} - disagreement`);
  }
}

module.exports = { checkAgreement };
