const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { composeRoleAnswerNoteMessage, enqueueRoleAnswerNote, roleAnswerFilePointerPath } = require('../out/tools/telegram-front-desk-bot');

// BL-607 (architect, property support): composeRoleAnswerNoteMessage builds
// the single-line `message:` header of the note that carries a human's
// clarifying-question answer back to a DORMANT role (dormant-pane leg 2).
// That header is embedded verbatim into a swarm_handoff.bb draft, whose
// grammar is strictly one `field: value` per line and caps `message:` at 80
// chars - so a raw newline or other control char in the answer turns the
// 2nd line into a bogus header and swarm_handoff.bb REJECTS the whole draft,
// silently dropping exactly the answer the role is waiting for. That is the
// defect this ticket bounced on twice (architect bounce 2): the hand-picked
// examples in telegramFrontDeskBotCli.test.js pin the failure at one 2-line
// string, but the invariant is universal - for ANY answer text a human can
// type, the produced header must be a valid single-line swarm_handoff.bb
// `message:` value: NO control character and <= 80 chars, routing anything
// that would not fit through the pointer-file fallback instead.
//
// This property generalizes that whole safety contract across the entire
// input space (control chars at arbitrary positions, multiple newlines,
// unicode, arbitrary length) rather than the four points the example suite
// pins. Runs ONLY via `npm run test:properties`; excluded from the normal
// unit/coverage/mutation run per engineering.prompt's separation rule.

// Role is a controlled value drawn from the eight real swarm roles (the
// topic map's own key set - see roleTopicMapStore); the UNTRUSTED input is
// the answer text, which is what the property stresses. Kept consistent with
// telegramFrontDeskBotCore.property.test.js's KNOWN_ROLES.
const KNOWN_ROLES = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const roleArb = fc.constantFrom(...KNOWN_ROLES);

// An answer-text arbitrary that deliberately peppers control characters
// (newlines, CR, tab, NUL, DEL, other C0) among ordinary printable and
// unicode text, so the sanitization is exercised at arbitrary positions and
// lengths - not just the single mid-string newline the example pins.
const printableCharArb = fc.constantFrom(...'abcXYZ0123 ./-_:é中');
const controlCharArb = fc.constantFrom('\n', '\r', '\t', '\x00', '\x0b', '\x1f', '\x7f');
const answerCharArb = fc.oneof({ weight: 3, arbitrary: printableCharArb }, { weight: 1, arbitrary: controlCharArb });
const answerTextArb = fc.oneof(
  fc.array(answerCharArb, { maxLength: 200 }).map((cs) => cs.join('')),
  // fast-check v4: `unit: 'binary'` draws arbitrary UTF-16 code units,
  // including every C0/C1 control char and DEL - broad coverage of any
  // byte a human's typed answer could carry.
  fc.string({ unit: 'binary', maxLength: 200 }),
);

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

test('property: composeRoleAnswerNoteMessage always yields a valid single-line swarm_handoff.bb message header (no control char, <= 80 chars) for any answer text', () => {
  fc.assert(
    fc.property(roleArb, answerTextArb, (role, text) => {
      const message = composeRoleAnswerNoteMessage(role, text);
      assert.doesNotMatch(message, CONTROL_CHAR, `the queued note message must be a single control-char-free line, got: ${JSON.stringify(message)}`);
      assert.ok(message.length <= 80, `the queued note message must fit swarm_handoff.bb's 80-char cap, got ${message.length}: ${JSON.stringify(message)}`);
    }),
    { numRuns: 500 }
  );
});

// ── BL-1203 (coder.prompt's Invariants section - first authorship rests
// with the coder): PROPERTY tests over enqueueRoleAnswerNote's real,
// impure behavior (real git+roles.tsv fixture, real swarm_handoff.bb
// subprocess per call) - both declared invariants:
//
//   invariant 1 - "A role receives at most one note per inbound answer,
//      however many times that answer is re-processed": across a
//      generated SEQUENCE of (updateId, text) calls against ONE role, the
//      number of notes actually queued equals the number of DISTINCT
//      updateIds in that sequence - never more (a duplicate updateId
//      queues nothing new), never fewer (every distinct updateId still
//      gets through, including when its text repeats an earlier one -
//      identity, not content, is the key).
//
//   invariant 2 - "A note that names an answer file names a file whose
//      recorded answer is the one the note announces": after the full
//      sequence, the pointer file's own text matches the text of the
//      LAST call in the sequence with a genuinely new (not-yet-seen)
//      updateId - the file is never left stale behind a later capture.
//
// Real subprocess I/O per call makes this the slow end of the property
// lane - numRuns and sequence length are both kept small deliberately
// (each fc run is several real `bb swarm_handoff.bb` spawns), matching
// this file's own "the property lane's isolation guards" precedent of
// bounding expensive generative runs rather than skipping them.
//
// Non-vacuity proven by hand at authoring time, TWICE: the naive "compare
// against only the single most-recently-recorded updateId" dedup this
// property itself caught (a replay INTERLEAVED with a different newer
// updateId - e.g. ids [1, 2, 1] - read the second "1" as unseen and
// queued a 3rd note) is exactly why the fix keeps a bounded seenUpdateIds
// HISTORY, not a single scalar; dropping that history back to a scalar
// fails invariant 1 on the first such interleaved case this property
// generates. Separately, reverting writeRoleAnswerFile to only fire when
// the answer does not fit inline (the pre-fix writeRoleAnswerFileIfNeeded
// shape) fails invariant 2 on its first generated "long answer then short
// answer" sequence. Both restored before landing.

