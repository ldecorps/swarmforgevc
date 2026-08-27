'use strict';

const assert = require('node:assert/strict');
const {
  AGENT_NOTE_USER_MESSAGE_MAX_LEN,
  composeAgentNoteMessage,
  isOperatorAttributedAgentNote,
  validateAgentNoteUserMessage,
  validateAgentNoteRole,
} = require('../out/bridge/agentNotesCore');

test('validateAgentNoteUserMessage accepts a short single-line note within budget', () => {
  const result = validateAgentNoteUserMessage('use staging please');
  assert.equal(result.ok, true);
  assert.equal(result.queuedMessage, composeAgentNoteMessage('use staging please'));
});

test('validateAgentNoteUserMessage refuses an empty message', () => {
  const result = validateAgentNoteUserMessage('');
  assert.equal(result.ok, false);
  assert.match(result.reason, /that a note needs a message/);
});

test('validateAgentNoteUserMessage refuses a line break', () => {
  const result = validateAgentNoteUserMessage('hello\nworld');
  assert.equal(result.ok, false);
  assert.match(result.reason, /single-line requirement/);
});

test('validateAgentNoteUserMessage refuses a tab control character', () => {
  const result = validateAgentNoteUserMessage('hello\tworld');
  assert.equal(result.ok, false);
  assert.match(result.reason, /single-line requirement/);
});

test('validateAgentNoteUserMessage refuses a message that exceeds the one-line cap after prefix', () => {
  const result = validateAgentNoteUserMessage('x'.repeat(AGENT_NOTE_USER_MESSAGE_MAX_LEN + 1));
  assert.equal(result.ok, false);
  assert.match(result.reason, /one-line character limit/);
});

test('operator-attributed notes are distinguishable from plain coordinator notes', () => {
  assert.equal(isOperatorAttributedAgentNote(composeAgentNoteMessage('hi')), true);
  assert.equal(isOperatorAttributedAgentNote('use staging please'), false);
});

test('validateAgentNoteRole refuses undeclared roles', () => {
  const result = validateAgentNoteRole('ghost', ['coder', 'cleaner']);
  assert.equal(result.ok, false);
  assert.match(result.reason, /that the role is not declared/);
});
