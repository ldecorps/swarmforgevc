You are working in this repository. Implement the function `wordFrequency`
exported from `src/wordFrequency.js` so it satisfies this exact contract:

`wordFrequency(text)` returns an object mapping each distinct word in `text`
to how many times it occurs.

Rules:
- A "word" is a maximal run of ASCII letters (a-z, A-Z). Every other
  character (digits, punctuation, whitespace, underscores) is a separator,
  never part of a word.
- Word matching is case-insensitive: normalize every word to lowercase
  before counting.
- Empty input, or input with no letters at all, returns an empty object `{}`.
- Do not add any dependencies. Do not modify the test file.

When you are done, the existing test suite in `test/wordFrequency.test.js`
must pass when run with `node --test test/wordFrequency.test.js`. Do not
stop until it passes, and do not report success without actually running
the tests yourself.
