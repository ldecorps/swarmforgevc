'use strict';

// BL-1338's two declared invariants.
//
// Invariant 1: "A change to the ticket's SUBSTANCE after clearance still
// re-arms the gate: no narrowing of the fingerprint may let an amended spec
// ride a stale clearance." The interesting state is a SPEC EDIT that the
// narrowed fingerprint might wrongly ignore, which a naive generator of two
// independent ticket texts reaches only by accident. So every drawn pair is
// constructed: a base ticket and an amendment applied to it, arbitrarily
// combined with the routing stamp on either side, so the amendment is the
// only substantive difference by construction.
//
// Invariant 2: "The routing stamp written by a promotion never invalidates
// the adjudication that authorized that same promotion." The collision side:
// each pair is built by applying the promotion's own transformation to the
// same ticket, so every generated pair is a stamp-only difference - never
// drawn independently and hoped to collide.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeTicketFingerprint } = require('../out/tools/deprecate-check');

/** Exactly what promote_and_route_next.sh writes after the gate has passed. */
const stamp = (text, role) =>
  /^assigned_to:/m.test(text)
    ? text.replace(/^assigned_to:.*$/m, `assigned_to: ${role}`)
    : `${text}\nassigned_to: ${role}\n`;

const roles = fc.constantFrom('coder', 'specifier', 'cleaner', 'architect', 'documenter', 'qa');

const baseTicket = fc
  .record({
    id: fc.integer({ min: 1, max: 9999 }),
    title: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes('\n') && !s.includes('"')),
    status: fc.constantFrom('todo', 'superseded', 'in_progress'),
  })
  .map(({ id, title, status }) => `id: BL-${id}\ntitle: "${title}"\nstatus: ${status}\n`);

// Every amendment touches SPEC, not routing - each is a substantive edit.
const amendment = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 })
    .filter((s) => !s.includes('\n'))
    .map((s) => (t) => `${t}acceptance: specs/features/${encodeURIComponent(s)}.feature\n`),
  fc.string({ minLength: 1, maxLength: 30 })
    .filter((s) => !s.includes('\n'))
    .map((s) => (t) => `${t}description: |\n  ${s}\n`),
  fc.constantFrom('low', 'medium', 'high', 'critical').map((sev) => (t) => `${t}severity: ${sev}\n`),
  fc.constant((t) => t.replace(/^status: .*$/m, 'status: retired')),
  // Not substance in the everyday sense, but BL-1267's fingerprint is
  // byte-exact and this ticket narrows ONLY the routing stamp: a whitespace
  // edit must still re-arm, or the narrowing has reached past the stamp.
  fc.constant((t) => `${t}\n`)
);

test('invariant 2: the routing stamp a promotion writes never changes the fingerprint', () => {
  fc.assert(
    fc.property(baseTicket, roles, roles, (ticket, first, second) => {
      const promoted = stamp(ticket, first);
      const rerouted = stamp(promoted, second);
      assert.equal(computeTicketFingerprint(promoted), computeTicketFingerprint(ticket));
      assert.equal(computeTicketFingerprint(rerouted), computeTicketFingerprint(ticket));
    }),
    { numRuns: 300 }
  );
});

test('invariant 1: a substantive amendment still changes the fingerprint, stamped or not', () => {
  fc.assert(
    fc.property(baseTicket, amendment, roles, fc.boolean(), fc.boolean(), (ticket, amend, role, stampBefore, stampAfter) => {
      const before = stampBefore ? stamp(ticket, role) : ticket;
      const after = stampAfter ? stamp(amend(ticket), role) : amend(ticket);
      fc.pre(amend(ticket) !== ticket);
      assert.notEqual(computeTicketFingerprint(after), computeTicketFingerprint(before));
    }),
    { numRuns: 300 }
  );
});
