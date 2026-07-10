'use strict';

// BL-253: step handlers for "the phone docs drill-down distinguishes
// implemented tickets from not-yet-implemented ones". This feature's
// Background step text ("the phone docs drill-down tree over milestones,
// tickets, and their Gherkin scenarios") is IDENTICAL to BL-254's own
// Background - docsSearchFilterSteps.js registers first (see
// specs/pipeline/steps/index.js) and owns that regex under the
// first-match-wins step registry, so this file never redefines it and
// instead drives ctx.tree, the SAME fixture tree that handler already
// builds (BL-500 done/M1, BL-501 active/M1, BL-502 paused/M2, BL-503
// done/M2, BL-504 active/M2 - see docsSearchFilterSteps.js's
// buildFixtureTree). Per the ticket's own WEBVIEW BOUNDARY note, this
// drives the derived data (docsTree.ts's implemented flag,
// recertification.ts's status-blind eligibility), not the rendered DOM -
// the DOM/greying behavior is covered separately by
// extension/test/pwaDocsExplorer.test.js's jsdom harness.
const path = require('node:path');
const fs = require('node:fs');

const { buildDocsTree } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'docs', 'docsTree'));
const {
  recertifiableScenariosFrom,
  handleInboundRecertEmail,
  buildRecertEmailSubject,
  buildRecertEmailBody,
  parseRecertEmail,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'docs', 'recertification'));

const LOCALES_PATH = path.join(__dirname, '..', '..', '..', 'pwa', 'locales.js');

const TICKET_BY_FOLDER = { done: 'BL-500', active: 'BL-501', paused: 'BL-502' };

