const assert = require('node:assert/strict');
const {
  createTranslationSession,
  translateString,
  segmentMarkdown,
  translateMarkdown,
} = require('../out/i18n/translate');
const { emptyTranslationCache, hashSourceText } = require('../out/i18n/translationCache');

// BL-118/BL-230: the translation pass, tested with a fake MT engine
// (records calls) - no live translation API in tests, per this ticket's
// own non-behavioral gate. BL-230 generalized translateString/
// translateMarkdown to take an explicit target locale (a session no
// longer carries one fixed targetLang - see translationCache.ts's schema
// bump for why: a single-locale cache silently collided across locales).

function fakeEngine(translations = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      async translate(text, targetLang) {
        calls.push({ text, targetLang });
        if (text in translations) {
          return { success: true, text: translations[text] };
        }
        return { success: false, error: 'no fake translation for: ' + text };
      },
    },
  };
}

test('translateString calls the engine on a cache miss and stores the result', async () => {
  const { engine, calls } = fakeEngine({ hello: 'bonjour' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const result = await translateString(session, 'hello', 'fr');

  assert.deepEqual(result, { text: 'bonjour' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetLang, 'fr');
  assert.equal(session.stats.misses, 1);
  assert.equal(session.stats.hits, 0);
});

test('bilingual-03: an unchanged source string is served from the cache, not re-translated', async () => {
  const { engine, calls } = fakeEngine({ hello: 'bonjour' });
  const cache = { schemaVersion: 2, entries: { [hashSourceText('hello')]: { fr: 'bonjour (cached)' } } };
  const session = createTranslationSession(cache, engine);

  const result = await translateString(session, 'hello', 'fr');

  assert.deepEqual(result, { text: 'bonjour (cached)' });
  assert.equal(calls.length, 0, 'the engine must never be called for a cache hit');
  assert.equal(session.stats.hits, 1);
  assert.equal(session.stats.misses, 0);
});

test('only changed (uncached) strings are sent to the engine across a batch', async () => {
  const { engine, calls } = fakeEngine({ new1: 'nouveau1', new2: 'nouveau2' });
  const cache = { schemaVersion: 2, entries: { [hashSourceText('cached1')]: { fr: 'mis en cache' } } };
  const session = createTranslationSession(cache, engine);

  await translateString(session, 'cached1', 'fr');
  await translateString(session, 'new1', 'fr');
  await translateString(session, 'new2', 'fr');
  await translateString(session, 'cached1', 'fr'); // seen twice - second time still a cache hit

  assert.deepEqual(calls.map((c) => c.text), ['new1', 'new2']);
  assert.equal(session.stats.hits, 2);
  assert.equal(session.stats.misses, 2);
});

test('a cache miss populates the cache so a later session reuses it', async () => {
  const { engine } = fakeEngine({ hello: 'bonjour' });
  const cache = emptyTranslationCache();
  const session = createTranslationSession(cache, engine);

  await translateString(session, 'hello', 'fr');

  assert.equal(cache.entries[hashSourceText('hello')].fr, 'bonjour');
});

test('bilingual-05: an engine failure degrades to the source text, flagged untranslated - never throws', async () => {
  const { engine } = fakeEngine({});
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const result = await translateString(session, 'no translation available', 'fr');

  assert.deepEqual(result, { text: 'no translation available', untranslated: true });
  assert.equal(session.stats.failures, 1);
});

test('a blank/whitespace-only string is never sent to the engine', async () => {
  const { engine, calls } = fakeEngine({});
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const result = await translateString(session, '   ', 'fr');

  assert.deepEqual(result, { text: '   ' });
  assert.equal(calls.length, 0);
});

// ── BL-230: N-locale cache dimension ─────────────────────────────────────

test('the SAME source string translated into two different locales does not collide in the cache', async () => {
  const { engine, calls } = fakeEngine({ hello: 'hola' });
  const cache = { schemaVersion: 2, entries: { [hashSourceText('hello')]: { fr: 'bonjour' } } };
  const session = createTranslationSession(cache, engine);

  const frResult = await translateString(session, 'hello', 'fr');
  const esResult = await translateString(session, 'hello', 'es');

  assert.equal(frResult.text, 'bonjour', 'fr was already cached - must not be overwritten by the es call');
  assert.equal(esResult.text, 'hola', 'es is a genuine cache miss, calls the engine with its own target');
  assert.equal(cache.entries[hashSourceText('hello')].fr, 'bonjour');
  assert.equal(cache.entries[hashSourceText('hello')].es, 'hola');
  assert.deepEqual(calls.map((c) => c.targetLang), ['es']);
});

// ── BL-230: jargon preservation ───────────────────────────────────────────

test('a jargon token (ticket id) survives translation verbatim, wrapped for the engine and unwrapped from its response', async () => {
  const { engine, calls } = fakeEngine({ 'Fix <jargon>BL-230</jargon> now.': 'Réparer <jargon>BL-230</jargon> maintenant.' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const result = await translateString(session, 'Fix BL-230 now.', 'fr');

  assert.equal(result.text, 'Réparer BL-230 maintenant.');
  assert.equal(calls[0].text, 'Fix <jargon>BL-230</jargon> now.', 'the engine must receive the jargon-wrapped text');
});

// ── segmentMarkdown / translateMarkdown (bilingual-06) ──────────────────────

test('segmentMarkdown splits prose and fenced code into alternating segments', () => {
  const markdown = ['Some prose.', '```js', 'const x = 1;', '```', 'More prose.'].join('\n');
  const segments = segmentMarkdown(markdown);
  assert.deepEqual(segments.map((s) => s.kind), ['prose', 'code', 'prose']);
  assert.equal(segments[0].text, 'Some prose.');
  assert.equal(segments[1].text, '```js\nconst x = 1;\n```');
  assert.equal(segments[2].text, 'More prose.');
});

test('segmentMarkdown segments rejoin (via \\n) to reconstruct the exact original markdown', () => {
  const markdown = ['# Title', '', 'Prose before.', '```sh', 'echo hi', '```', '', 'Prose after.', '```', 'bare fence', '```'].join('\n');
  const segments = segmentMarkdown(markdown);
  assert.equal(segments.map((s) => s.text).join('\n'), markdown);
});

test('segmentMarkdown with no fences at all is a single prose segment', () => {
  const markdown = 'Just prose.\nMore prose.';
  const segments = segmentMarkdown(markdown);
  assert.deepEqual(segments, [{ kind: 'prose', text: markdown }]);
});

test('bilingual-06: translateMarkdown leaves fenced code blocks verbatim, translating only prose', async () => {
  const { engine, calls } = fakeEngine({ 'Some prose.': 'Un peu de prose.', 'More prose.': 'Plus de prose.' });
  const session = createTranslationSession(emptyTranslationCache(), engine);
  const markdown = ['Some prose.', '```js', 'const secretCode = 1;', '```', 'More prose.'].join('\n');

  const result = await translateMarkdown(session, markdown, 'fr');

  assert.match(result.text, /Un peu de prose\./);
  assert.match(result.text, /Plus de prose\./);
  assert.match(result.text, /const secretCode = 1;/, 'code fence content must survive verbatim into the translated rendering');
  assert.equal(calls.length, 2, 'the engine is called only for the two prose segments, never the code segment');
});

test('translateMarkdown flags the whole document untranslated if any prose segment fails', async () => {
  const { engine } = fakeEngine({ 'translatable prose': 'prose traduisible' });
  const session = createTranslationSession(emptyTranslationCache(), engine);
  const markdown = ['translatable prose', 'untranslatable prose'].join('\n\n');

  const result = await translateMarkdown(session, markdown, 'fr');

  assert.equal(result.untranslated, true);
});

test('translateMarkdown with only code fences never calls the engine', async () => {
  const { engine, calls } = fakeEngine({});
  const session = createTranslationSession(emptyTranslationCache(), engine);
  const markdown = ['```mermaid', 'graph TD; A-->B;', '```'].join('\n');

  const result = await translateMarkdown(session, markdown, 'fr');

  assert.equal(result.text, markdown);
  assert.equal(calls.length, 0);
});
