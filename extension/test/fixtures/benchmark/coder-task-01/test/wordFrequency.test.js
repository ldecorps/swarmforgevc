'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wordFrequency } = require('../src/wordFrequency');

test('empty string returns an empty object', () => {
  assert.deepEqual(wordFrequency(''), {});
});

test('a single word', () => {
  assert.deepEqual(wordFrequency('cat'), { cat: 1 });
});

test('repeated words are counted case-insensitively', () => {
  assert.deepEqual(wordFrequency('Cat cat CAT'), { cat: 3 });
});

test('punctuation separates words and is discarded', () => {
  assert.deepEqual(wordFrequency('Hello, world! Hello?'), { hello: 2, world: 1 });
});

test('digits, hyphens, and underscores are separators too', () => {
  assert.deepEqual(wordFrequency('a-b a_b a.b a1b'), { a: 4, b: 4 });
});

test('newlines and tabs separate words', () => {
  assert.deepEqual(wordFrequency('foo\tbar\nfoo'), { foo: 2, bar: 1 });
});
