const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  normalizeCommand,
  failureSignature,
  openBlockersForTicket,
  isRedundantSiblingDeferralWrite,
  siblingDeferralNaturalKey,
  decideDisposition,
} = require('../out/quality/siblingDeferral');

// BL-532: siblingDeferral.ts is the pure decision surface behind "a parcel
// with no failing check of its own is DEFERRED pending the blocker, never
// re-queued for rework". siblingDeferral.test.js pins it at hand-picked
// examples; the invariants below hold across every record sequence, not
// just those examples - the round-trip/idempotence/ordering shapes
// architect.prompt's Property Testing section names. The most valuable of
// them is the LAST one: the ticket's own "central guarantee" that an open
// deferral suppresses the re-queue for the blocker's signature ONLY.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run.

const KNOWN_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'];
const classArb = fc.constantFrom(...KNOWN_CLASSES);

// Commands built from non-whitespace words joined by arbitrary whitespace
// runs, so the generator explores exactly the variation normalizeCommand
// claims to erase (leading/trailing padding and internal runs).
const wordArb = fc.stringMatching(/^[a-z0-9./-]{1,8}$/);
const spaceArb = fc.stringMatching(/^[ \t\n]{1,4}$/);

const commandArb = fc
  .tuple(fc.array(wordArb, { minLength: 1, maxLength: 5 }), fc.array(spaceArb, { minLength: 5, maxLength: 5 }))
  .map(([words, spaces]) => spaces[0] + words.join(spaces[1]) + spaces[2]);

const ticketArb = fc.integer({ min: 1, max: 6 }).map((n) => `BL-90${n}`);
const commitArb = fc.stringMatching(/^[0-9a-f]{10}$/);

// A defer/clear event on some (ticket, blockedBy) pair. `at` is generated as
// an ordered index rather than a real clock so the sequence's chronology is
// the property's input, not an accident of wall time (engineering.prompt:
// pin fixture clocks).
function recordAt(index, event) {
  const at = `2026-07-17T10:${String(index).padStart(2, '0')}:00.000Z`;
  return event.action === 'defer'
    ? { ticket: event.ticket, blockedBy: event.blockedBy, action: 'defer', failureClass: event.failureClass, check: event.check, commit: event.commit, at }
    : { ticket: event.ticket, blockedBy: event.blockedBy, action: 'clear', commit: event.commit, at };
}

const eventArb = fc.record({
  ticket: ticketArb,
  blockedBy: ticketArb,
  action: fc.constantFrom('defer', 'clear'),
  failureClass: classArb,
  check: commandArb,
  commit: commitArb,
});

const recordsArb = fc.array(eventArb, { maxLength: 24 }).map((events) => events.map((e, i) => recordAt(i, e)));

test('property: normalizeCommand is idempotent and erases all whitespace variation', () => {
  fc.assert(
    fc.property(commandArb, (command) => {
      const once = normalizeCommand(command);
      assert.equal(normalizeCommand(once), once, `command=${JSON.stringify(command)}`);
      assert.equal(once, once.trim(), 'normalized command still has edge whitespace');
      assert.ok(!/\s\s/.test(once), `normalized command kept a whitespace run: ${JSON.stringify(once)}`);
    })
  );
});

test('property: two commands sharing a normal form share a signature under the same class, and differ under different classes', () => {
  fc.assert(
    fc.property(commandArb, commandArb, classArb, classArb, (a, b, classA, classB) => {
      const sameNormalForm = normalizeCommand(a) === normalizeCommand(b);
      assert.equal(
        failureSignature(classA, a) === failureSignature(classA, b),
        sameNormalForm,
        `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`
      );
      // Class is drawn from the closed KNOWN_FAILURE_CLASSES set, none of
      // which contain the "::" separator, so class and command can never
      // smear into one another.
      if (classA !== classB) {
        assert.notEqual(failureSignature(classA, a), failureSignature(classB, a), 'distinct classes collided');
      }
    })
  );
});

