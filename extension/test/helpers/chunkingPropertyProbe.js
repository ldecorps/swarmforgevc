'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');

/** Small maxLen passed explicitly so generator bounds stay independent of TELEGRAM_MESSAGE_MAX_LENGTH. */
const CHUNKING_PROPERTY_MAX_LEN = 50;

function runChunkingProperty(splitFn, { minRuns = 80 } = {}) {
  let sawMultiChunk = false;
  let losingInput;
  try {
    fc.assert(
      fc.property(fc.string({ minLength: 51, maxLength: 200 }), (text) => {
        const chunks = splitFn(text, CHUNKING_PROPERTY_MAX_LEN);
        if (chunks.length > 1) {
          sawMultiChunk = true;
        }
        for (const chunk of chunks) {
          assert.ok(chunk.length <= CHUNKING_PROPERTY_MAX_LEN);
        }
        assert.equal(chunks.join(''), text);
      }),
      { numRuns: minRuns }
    );
    return { passed: true, sawMultiChunk, losingInput: undefined };
  } catch (err) {
    const message = String(err);
    const match = message.match(/Counterexample: (\[[\s\S]*?\])(?:\n|$)/);
    if (match) {
      try {
        losingInput = JSON.parse(match[1].replace(/'/g, '"'))[0];
      } catch {
        losingInput = match[1];
      }
    }
    return { passed: false, sawMultiChunk, losingInput, error: err };
  }
}

function brokenSplitDropsContinuationHead(splitTelegramChunks) {
  return function brokenSplit(text, maxLen) {
    const chunks = splitTelegramChunks(text, maxLen);
    if (chunks.length <= 1) {
      return chunks;
    }
    return chunks.map((chunk, index) => (index === 0 ? chunk : chunk.slice(1)));
  };
}

module.exports = {
  CHUNKING_PROPERTY_MAX_LEN,
  runChunkingProperty,
  brokenSplitDropsContinuationHead,
};
