'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { spawnSync } = require('node:child_process');
const { NAMED_TUNNEL_IDENTITY_VARS, isolatedEnv } = require('./helpers/namedTunnelEnvIsolation');

// BL-867 declared invariants (property authorship rests with the coder,
// first pass - BL-654). These test the BL-787 fixture's OWN isolation
// mechanism (isolatedEnv), not the scripts it drives against: a case's own
// choice of which named-tunnel identity vars to name is the ONLY thing
// that may determine what a fixture subprocess sees - ambient host
// contamination must never move the needle. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).
//
// Generator reach (BL-654): the "contaminated" ambient is DERIVED from the
// case's own overrides in every run - every identity var the case does
// NOT name gets an arbitrary decoy value injected into ambient, so every
// generated pair (clean vs. contaminated) is a genuine collision candidate
// by construction, never two independently-drawn environments that might
// coincidentally agree.
const identitySubsetArb = fc.subarray([...NAMED_TUNNEL_IDENTITY_VARS]);
const decoyArb = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !/[\n\0]/.test(s));

test('property (BL-867 invariant 1): the merged fixture env is a function of the case alone, never ambient host contamination', () => {
  fc.assert(
    fc.property(identitySubsetArb, decoyArb, decoyArb, (namedVars, caseValue, decoyValue) => {
      const overrides = {};
      for (const key of namedVars) overrides[key] = `case:${key}:${caseValue}`;
      const absentVars = NAMED_TUNNEL_IDENTITY_VARS.filter((key) => !namedVars.includes(key));

      const cleanAmbient = { PATH: process.env.PATH };
      const contaminatedAmbient = { ...cleanAmbient };
      for (const key of absentVars) {
        contaminatedAmbient[key] = `ambient-decoy:${key}:${decoyValue}`;
      }

      const cleanResult = isolatedEnv(overrides, cleanAmbient);
      const contaminatedResult = isolatedEnv(overrides, contaminatedAmbient);

      for (const key of NAMED_TUNNEL_IDENTITY_VARS) {
        assert.equal(
          contaminatedResult[key],
          cleanResult[key],
          `expected ${key} to be identical whether or not ambient contamination is present (clean=${JSON.stringify(cleanResult[key])}, contaminated=${JSON.stringify(contaminatedResult[key])})`
        );
      }
    }),
    { numRuns: 50 }
  );
});

test('property (BL-867 invariant 2): a case that names an identity var absent truly does not see it in the subprocess', () => {
  fc.assert(
    fc.property(identitySubsetArb, decoyArb, (namedVars, decoyValue) => {
      const overrides = {};
      for (const key of namedVars) overrides[key] = `case-value-${key}`;
      const absentVars = NAMED_TUNNEL_IDENTITY_VARS.filter((key) => !namedVars.includes(key));
      if (absentVars.length === 0) {
        return; // this draw names every identity var - nothing to prove absent
      }

      // Derive the contaminated ambient from THIS case: only the vars the
      // case leaves unset get a decoy value, so a pass here can never be
      // explained by "the ambient never covered the leak vector".
      const contaminatedAmbient = { PATH: process.env.PATH };
      for (const key of absentVars) {
        contaminatedAmbient[key] = decoyValue;
      }

      const env = isolatedEnv(overrides, contaminatedAmbient);

      // Probe via a real subprocess, not the JS object, so a leak that only
      // manifests at the OS environment boundary (e.g. a delete that misses
      // a prototype/enumerable quirk) is caught too, mirroring how the real
      // scripts under test observe absence.
      const probe = absentVars.map((key) => `[[ -z "\${${key}:-}" ]] || { echo "LEAKED:${key}=$${key}"; exit 1; }`).join('\n');
      const result = spawnSync('bash', ['-c', probe], { env, encoding: 'utf8', timeout: 5000 });
      assert.equal(
        result.status,
        0,
        `expected every identity var the case leaves unset to be truly absent at the subprocess boundary: ${result.stdout}${result.stderr}`
      );
    }),
    { numRuns: 50 }
  );
});