test('property: a pair is open exactly when its last event was a defer, and open blockers come back sorted by blocker id', () => {
  fc.assert(
    fc.property(recordsArb, ticketArb, (records, ticket) => {
      const open = openBlockersForTicket(records, ticket);

      const ids = open.map((b) => b.blockedBy);
      assert.deepEqual(ids, [...ids].sort(), `open blockers not sorted: ${JSON.stringify(ids)}`);
      assert.equal(new Set(ids).size, ids.length, `a pair appeared twice: ${JSON.stringify(ids)}`);

      // Independently recompute openness: last-event-wins per pair. This is
      // the defer -> clear -> defer state machine, checked over every
      // interleaving the generator produces rather than one hand-written
      // sequence.
      const lastAction = new Map();
      for (const record of records) {
        lastAction.set(`${record.ticket}|${record.blockedBy}`, record.action);
      }
      const expected = [...lastAction.entries()]
        .filter(([key, action]) => action === 'defer' && key.startsWith(`${ticket}|`))
        .map(([key]) => key.slice(ticket.length + 1))
        .sort();
      assert.deepEqual(ids, expected, `records=${JSON.stringify(records)} ticket=${ticket}`);
    })
  );
});

test('property: a write is redundant exactly when it repeats the natural key of its pair\'s current state', () => {
  fc.assert(
    fc.property(recordsArb, eventArb, (records, event) => {
      const candidate = recordAt(30, event);
      const redundant = isRedundantSiblingDeferralWrite(records, candidate);

      const forPair = records.filter((r) => r.ticket === candidate.ticket && r.blockedBy === candidate.blockedBy);
      const latest = forPair.length === 0 ? null : forPair[forPair.length - 1];
      const expected = !!latest && siblingDeferralNaturalKey(latest) === siblingDeferralNaturalKey(candidate);
      assert.equal(redundant, expected, `candidate=${JSON.stringify(candidate)}`);

      // Re-writing a pair's current state verbatim is a no-op - the
      // idempotency guarantee the store leans on (a live write racing a
      // re-run must never double-count). Note this is asserted for an
      // IDENTICAL re-write only: the natural key deliberately omits `check`
      // and `commit`, so a same-day/same-class defer carrying a DIFFERENT
      // failing command also reads as redundant and is dropped by the store
      // (visibly - appendSiblingDeferralRecordIfNew returns false). That is
      // the specced key (ticket, blocker, date, class), and it fails in the
      // safe direction: the stale command either still fails, so the
      // deferral rightly stands, or passes, so QA clears and verifies
      // normally. It can never suppress a bounce that should have
      // happened, because suppression is signature-matched per the last
      // property in this file.
      if (latest) {
        assert.equal(isRedundantSiblingDeferralWrite(records, latest), true, 'an identical re-write was not detected as redundant');
        assert.deepEqual(
          openBlockersForTicket([...records, { ...latest }], candidate.ticket),
          openBlockersForTicket(records, candidate.ticket),
          'an identical re-write changed the open-blocker set'
        );
      }
    })
  );
});

test('property: an open deferral suppresses the blocker\'s own failure signature ONLY - any other signature bounces', () => {
  fc.assert(
    fc.property(recordsArb, ticketArb, fc.option(fc.record({ failureClass: classArb, check: commandArb }), { nil: null }), (records, ticket, observed) => {
      const open = openBlockersForTicket(records, ticket);
      const disposition = decideDisposition(open, observed);

      if (open.length === 0) {
        assert.equal(disposition.kind, 'verify', 'no open blockers must always verify');
        return;
      }
      if (!observed) {
        assert.equal(disposition.kind, 'defer', 'open blockers and no failure of its own must defer');
        assert.deepEqual(disposition.blockers, open, 'a status pass must name every open blocker');
        return;
      }

      const signature = failureSignature(observed.failureClass, observed.check);
      const matching = open.filter((b) => failureSignature(b.failureClass, b.check) === signature);

      if (matching.length === 0) {
        // The ticket's central guarantee, negative direction: a failure the
        // blocker never had is this ticket's OWN defect and must reach the
        // normal bounce ritual.
        assert.equal(disposition.kind, 'bounce', `unmatched signature ${signature} must bounce`);
      } else {
        assert.equal(disposition.kind, 'defer', `matched signature ${signature} must defer`);
        assert.deepEqual(disposition.blockers, matching, 'defer must name only the blockers whose signature matched');
      }
    })
  );
});
