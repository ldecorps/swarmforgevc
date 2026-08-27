const assert = require('node:assert/strict');
const { wrapJargonForTranslation, unwrapJargonTags } = require('../out/i18n/jargonPreserve');

// BL-230: the jargon preserve-list wraps ticket ids/role names/product name
// in <jargon> tags before a translate() call (DeepL's ignore_tags leaves
// tagged content untranslated) and strips them back out afterward.

test('wraps a ticket id in jargon tags', () => {
  assert.equal(wrapJargonForTranslation('Fix BL-230 before release.'), 'Fix <jargon>BL-230</jargon> before release.');
});

test('wraps a GH-style ticket id too', () => {
  assert.equal(wrapJargonForTranslation('Imported from GH-42.'), 'Imported from <jargon>GH-42</jargon>.');
});

test('wraps a pipeline role name, case-insensitively', () => {
  assert.equal(wrapJargonForTranslation('Ask the coder to fix this.'), 'Ask the <jargon>coder</jargon> to fix this.');
  assert.equal(wrapJargonForTranslation('The QA role approves it.'), 'The <jargon>QA</jargon> role approves it.');
});

test('wraps the product name', () => {
  assert.equal(wrapJargonForTranslation('SwarmForge ships this.'), '<jargon>SwarmForge</jargon> ships this.');
});

test('wraps every distinct jargon token in a sentence with several', () => {
  assert.equal(
    wrapJargonForTranslation('BL-230 was reviewed by the architect for SwarmForge.'),
    '<jargon>BL-230</jargon> was reviewed by the <jargon>architect</jargon> for <jargon>SwarmForge</jargon>.'
  );
});

test('does not wrap a role-like word that is only a substring of another word', () => {
  // "coder" must not match inside "encoder" or similar - \b boundaries.
  assert.equal(wrapJargonForTranslation('The encoder handles this.'), 'The encoder handles this.');
});

test('leaves ordinary prose with no jargon completely unchanged', () => {
  const text = 'This is an ordinary sentence with nothing special in it.';
  assert.equal(wrapJargonForTranslation(text), text);
});

test('unwrapJargonTags strips the tags, restoring the plain token in place', () => {
  assert.equal(unwrapJargonTags('Réparer <jargon>BL-230</jargon> avant la sortie.'), 'Réparer BL-230 avant la sortie.');
});

test('unwrapJargonTags is a no-op on text with no jargon tags', () => {
  const text = 'Rien à faire ici.';
  assert.equal(unwrapJargonTags(text), text);
});

test('wrap then unwrap round-trips to the original text exactly', () => {
  const original = 'BL-230 was reviewed by the architect for SwarmForge.';
  assert.equal(unwrapJargonTags(wrapJargonForTranslation(original)), original);
});
