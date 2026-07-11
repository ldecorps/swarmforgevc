const assert = require('node:assert/strict');
const { parseContractYaml, renderContractYaml, generateContractMarkdown } = require('../out/onboarding/contractView');

const FIXTURE_CONTRACT = {
  scope: ['Build the thing.'],
  outOfScope: ['Rewrite the stack.'],
  boundaries: ['Respect the README.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

test('renderContractYaml then parseContractYaml round-trips the contract unchanged', () => {
  const yaml = renderContractYaml(FIXTURE_CONTRACT);
  const parsed = parseContractYaml(yaml);

  assert.deepEqual(parsed, FIXTURE_CONTRACT);
});

test('parseContractYaml returns null for unparseable YAML (malformed)', () => {
  const parsed = parseContractYaml('scope: [unclosed');

  assert.equal(parsed, null);
});

test('parseContractYaml returns null when a required field is missing', () => {
  const yaml = renderContractYaml(FIXTURE_CONTRACT).replace(/agreement:.*\n?/, '');

  assert.equal(parseContractYaml(yaml), null);
});

test('parseContractYaml returns null for an unknown agreement value (fail-closed on unknown, not a passthrough)', () => {
  const yaml = renderContractYaml({ ...FIXTURE_CONTRACT, agreement: 'sort-of' });

  assert.equal(parseContractYaml(yaml), null);
});

test('parseContractYaml returns null when scope is not an array of strings', () => {
  const yaml = renderContractYaml({ ...FIXTURE_CONTRACT, scope: 'not-an-array' });

  assert.equal(parseContractYaml(yaml), null);
});

test('parseContractYaml returns null for a YAML document that is a list, not an object', () => {
  assert.equal(parseContractYaml('- one\n- two\n'), null);
});

// BL-262 legible-view-mirrors-source-03
test('generateContractMarkdown shows the same scope and agreement state as the source', () => {
  const markdown = generateContractMarkdown(FIXTURE_CONTRACT);

  assert.match(markdown, /Agreement: proposed/);
  assert.match(markdown, /Build the thing\./);
});

test('generateContractMarkdown reflects an agreed contract distinctly from a proposed one', () => {
  const agreedMarkdown = generateContractMarkdown({ ...FIXTURE_CONTRACT, agreement: 'agreed' });

  assert.match(agreedMarkdown, /Agreement: agreed/);
  assert.doesNotMatch(agreedMarkdown, /Agreement: proposed/);
});
