'use strict';

// BL-1906 declared invariants (coder first authorship - BL-654):
//   1. "The daemon's dropped-parcel sweep and dispatch_trail_cli.bb give the
//       same verdict for the same ticket, and both count a lander-queue
//       entry naming that ticket with status queued or running as a parcel
//       in flight."
//   2. "A missing queue directory, an unreadable entry, an entry for another
//       ticket, or an entry in any other status leaves the verdict exactly as
//       the role mailboxes alone decide it."
//   3. "The consumers only read the lander queue; none writes, moves or
//       deletes an entry."
//
// Each draw builds BL-1906's own handler fixture (a stale trail for the
// ticket, every mailbox empty), reused rather than copied. It then draws:
// - whether a live parcel for the ticket sits in the coder's new/ (the
//   mailbox verdict);
// - a lander queue of 0-4 entries, or no queue directory at all.
// It runs the daemon's REAL dropped-parcel-sweep! (handoffd.bb loaded, send
// stubbed) and the REAL dispatch_trail_cli.bb.
//   Invariant 1: the sweep nudges exactly when the CLI answers DROPPED.
//   Invariants 1 and 2: the ticket is in flight exactly when the mailbox has
//   it, or some readable entry names it with :queued or :running.
//   Invariant 3: the queue's files are byte-identical before and after.
//
// Collision candidates are constructed from the ticket's own id:
// - an entry for BL-19060, which has the ticket's id as a prefix;
// - an entry whose task is the ticket with a slug (BL-1906-some-slug, the
//   same ticket by the lander's own rule);
// - a torn entry whose file name and task both name the ticket;
// - the same ticket twice, once terminal and once in flight (a re-queue
//   after a refusal).
// Reach floor: in flight by queue, dropped, and kept by mailbox each occur.
//
// Non-vacuity: with lander-lib/tickets-in-flight answering #{} (today's
// code), the property fails on the first queued or running entry for the
// ticket ("in flight: true, but the sweep nudged"). Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { fixture } = require('../../specs/pipeline/steps/bl1906LanderQueuedTicketInFlightSteps');

const { TICKET, makeFixture, writeEntry, writeTornEntry, queueSnapshot, runSweep, nudgesFor, runCli } = fixture;

const STATUSES = ['queued', 'running', 'landed', 'refused', 'exploded'];
const TASKS = {
  ticket: TICKET,
  slugged: `${TICKET}-some-slug`,
  prefixSibling: `${TICKET}0`,
  other: 'BL-9999',
};
const SHAS = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd'];

const entry = fc.record({
  task: fc.constantFrom(...Object.keys(TASKS)),
  status: fc.constantFrom(...STATUSES),
  torn: fc.boolean(),
});

const draw = fc.record({
  liveMail: fc.boolean(),
  queue: fc.option(fc.array(entry, { maxLength: 4 }), { nil: null }),
});

function namesTicket(task) {
  return task === 'ticket' || task === 'slugged';
}

function runDraw({ liveMail, queue }) {
  const fx = makeFixture();
  if (liveMail) {
    const dir = path.join(fx.coder, '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '00_live.handoff'),
      `from: QA\nto: coder\ntype: git_handoff\ntask: ${TICKET}-demo\ncommit: 1111111111\nenqueued_at: 2020-01-01T00:00:00.000000Z\n\nbody\n`
    );
  }
  (queue || []).forEach((e, i) => {
    if (e.torn) writeTornEntry(fx, `${TASKS[e.task]}-${i}`);
    else writeEntry(fx, TASKS[e.task], e.status, SHAS[i]);
  });
  const inFlightByQueue = (queue || []).some((e) => !e.torn && namesTicket(e.task) && (e.status === 'queued' || e.status === 'running'));
  const before = queueSnapshot(fx);
  const nudged = nudgesFor(runSweep(fx), TICKET).length > 0;
  const answer = runCli(fx, TICKET);
  const after = queueSnapshot(fx);
  return { fx, inFlightByQueue, nudged, answer, before, after };
}

const REACH_EXAMPLES = [
  [{ liveMail: false, queue: [{ task: 'slugged', status: 'running', torn: false }, { task: 'prefixSibling', status: 'queued', torn: false }] }],
  [{ liveMail: false, queue: [{ task: 'ticket', status: 'refused', torn: false }, { task: 'ticket', status: 'queued', torn: false }] }],
  [{ liveMail: false, queue: [{ task: 'prefixSibling', status: 'queued', torn: false }, { task: 'ticket', status: 'queued', torn: true }] }],
  [{ liveMail: false, queue: null }],
  [{ liveMail: true, queue: [{ task: 'ticket', status: 'landed', torn: false }] }],
];

test(
  'BL-1906/BL-654 invariants: the sweep and the CLI agree, a land in flight is a parcel in flight, nothing else moves the verdict, the queue is only read',
  () => {
    const reach = { inFlightByQueue: 0, dropped: 0, keptByMail: 0 };
    fc.assert(
      fc.property(draw, (d) => {
        const { fx, inFlightByQueue, nudged, answer, before, after } = runDraw(d);
        const ctx = `${JSON.stringify(d)} answer=${answer}\n${fx.out}`;
        const dropped = answer.startsWith('DROPPED');
        assert.ok(dropped || answer.startsWith('DISPATCHED'), ctx);
        assert.equal(nudged, dropped, `the sweep (nudged: ${nudged}) and the CLI disagree: ${ctx}`);
        const inFlight = d.liveMail || inFlightByQueue;
        assert.equal(dropped, !inFlight, `in flight: ${inFlight}, but the sweep ${nudged ? 'nudged' : 'kept quiet'}: ${ctx}`);
        assert.deepEqual(after, before, `the queue changed: ${ctx}`);
        if (inFlightByQueue && !d.liveMail) reach.inFlightByQueue += 1;
        if (dropped) reach.dropped += 1;
        if (d.liveMail) reach.keptByMail += 1;
      }),
      { numRuns: 6, examples: REACH_EXAMPLES }
    );
    for (const k of Object.keys(reach)) assert.ok(reach[k] >= 1, `${k} reached: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
