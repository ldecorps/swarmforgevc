'use strict';

// BL-1811 (hardener-found): bl1811DomainAnswerRuleSteps.js's readSection
// scopes a literal check to one `## <heading>` section, never the whole
// file, so a scenario naming a specific section cannot be satisfied by a
// literal sitting in some OTHER section of the same prose file. No
// existing scenario in specs/features/BL-1811-...feature ever names a
// literal that exists ONLY outside its target section - every named
// literal happens to live only inside the section it is asserted against
// - so this scoping is entirely unverified by the acceptance suite: hand-
// mutating readSection to `return text` (ignore the heading argument
// entirely) left the whole feature at 4/4 ok. These synthetic, in-memory
// fixtures close that gap without touching any real prompt/constitution
// file (this ticket's own FIRM constraint: no prose file this ticket
// pins may be edited by anyone but the specifier).

const assert = require('node:assert/strict');
const { readSection } = require('../../specs/pipeline/steps/bl1811DomainAnswerRuleSteps');

const TEXT = [
  '## First Section',
  'alpha lives here only',
  '',
  '## Second Section',
  'bravo lives here only',
  '',
  '## Third Section',
  'charlie lives here only',
].join('\n');

test('readSection returns only the named section, not the whole file', () => {
  const section = readSection(TEXT, '## Second Section');
  assert.ok(section.includes('bravo lives here only'), "expected the named section's own content");
  assert.ok(!section.includes('alpha lives here only'), 'must not include a PRECEDING section\'s content');
  assert.ok(!section.includes('charlie lives here only'), 'must not include a FOLLOWING section\'s content');
});

test('readSection stops at the next heading, not at end of file', () => {
  const section = readSection(TEXT, '## First Section');
  assert.ok(!section.includes('## Second Section'), 'must not run past the next heading');
});

test('readSection extends to end of file when the named section is last', () => {
  const section = readSection(TEXT, '## Third Section');
  assert.ok(section.includes('charlie lives here only'));
});

test('readSection throws when the named heading is absent, rather than silently returning the whole file', () => {
  assert.throws(() => readSection(TEXT, '## No Such Section'), /no heading starting with/);
});
