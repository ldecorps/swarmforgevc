'use strict';

// BL-1267: the discharge path - a recorded Article 3.6 confirm-promote
// adjudication clears a hold, and nothing else does.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  adjudicationRecordPath,
  computeTicketFingerprint,
  readAdjudication,
  applyAdjudication,
  evaluateDeprecatorFreshness,
  deprecateCheck,
  findTicketYamlPath,
} = require('../out/tools/deprecate-check');
const { parseArgs, recordAdjudication } = require('../out/tools/record-adjudication');

// A ticket text that earns a hold on its own, so a discharge is never
// measured against a fixture that had nothing to discharge (the ticket's own
// non-vacuity requirement, qa_e2e step 2).
const HELD_TICKET = 'id: BL-77\ntitle: "fixture"\nstatus: superseded\n';

function fixtureRoot(ticketText = HELD_TICKET) {
  const root = mkTmpDir('bl1267-');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-77-fixture.yaml'), ticketText);
  return root;
}

function heldFacts(overrides = {}) {
  return {
    ticketId: 'BL-77',
    yamlText: HELD_TICKET,
    pausedPathExists: true,
    dependsOnIds: [],
    dependsOnAllDone: false,
    doneClosureExists: false,
    retiredSurfaceHits: [],
    specGapBounceCount: 0,
    ...overrides,
  };
}

test('the fixture ticket holds before anything is recorded (non-vacuity)', () => {
  const root = fixtureRoot();
  const before = deprecateCheck(root, 'BL-77');
  assert.equal(before.decision, 'hold');
  assert.match(before.reason, /superseded/);
});

test('a confirm-promote adjudication against the current content discharges the hold', () => {
  const root = fixtureRoot();
  const { path: recordPath } = recordAdjudication({
    root,
    ticketId: 'BL-77',
    outcome: 'confirm_promote',
    adjudicatedBy: 'specifier',
    adjudicatedAt: '2026-08-29T12:00:00.000Z',
  });
  const after = deprecateCheck(root, 'BL-77');
  assert.equal(after.decision, 'allow');
  // No discharge is anonymous: the allow names the record it came from.
  assert.ok(after.reason.includes(recordPath), after.reason);
  assert.match(after.reason, /confirm_promote by specifier at 2026-08-29T12:00:00.000Z/);
});

test('amending the ticket after adjudication re-arms the gate', () => {
  const root = fixtureRoot();
  recordAdjudication({ root, ticketId: 'BL-77', outcome: 'confirm_promote', adjudicatedBy: 'specifier' });
  assert.equal(deprecateCheck(root, 'BL-77').decision, 'allow');

  fs.appendFileSync(path.join(root, 'backlog', 'paused', 'BL-77-fixture.yaml'), '# one more character\n');
  const after = deprecateCheck(root, 'BL-77');
  assert.equal(after.decision, 'hold');
  assert.match(after.reason, /no longer matches the ticket content/);
  assert.match(after.reason, /re-adjudicate/);
});

test('only the confirm-promote outcome discharges', () => {
  for (const outcome of ['amend', 'retire', 'split']) {
    const root = fixtureRoot();
    recordAdjudication({ root, ticketId: 'BL-77', outcome, adjudicatedBy: 'specifier' });
    const decision = deprecateCheck(root, 'BL-77');
    assert.equal(decision.decision, 'hold', `${outcome} discharged a hold`);
    // A non-discharging outcome leaves the ORIGINAL reason intact.
    assert.match(decision.reason, /superseded/);
  }
});

test('an unreadable or malformed record fails closed and names itself', () => {
  for (const body of ['{ truncated', '[]', 'null', '{"ticket":"BL-77"}', '{"ticket":"BL-99","outcome":"confirm_promote","adjudicated_by":"s","adjudicated_at":"t","content_fingerprint":"f"}']) {
    const root = fixtureRoot();
    const target = adjudicationRecordPath(root, 'BL-77');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    const decision = deprecateCheck(root, 'BL-77');
    assert.equal(decision.decision, 'hold', `record ${body} produced an allow`);
    assert.match(decision.reason, /unusable adjudication record/);
    assert.match(decision.reason, /fail closed/);
  }
});

test('an unknown outcome is unusable, never silently ignored', () => {
  const root = fixtureRoot();
  const target = adjudicationRecordPath(root, 'BL-77');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      ticket: 'BL-77',
      outcome: 'promote_anyway',
      adjudicated_by: 's',
      adjudicated_at: 't',
      content_fingerprint: computeTicketFingerprint(HELD_TICKET),
    })
  );
  const decision = deprecateCheck(root, 'BL-77');
  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /unknown outcome/);
});

test('no record leaves the original stale-premise reason untouched', () => {
  const root = fixtureRoot();
  const decision = deprecateCheck(root, 'BL-77');
  assert.equal(decision.decision, 'hold');
  assert.equal(decision.reason, "ticket claims itself superseded in field 'status' without a backlog/done/ closure");
  assert.deepEqual(readAdjudication(root, 'BL-77'), { status: 'absent' });
});

test('a discharge never manufactures a hold that was not earned', () => {
  // applyAdjudication is only ever a discharge - handed an allow it returns it
  // unchanged, whatever the record says.
  const allow = { decision: 'allow' };
  assert.deepEqual(applyAdjudication(allow, heldFacts({ adjudication: { status: 'unusable', path: '/x', problem: 'y' } })), allow);
});