function registerSteps(registry) {
  // ── status-from-folder-01 ────────────────────────────────────────────
  registry.define(/^a ticket in the "([^"]+)" backlog folder$/, (ctx, folder) => {
    ctx.pickedId = TICKET_BY_FOLDER[folder];
    if (!ctx.pickedId) {
      throw new Error(`unrecognized backlog folder: "${folder}"`);
    }
  });

  registry.define(/^the docs drill-down renders it$/, (ctx) => {
    ctx.pickedTicket = ctx.tree.tickets.find((t) => t.id === ctx.pickedId);
    if (!ctx.pickedTicket) {
      throw new Error(`expected ticket "${ctx.pickedId}" in the fixture tree`);
    }
  });

  // Hardener fix (BL-113 Gherkin mutation): validate against the exact
  // known treatment strings rather than collapsing everything that isn't
  // literally "implemented and not greyed" into expectedImplemented=false
  // - a mutated "greyed as not-yet-implemented" example (e.g. a case
  // typo) still equally fails that equality check, so the assertion below
  // passed regardless of what the "not-yet" treatment text actually said.
  // Same lookup-and-reject-unknown pattern as recruiterAcquireSteps.js's
  // WALL_TEXT_TO_AUTOMATION (BL-233) and bakeoffRosterSteps.js's
  // KNOWN_COST_TIERS (BL-250).
  const IMPLEMENTED_BY_TREATMENT = {
    'implemented and not greyed': true,
    'greyed as not-yet-implemented': false,
  };

  registry.define(/^it is shown as "([^"]+)"$/, (ctx, expectedTreatment) => {
    if (!Object.prototype.hasOwnProperty.call(IMPLEMENTED_BY_TREATMENT, expectedTreatment)) {
      throw new Error(`unrecognized treatment "${expectedTreatment}" - expected one of: ${Object.keys(IMPLEMENTED_BY_TREATMENT).join(', ')}`);
    }
    const expectedImplemented = IMPLEMENTED_BY_TREATMENT[expectedTreatment];
    if (ctx.pickedTicket.implemented !== expectedImplemented) {
      throw new Error(
        `expected ticket "${ctx.pickedId}" implemented=${expectedImplemented} (treatment "${expectedTreatment}"), got implemented=${ctx.pickedTicket.implemented}`
      );
    }
  });

  // ── not-yet-expandable-02 ─────────────────────────────────────────────
  registry.define(/^a not-yet-implemented ticket in the tree$/, (ctx) => {
    ctx.pickedTicket = ctx.tree.tickets.find((t) => !t.implemented);
    if (!ctx.pickedTicket) {
      throw new Error('expected at least one not-yet-implemented ticket in the fixture tree');
    }
  });

  registry.define(/^the operator taps it$/, () => {
    // Data-level equivalent of a tap (WEBVIEW BOUNDARY): nothing in the
    // pure tree model gates expansion by implemented status - the next
    // Then step reads the ticket's own scenarios directly, proving the
    // data a real tap would render is present regardless.
  });

  registry.define(/^it expands to show its planned scenarios$/, (ctx) => {
    if (!ctx.pickedTicket.scenarios || ctx.pickedTicket.scenarios.length === 0) {
      throw new Error(`expected not-yet-implemented ticket "${ctx.pickedTicket.id}" to still carry its planned scenarios`);
    }
  });

  // ── refine-regardless-of-status-03 ───────────────────────────────────
  // Hardener fix (BL-113 Gherkin mutation): the same shared-cell survivor
  // shape as IMPLEMENTED_BY_TREATMENT above - `status === 'implemented'`
  // collapsed every OTHER string (the real "not-yet" value, any typo of
  // it, or garbage) to implemented=false alike, and nothing downstream
  // ever reads implemented (the ticket's own point - recert must not
  // gate on it), so the example value was never actually verified to be
  // one of the two real statuses. Validate against the known set first.
  const KNOWN_REFINE_STATUSES = ['implemented', 'not-yet'];

  registry.define(/^a "([^"]+)" ticket with a live Gherkin scenario$/, (ctx, status) => {
    if (!KNOWN_REFINE_STATUSES.includes(status)) {
      throw new Error(`unrecognized status "${status}" - expected one of: ${KNOWN_REFINE_STATUSES.join(', ')}`);
    }
    ctx.recertTicket = {
      id: 'BL-999',
      // implemented/not-yet is asserted to make NO difference below -
      // recertifiableScenariosFrom never reads it, only scenario.id.
      implemented: status === 'implemented',
      scenarios: [{ id: 'BL-999/s1', name: 'a planned scenario', text: 'Scenario: a planned scenario\n  Given x' }],
    };
  });

  registry.define(/^the operator refines that scenario in the recertification flow$/, (ctx) => {
    const pool = recertifiableScenariosFrom([ctx.recertTicket]);
    const scenario = pool.find((s) => s.id === 'BL-999/s1');
    if (!scenario) {
      throw new Error('expected the scenario to be recertifiable regardless of implementation status');
    }
    const subject = buildRecertEmailSubject({ scenarioId: scenario.id, outcome: 'update', newText: 'a refined scenario text' });
    const body = buildRecertEmailBody({ scenarioId: scenario.id, outcome: 'update', newText: 'a refined scenario text' });
    const parsed = parseRecertEmail(subject, body);
    ctx.recertResult = handleInboundRecertEmail({ schemaVersion: 1, scenarios: {} }, parsed, '2026-07-10T00:00:00.000Z');
  });

  registry.define(/^the proposed edit is accepted for specifier review$/, (ctx) => {
    if (ctx.recertResult.kind !== 'proposed' || ctx.recertResult.proposal.outcome !== 'update') {
      throw new Error(`expected an accepted update proposal, got: ${JSON.stringify(ctx.recertResult)}`);
    }
  });

  // ── greying-is-visual-only-04 ─────────────────────────────────────────
  registry.define(/^the operator uses its recertification controls$/, (ctx) => {
    const implementedTicket = { id: 'BL-998', implemented: true, scenarios: [{ id: 'BL-998/s1', name: 'x', text: 'Scenario: x\n  Given y' }] };
    const notYetTicket = { id: 'BL-997', implemented: false, scenarios: [{ id: 'BL-997/s1', name: 'x', text: 'Scenario: x\n  Given y' }] };
    ctx.implementedPool = recertifiableScenariosFrom([implementedTicket]);
    ctx.notYetPool = recertifiableScenariosFrom([notYetTicket]);
  });

  registry.define(/^they behave exactly as they do for an implemented ticket$/, (ctx) => {
    if (ctx.implementedPool.length !== 1 || ctx.notYetPool.length !== 1) {
      throw new Error(
        `expected an implemented and a not-yet ticket to be equally recertifiable, got ${ctx.implementedPool.length} vs ${ctx.notYetPool.length}`
      );
    }
  });

  // ── labels-localized-05 ───────────────────────────────────────────────
  registry.define(/^the phone app language is set to a supported non-default locale$/, (ctx) => {
    ctx.localesSource = fs.readFileSync(LOCALES_PATH, 'utf8');
  });

  registry.define(/^the docs drill-down renders implemented and not-yet tickets$/, () => {
    // Nothing further to do - the previous Given already loaded the real
    // locale catalog the Then step below audits.
  });

  registry.define(/^the implemented and not-yet labels appear in that locale$/, (ctx) => {
    const frMatch = ctx.localesSource.match(/fr:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*\};/);
    if (!frMatch) {
      throw new Error('could not locate the fr locale block in pwa/locales.js');
    }
    const frBlock = frMatch[1];
    const implementedMatch = frBlock.match(/implementedLabel:\s*'([^']+)'/);
    const notYetMatch = frBlock.match(/notYetImplementedLabel:\s*'([^']+)'/);
    if (!implementedMatch || !notYetMatch) {
      throw new Error('expected implementedLabel and notYetImplementedLabel in the fr locale catalog');
    }
    if (implementedMatch[1] === 'implemented' || notYetMatch[1] === 'not yet implemented') {
      throw new Error('expected genuinely translated French values, not the English text reused verbatim');
    }
  });
}

module.exports = { registerSteps };
