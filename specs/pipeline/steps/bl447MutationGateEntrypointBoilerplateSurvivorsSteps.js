'use strict';

// BL-447: step handlers for "The mutation gate excludes structurally-
// unkillable CLI-entrypoint boilerplate but never real logic". Drives the
// REAL compiled classifyMutantLocation (entrypointBoilerplateIgnorer.ts) -
// the durable, in-process-testable contract; the LIVE Stryker Ignorer
// wiring (stryker-plugin.ts's appended plugin) is verified separately by
// QA's own e2e procedure against a real Stryker run, per this ticket's own
// "two things must hold, verified differently" split.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { classifyMutantLocation } = require(path.join(EXT_OUT, 'mutation', 'entrypointBoilerplateIgnorer'));

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough - each entry maps the feature file's own abstract
// <location> label to the structural facts classifyMutantLocation actually
// decides on.
const KNOWN_LOCATIONS = {
  'require-main-entrypoint-guard': { isRequireMainGuard: true, isEsModuleBoilerplate: false },
  'generated-esmodule-boilerplate': { isRequireMainGuard: false, isEsModuleBoilerplate: true },
  'exported-business-logic': { isRequireMainGuard: false, isEsModuleBoilerplate: false },
};

function registerSteps(registry) {
  registry.define(/^the mutation gate is classifying a candidate mutant for a tools\/CLI module$/, () => {
    // Background: purely contextual, nothing to arrange - classifyMutantLocation
    // takes its facts directly from the When step below.
  });

  registry.define(/^a candidate mutant located in "([^"]+)"$/, (ctx, location) => {
    if (!(location in KNOWN_LOCATIONS)) {
      throw new Error(`unrecognized fixture location "${location}" - not in KNOWN_LOCATIONS`);
    }
    ctx.facts = KNOWN_LOCATIONS[location];
  });

  registry.define(/^a candidate mutant in exported business logic that no test covers$/, (ctx) => {
    // "no test covers it" is deliberately NOT modeled as a fact at all -
    // classifyMutantLocation's own signature has no coverage input it
    // could key off of (see this scenario's own point: exclusion is
    // structural-location-only, never coverage-based).
    ctx.facts = { isRequireMainGuard: false, isEsModuleBoilerplate: false };
  });

  registry.define(/^the mutation gate decides whether to mutate it$/, (ctx) => {
    ctx.disposition = classifyMutantLocation(ctx.facts);
  });

  registry.define(/^the mutant is "([^"]+)"$/, (ctx, expected) => {
    if (ctx.disposition !== expected) {
      throw new Error(`expected disposition "${expected}", got "${ctx.disposition}"`);
    }
  });

  registry.define(/^the mutant is kept so it surfaces as a survivor, never excluded as boilerplate$/, (ctx) => {
    if (ctx.disposition !== 'kept') {
      throw new Error(`expected the untested real-logic mutant to be kept (never excluded), got "${ctx.disposition}"`);
    }
  });
}

module.exports = { registerSteps };