test('facts with no adjudication field behave exactly as an absent record', () => {
  const withoutField = evaluateDeprecatorFreshness(heldFacts());
  const withAbsent = evaluateDeprecatorFreshness(heldFacts({ adjudication: { status: 'absent' } }));
  assert.deepEqual(withoutField, withAbsent);
});

// ── the writer ──────────────────────────────────────────────────────────

test('parseArgs refuses an unknown outcome and a missing adjudicator', () => {
  assert.equal(parseArgs(['/r', 'BL-1', 'promote_anyway', 'specifier']), null);
  assert.equal(parseArgs(['/r', 'BL-1', 'confirm_promote']), null);
  assert.deepEqual(parseArgs(['/r', 'BL-1', 'confirm_promote', 'specifier']), {
    root: '/r',
    ticketId: 'BL-1',
    outcome: 'confirm_promote',
    adjudicatedBy: 'specifier',
  });
});

test('the writer refuses a ticket it cannot find rather than writing an unmatchable record', () => {
  const root = fixtureRoot();
  assert.throws(
    () => recordAdjudication({ root, ticketId: 'BL-999', outcome: 'confirm_promote', adjudicatedBy: 'specifier' }),
    /nothing to fingerprint/
  );
  assert.equal(fs.existsSync(adjudicationRecordPath(root, 'BL-999')), false);
});

test('the writer fingerprints the same text the gate reads', () => {
  const root = fixtureRoot();
  const { record } = recordAdjudication({
    root,
    ticketId: 'BL-77',
    outcome: 'confirm_promote',
    adjudicatedBy: 'specifier',
  });
  const ticketPath = findTicketYamlPath(root, 'BL-77');
  assert.equal(record.content_fingerprint, computeTicketFingerprint(fs.readFileSync(ticketPath, 'utf8')));
});

test('the writer follows the ticket into active/ rather than fingerprinting nothing', () => {
  const root = mkTmpDir('bl1267-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-77-fixture.yaml'), HELD_TICKET);
  const { record } = recordAdjudication({
    root,
    ticketId: 'BL-77',
    outcome: 'confirm_promote',
    adjudicatedBy: 'specifier',
  });
  assert.equal(record.content_fingerprint, computeTicketFingerprint(HELD_TICKET));
});

// ── BL-1338: the promotion's own routing stamp does not invalidate the
// adjudication that authorized that same promotion. Everything else about
// the ticket still does.

// Exactly what promote_and_route_next.sh appends after the gate passes.
function withRoutingStamp(ticketText, role = 'coder') {
  return `${ticketText}\nassigned_to: ${role}\n`;
}

test('the routing stamp a promotion writes does not change the fingerprint', () => {
  assert.equal(computeTicketFingerprint(withRoutingStamp(HELD_TICKET)), computeTicketFingerprint(HELD_TICKET));
});

test('re-routing an already-stamped ticket does not change the fingerprint', () => {
  assert.equal(
    computeTicketFingerprint(withRoutingStamp(HELD_TICKET, 'specifier')),
    computeTicketFingerprint(withRoutingStamp(HELD_TICKET, 'coder'))
  );
});

test('an edit to the ticket spec still changes the fingerprint', () => {
  for (const amended of [
    `${HELD_TICKET}acceptance: specs/features/other.feature\n`,
    `${HELD_TICKET}description: |\n  something new\n`,
    HELD_TICKET.replace('fixture', 'fixtures'),
  ]) {
    assert.notEqual(computeTicketFingerprint(amended), computeTicketFingerprint(HELD_TICKET));
  }
});

test('an indented assigned_to inside a block scalar is spec text, not a routing stamp', () => {
  const quoted = `${HELD_TICKET}description: |\n  assigned_to: coder\n`;
  assert.notEqual(computeTicketFingerprint(quoted), computeTicketFingerprint(HELD_TICKET));
});

test('a promoted ticket is still discharged by the adjudication that cleared it', () => {
  const root = fixtureRoot();
  const { path: recordPath } = recordAdjudication({
    root,
    ticketId: 'BL-77',
    outcome: 'confirm_promote',
    adjudicatedBy: 'specifier',
    adjudicatedAt: '2026-09-02T12:00:00.000Z',
  });
  // The promotion: the ticket moves to active/ and is stamped, exactly as
  // promote_and_route_next.sh does it.
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.rmSync(path.join(root, 'backlog', 'paused', 'BL-77-fixture.yaml'));
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-77-fixture.yaml'), withRoutingStamp(HELD_TICKET));

  const after = deprecateCheck(root, 'BL-77');
  assert.equal(after.decision, 'allow');
  assert.match(after.reason, new RegExp(recordPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a spec amendment after clearance still holds and names re-adjudication', () => {
  const root = fixtureRoot();
  recordAdjudication({
    root,
    ticketId: 'BL-77',
    outcome: 'confirm_promote',
    adjudicatedBy: 'specifier',
    adjudicatedAt: '2026-09-02T12:00:00.000Z',
  });
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', 'BL-77-fixture.yaml'),
    withRoutingStamp(`${HELD_TICKET}acceptance: specs/features/amended.feature\n`)
  );
  const after = deprecateCheck(root, 'BL-77');
  assert.equal(after.decision, 'hold');
  assert.match(after.reason, /re-adjudicate/);
});
