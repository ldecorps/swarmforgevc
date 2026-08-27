'use strict';

const assert = require('node:assert/strict');
const { isLiveGrepOffender } = require('../../specs/pipeline/steps/lib/bl781LiveGrepOffender');

// BL-781 QA bounce D1: scenario 07 must not treat the ticket's own feature
// file as a live caller of the deleted basenames it names in Examples.

test('specs/features paths are not live offenders (scenario 07 self-flag)', () => {
  assert.equal(
    isLiveGrepOffender(
      'specs/features/BL-781-retire-dead-babysitter-files-keep-list-preserved.feature'
    ),
    false
  );
});

test('product script paths remain live offenders', () => {
  assert.equal(isLiveGrepOffender('swarmforge/scripts/some_caller.sh'), true);
});

test('backlog, docs, steps, and test runners stay non-live', () => {
  assert.equal(isLiveGrepOffender('backlog/evidence/note.md'), false);
  assert.equal(isLiveGrepOffender('docs/how-to/x.md'), false);
  assert.equal(isLiveGrepOffender('specs/pipeline/steps/bl781RetireDeadBabysitterFilesKeepListPreservedSteps.js'), false);
  assert.equal(isLiveGrepOffender('swarmforge/scripts/test/babysitter_lib_test_runner.bb'), false);
});
