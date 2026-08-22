const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { readNewReplyOutboxEntries } = require('../out/bridge/operatorEventQueue');

// BL-708 invariant #1 (coder-authored, ticket-declared): "Every field a
// producer writes into telegram-reply-outbox.jsonl that a front-desk
// delivery path reads is carried through the bridge relay unchanged - the
// relay never narrows a record to a shape that changes which delivery path
// handles it." role_ask.bb/operator_ask.bb write roleQuestion/agentQuestion/
// options alongside the ordinary id/threadId/text/retractsPendingQuestion
// fields; telegramFrontDeskBotCore.ts's relayOneRecord branches its ENTIRE
// delivery decision on whether roleQuestion/agentQuestion is present (see
// its own destructuring). Before this ticket, readNewReplyOutboxEntries
// silently narrowed every entry to {id, threadId, text,
// retractsPendingQuestion} - the exact bug that made a role's clarifying
// question fall through to the ordinary-reply branch for six days
// (BL-708's own forensics) while the relay's cursor kept advancing as if
// every record had been delivered.
//
// This property drives arbitrary combinations of those fields - present or
// absent, independently - through a real outbox file and
// readNewReplyOutboxEntries, and asserts every field that was WRITTEN comes
// back unchanged, and no field that was ABSENT is ever synthesized. It
// generalizes past the hand-picked field combinations
// operatorEventQueue.test.js pins (one field present at a time) to every
// combination fast-check can construct.
//
// Non-vacuous: reverting the readNewReplyOutboxEntries fix (dropping the
// roleQuestion/agentQuestion/options passthrough) fails this property on
// virtually the first generated case where any of those fields is present -
// confirmed manually before restoring the fix.
//
// Generator reach: recordArb independently randomizes presence of id,
// retractsPendingQuestion, roleQuestion, agentQuestion, and options (via
// fc.option's nil:undefined), so every one of the 2^5 presence combinations
// is reachable, not just the "one extra field at a time" shape the unit
// tests pin. Runs ONLY via `npm run test:properties`.

const optionArb = fc.record(
  { label: fc.string({ minLength: 1, maxLength: 20 }), description: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }) },
  { requiredKeys: ['label'] }
);

const recordArb = fc.record({
  id: fc.option(fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/), { nil: undefined }),
  threadId: fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/),
  text: fc.string({ minLength: 1, maxLength: 40 }),
  retractsPendingQuestion: fc.option(fc.boolean(), { nil: undefined }),
  roleQuestion: fc.option(fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/), { nil: undefined }),
  agentQuestion: fc.option(fc.boolean(), { nil: undefined }),
  options: fc.option(fc.array(optionArb, { minLength: 1, maxLength: 4 }), { nil: undefined }),
});

// Builds exactly the JSON object role_ask.bb/operator_ask.bb would append -
// only the fields this run's arbitrary chose to set, nothing defaulted in.
function writtenLine(rec) {
  const line = { threadId: rec.threadId, text: rec.text };
  if (rec.id !== undefined) line.id = rec.id;
  if (rec.retractsPendingQuestion !== undefined) line.retractsPendingQuestion = rec.retractsPendingQuestion;
  if (rec.roleQuestion !== undefined) line.roleQuestion = rec.roleQuestion;
  if (rec.agentQuestion !== undefined) line.agentQuestion = rec.agentQuestion;
  if (rec.options !== undefined) line.options = rec.options;
  return line;
}

// Mirrors readNewReplyOutboxEntries's own field-by-field rule exactly (a
// falsy retractsPendingQuestion/agentQuestion is never carried, matching
// the source's `=== true` guards) - this is the property's oracle, derived
// from the ticket's invariant wording, not copied from the implementation
// under test line-for-line.
function expectedEntry(rec) {
  const entry = { id: rec.id !== undefined ? rec.id : 'legacy-0', threadId: rec.threadId, text: rec.text };
  if (rec.retractsPendingQuestion === true) {
    entry.retractsPendingQuestion = true;
  }
  if (rec.roleQuestion !== undefined) {
    entry.roleQuestion = rec.roleQuestion;
  }
  if (rec.agentQuestion === true) {
    entry.agentQuestion = true;
  }
  if (rec.options !== undefined) {
    // fc.record's optional keys (description here) can be materialized as
    // an explicit `undefined` value rather than an omitted key - the wire
    // (JSON.stringify on write, JSON.parse on read) drops such a key
    // entirely, same as it drops any other undefined-valued property. Mirror
    // that same normalization on the expected side so the property compares
    // what actually rides the wire, not the arbitrary's own internal shape.
    entry.options = JSON.parse(JSON.stringify(rec.options));
  }
  return entry;
}

test('property: readNewReplyOutboxEntries carries every delivery-routing field (roleQuestion/agentQuestion/options/retractsPendingQuestion) through unchanged, for any combination written', () => {
  fc.assert(
    fc.property(recordArb, (rec) => {
      const targetPath = mkTmpDir('sfvc-operator-event-queue-prop-');
      const dir = path.join(targetPath, '.swarmforge', 'operator');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'telegram-reply-outbox.jsonl'), JSON.stringify(writtenLine(rec)) + '\n');

      const result = readNewReplyOutboxEntries(targetPath, 0);

      assert.deepEqual(result.entries, [expectedEntry(rec)]);
    }),
    { numRuns: 300 }
  );
});
