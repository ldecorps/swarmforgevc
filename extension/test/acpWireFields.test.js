const assert = require('node:assert/strict');
const { readSessionId, readToolName, readToolStatus, readText } = require('../out/swarm/acpWireFields');

// BL-1081 hardening: these readers were previously exercised only INDIRECTLY
// through acpSessionEvents.test.js's calls to parseAcpLine, which never drove
// several of their own defensive branches (a non-string sessionId, a null
// toolCall, whitespace around a tool name, the literal 'started' wire value,
// an empty text block inside a list, a null content/text pair). Direct tests
// here, at the actual unit boundary these functions live at.

test('a sessionId is read only when it is actually a string - a stray number or bool is not passed through', () => {
  assert.equal(readSessionId({ params: { sessionId: 5 } }), undefined);
  assert.equal(readSessionId({ result: { sessionId: true } }), undefined);
  assert.equal(readSessionId({ params: { sessionId: 5 }, result: { sessionId: 'r1' } }), 'r1', 'a valid result-side id still falls back through when params is not one');
});

test('a tool name is trimmed even when nothing downstream would otherwise catch it', () => {
  assert.equal(readToolName({ toolName: '  bash  ' }), 'bash');
});

test('a toolCall value that is null does not crash the recursive lookup', () => {
  // typeof null === 'object', so a bare truthiness check alone would recurse
  // into it and crash reading a property off null.
  assert.equal(readToolName({ toolCall: null }), null);
});

test('the literal wire value "started" maps to itself, not only its synonyms in_progress/pending', () => {
  assert.equal(readToolStatus({ status: 'started' }), 'started');
});

test('a text block with an empty string is dropped from a joined list, not kept as a blank entry', () => {
  // Joining ['a', '', 'b'] produces 'ab' whether or not the empty entry
  // survives the filter - concatenating '' changes nothing. A list whose
  // ONLY entry is empty is the case that actually distinguishes "filtered
  // out" (empty list -> null) from "kept as a blank entry" (one entry -> '').
  assert.equal(readText({ content: [{ type: 'text', text: '' }] }), null, 'an all-empty list must read as no text, not as empty text');
  assert.equal(readText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: '' }, { type: 'text', text: 'b' }] }), 'ab');
});

test('a content and text that are both explicitly null does not crash - it reads as no text', () => {
  assert.equal(readText({ content: null, text: null }), null);
  assert.equal(readText({ text: null }), null);
});
