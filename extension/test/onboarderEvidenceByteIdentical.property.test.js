const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

// BL-684 invariant 3 (property authorship rests with the coder, first pass -
// BL-654): "The dated audit trail is byte-identical: nothing under
// backlog/evidence/ or backlog/done/ is renamed, reworded or rewritten - a
// record keeps the words that were actually used when it was written."
//
// Scope: this rename's own risk surface is exactly the files a careless
// repo-wide "facilitator" -> "onboarder" sweep would be tempted to touch -
// every evidence/done file this repo currently has that names or discusses
// the Onboarding Facilitator (found via `git grep -lI -i facilitator --
// backlog/evidence backlog/done`, captured 2026-07-27 while implementing
// BL-684). This is NOT a permanent "no file under evidence/done may ever
// change" policy (that is a different, broader invariant this ticket does
// not own) - it is this parcel's own proof that ITS rename left the dated
// record untouched. A sha256 snapshot rather than a git-diff check on
// purpose: the exact base commit this test runs against varies by stage
// (coder/cleaner/architect/hardener/documenter/QA each hold a different
// merge point), but "does this specific file's content match what it was
// the day this invariant was written" does not depend on which commit is
// HEAD.
//
// Generator reach: the file list is this invariant's own finite domain (no
// wider space exists to sample from) - numRuns is a large multiple of the
// list length so fast-check's constantFrom covers every entry with
// overwhelming probability, the same reachability-floor reasoning as
// invariant 1's property test.
const REPO_ROOT = path.join(__dirname, '..', '..');

const PROTECTED_FILES = [
  { path: 'backlog/done/BL-567-expeditor-offline-single-ticket-pipeline.yaml', sha256: 'b9979adad2ff8885f3dca73bac1f22822faef30b8bccb2bdc9a8715d159460f1' },
  { path: 'backlog/done/BL-629-sync-refuses-non-qa-approved-main.yaml', sha256: '69b59cf4f4c37448327e61fd8887a6fb1ada04872702c87acea4e9a4efd8f47f' },
  { path: 'backlog/done/BL-633-ticket-invariants-section-distinct-from-acceptance.yaml', sha256: '10128f3fd1e2e249f82417b2cc7eb0aa89905db53b2692671c750a899a419f34' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce2-20260725.md', sha256: '7e82c282a8d5cd7f7572fd00ae54c29f5a6b77a80535642a54523a459e709091' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce3-20260725.md', sha256: 'e0dce0a66bbb173b918a97fd57228877a83ae2047138c38ac33f2b21759669a1' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce4-20260725.md', sha256: 'd098c3c9f99b44bee4211a6773bcd0f2eca87e71edc52a967bbd6e094e66ec89' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce5-20260725.md', sha256: '9c44ddde30b1dbfc026fd79040b44a55bb1ceaf94641d60fa175371f58cda4a2' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce5-P5.property.test.js.parked', sha256: '88a4361531a181a4ab0d157119158c47d94b2b4bc93f22afa7f304446320ec2e' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce6-20260725.md', sha256: 'e7089bd037cce0d04dcac23456802b8c97b7177c981ba1f8bad53725ded05548' },
  { path: 'backlog/evidence/BL-590-facilitator-slice1-architect-bounce6-P6.property.test.js.parked', sha256: '7770cd98d1a1abadd4f8998f82c08259f54e053f51bc5d8cd83c28adcf52b3ed' },
  { path: 'backlog/evidence/BL-590-onboarding-facilitator-slice1-architect-bounce-20260725.md', sha256: '2175fbbdcb3508312949b33ec790f4d7273741366cb7f2a83dedabe314ed7bcc' },
  { path: 'backlog/evidence/BL-590-onboardingFacilitator.property.test.js', sha256: '58f6d7df4b508746910e6524bbc7898be79b6826aea01722c4b8a8e7c1224d89' },
  { path: 'backlog/evidence/BL-590-parked-20260725.md', sha256: '44b9c92bb46c99ed3528af602483adb1cec3fc0f7adc8278c49fd7b7f3720a09' },
  { path: 'backlog/evidence/BL-629-architect-bounce1-20260725.md', sha256: '7d5d45ac59c3617282560760d916f9b11017f0ac291c464bb4af594bc28e94a0' },
];

function sha256Of(relPath) {
  const buf = fs.readFileSync(path.join(REPO_ROOT, relPath));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

test('property: every at-risk evidence/done file for the facilitator-to-onboarder rename stays byte-identical', () => {
  fc.assert(
    fc.property(fc.constantFrom(...PROTECTED_FILES), (entry) => {
      assert.equal(entry.sha256.length, 64, `fixture bug: not a real sha256 for ${entry.path}`);
      assert.equal(
        sha256Of(entry.path),
        entry.sha256,
        `${entry.path} changed - the dated audit trail must never be renamed, reworded or rewritten (invariant 3)`
      );
    }),
    { numRuns: PROTECTED_FILES.length * 40 }
  );
});
