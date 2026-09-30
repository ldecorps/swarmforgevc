'use strict';

// BL-1732/BL-654 declared invariant 1: "A value joins the shared vocabulary
// only as part of a submitted intake that uses it." A draft's own local
// additions (withValue) must never touch the on-disk shared vocabulary -
// only promoteVocabulary (Submit's own call) may, and only with exactly
// the additions it was given. Drives the REAL intakeVocabularyStore
// module, never a reimplementation.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const {
  seedVocabularyIfMissing,
  readVocabulary,
  withValue,
  promoteVocabulary,
} = require('../out/bridge/intakeVocabularyStore');
const { submitIntake } = require('../out/bridge/intakeWriter');

const SLOT_ARB = fc.constantFrom('actor', 'action', 'goal');
const VALUE_ARB = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

test(
  'BL-1732/BL-654 invariant: withValue additions never reach disk; only promoteVocabulary writes what it was given',
  () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(SLOT_ARB, VALUE_ARB), { minLength: 1, maxLength: 5 }),
        SLOT_ARB,
        VALUE_ARB,
        (draftAdditions, promotedSlot, promotedValue) => {
          const root = mkTmpDir('bl1732-vocab-invariant-');
          seedVocabularyIfMissing(root);
          const before = readVocabulary(root);

          // A draft accumulates local additions purely in memory.
          let draftVocab = before;
          for (const [slot, value] of draftAdditions) {
            draftVocab = withValue(draftVocab, slot, value);
          }
          // The on-disk vocabulary is untouched by any of that.
          assert.deepEqual(readVocabulary(root), before);

          // Only an explicit Submit (promoteVocabulary) writes to disk,
          // and only with the value it was actually given.
          promoteVocabulary(root, { [promotedSlot]: promotedValue });
          const after = readVocabulary(root);
          assert.ok(after[promotedSlot].includes(promotedValue.trim()));
          // Every OTHER draft addition (never passed to promoteVocabulary)
          // must still be absent from disk.
          for (const [slot, value] of draftAdditions) {
            if (slot === promotedSlot && value.trim() === promotedValue.trim()) {
              continue;
            }
            assert.ok(!after[slot].includes(value.trim()), `expected "${value}" to NOT have joined ${slot} on disk`);
          }
        }
      ),
      { numRuns: 30 }
    );
  }
);

// BL-1732 QA bounce D2: the property above proves promoteVocabulary itself
// does exactly what it is told - that was never the bug. submitIntake's
// OWN call site passed it the whole draft.newValues, unfiltered, so a
// value added via "add new" then abandoned (the dropdown switched back to
// an existing value before Submit) still joined the shared vocabulary.
// newValues is generated INDEPENDENTLY of the draft's own chosen slot
// values here, so most runs exercise exactly that abandoned-value shape;
// a generated newValues[slot] that happens to equal the draft's own
// chosen value for that slot is the legitimate "used" case instead.
function mkGitFixture() {
  const root = mkTmpDir('bl1732-vocab-submit-invariant-');
  copySeededRepoInto(root);
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed script closure'], { cwd: root });
  return root;
}

const SLOT_VALUE_ARB = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);
const NARRATIVE_SLOTS = ['actor', 'action', 'goal'];

test(
  "BL-1732/BL-654 invariant (QA bounce D2): submitIntake promotes a newValues[slot] entry only when it is the draft's own chosen value for that slot",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ actor: SLOT_VALUE_ARB, action: SLOT_VALUE_ARB, goal: SLOT_VALUE_ARB }),
        fc.record({
          actor: fc.option(SLOT_VALUE_ARB, { nil: undefined }),
          action: fc.option(SLOT_VALUE_ARB, { nil: undefined }),
          goal: fc.option(SLOT_VALUE_ARB, { nil: undefined }),
        }),
        async (chosen, newValues) => {
          const root = mkGitFixture();
          seedVocabularyIfMissing(root);
          const draft = { ...chosen, scenarios: 'Given a\nWhen b\nThen c', newValues };
          const result = await submitIntake(root, draft, new Date('2026-09-30T12:00:00Z'));
          assert.ok(result.ok, `expected submit to succeed: ${JSON.stringify(result)}`);
          const after = readVocabulary(root);
          for (const slot of NARRATIVE_SLOTS) {
            const nv = newValues[slot];
            if (nv === undefined) {
              continue;
            }
            const used = nv.trim() === draft[slot].trim();
            const joined = after[slot].includes(nv.trim());
            assert.equal(joined, used, `slot ${slot}: newValues "${nv}" ${used ? 'IS' : 'is NOT'} the draft's chosen value - expected joined=${used}, got ${joined}`);
          }
        }
      ),
      { numRuns: 15 }
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