// Built ONCE, shared across every fc iteration - copySeededRepoInto and
// copyLiveScriptClosureInto are themselves the expensive part (a real git
// checkout + a real script-dependency-closure copy). Reusing one fixture
// root and resetting only the mutable state each iteration touches (the
// outbox and the pointer file) keeps this property test's runtime bounded
// by the real `bb swarm_handoff.bb` subprocess cost alone, not by
// re-paying fixture setup 15+ times over.
let sharedRoot;

function ensureSharedRoot() {
  if (sharedRoot) {
    return sharedRoot;
  }
  sharedRoot = mkTmpDir('bl1203-property-');
  copySeededRepoInto(sharedRoot);
  copyLiveScriptClosureInto(path.join(sharedRoot, 'swarmforge', 'scripts'), [
    'commit_integrity_cli.bb', 'swarm_handoff.bb', 'ambulance_cli.bb',
    'operator_ask.bb', 'role_ask.bb', 'support_thread.bb'
  ]);
  fs.mkdirSync(path.join(sharedRoot, '.swarmforge'), { recursive: true });
  const tsv = [
    ['specifier', 'session', sharedRoot, 'swarmforge-specifier', 'specifier', 'claude', 'task'].join('\t'),
    ['coordinator', 'session', sharedRoot, 'swarmforge-coordinator', 'coordinator', 'claude', 'task'].join('\t'),
  ].join('\n');
  fs.writeFileSync(path.join(sharedRoot, '.swarmforge', 'roles.tsv'), tsv + '\n');
  return sharedRoot;
}

function resetMutableFixtureState(root) {
  fs.rmSync(path.join(root, '.swarmforge', 'handoffs'), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.swarmforge', 'operator', 'role-answers'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'tmp'), { recursive: true, force: true });
}

function outboxFileCount(root) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'outbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
}

const roleAnswerCallArb = fc.record({
  updateId: fc.integer({ min: 1, max: 4 }),
  text: fc.constantFrom('use staging', 'use staging please', 'go check the logs', 'ok'),
});

test(
  'property (BL-1203 invariant 1): a role receives at most one note per inbound answer identity across an arbitrary replay sequence',
  async () => {
    const root = ensureSharedRoot();
    try {
      await fc.assert(
        fc.asyncProperty(fc.array(roleAnswerCallArb, { minLength: 1, maxLength: 4 }), async (calls) => {
          resetMutableFixtureState(root);
          for (const call of calls) {
            await enqueueRoleAnswerNote(root, 'specifier', call.text, call.updateId);
          }
          const distinctUpdateIds = new Set(calls.map((c) => c.updateId));
          assert.equal(
            outboxFileCount(root),
            distinctUpdateIds.size,
            `expected exactly ${distinctUpdateIds.size} queued note(s) for ${distinctUpdateIds.size} distinct updateId(s) in ${JSON.stringify(calls)}, got ${outboxFileCount(root)}`
          );
        }),
        { numRuns: 10 }
      );
    } finally {
      // BL-1203 D1 (architect bounce, 20260828): a property failure must
      // not leak this fixture root, and must not hand a stale, already-
      // removed sharedRoot to the SECOND property test below
      // (ensureSharedRoot only rebuilds when sharedRoot is falsy).
      fs.rmSync(root, { recursive: true, force: true });
      sharedRoot = undefined;
    }
  },
  60000
);

test(
  'property (BL-1203 invariant 2): the pointer file always holds the text of the last genuinely-new-updateId capture, never a stale earlier one',
  async () => {
    const root = ensureSharedRoot();
    try {
      await fc.assert(
        fc.asyncProperty(fc.array(roleAnswerCallArb, { minLength: 1, maxLength: 4 }), async (calls) => {
          resetMutableFixtureState(root);
          const seen = new Set();
          let lastNewText;
          for (const call of calls) {
            await enqueueRoleAnswerNote(root, 'specifier', call.text, call.updateId);
            if (!seen.has(call.updateId)) {
              seen.add(call.updateId);
              lastNewText = call.text;
            }
          }
          const stored = JSON.parse(fs.readFileSync(path.join(root, roleAnswerFilePointerPath('specifier')), 'utf8'));
          assert.equal(
            stored.text,
            lastNewText,
            `expected the pointer file to hold "${lastNewText}" (the last genuinely-new capture) for ${JSON.stringify(calls)}, got "${stored.text}"`
          );
        }),
        { numRuns: 10 }
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      sharedRoot = undefined;
    }
  },
  60000
);
