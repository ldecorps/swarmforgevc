'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  AGENT_NOTE_USER_MESSAGE_MAX_LEN,
  composeAgentNoteMessage,
  decideAgentNoteSend,
  isAgentNoteRequestShape,
  isOperatorAttributedAgentNote,
  queueAgentNoteViaHandoff,
  readDeclaredRoleNames,
  validateAgentNoteRole,
  validateAgentNoteUserMessage,
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

test('validateAgentNoteUserMessage refuses a carriage return', () => {
  const result = validateAgentNoteUserMessage('hello\rworld');
  assert.equal(result.ok, false);
  assert.match(result.reason, /single-line requirement/);
});

test('validateAgentNoteUserMessage refuses control characters', () => {
  const result = validateAgentNoteUserMessage('hello\u0001');
  assert.equal(result.ok, false);
  assert.match(result.reason, /single-line requirement/);
});

test('validateAgentNoteUserMessage refuses a message that exceeds the one-line cap after prefix', () => {
  const result = validateAgentNoteUserMessage('x'.repeat(AGENT_NOTE_USER_MESSAGE_MAX_LEN + 1));
  assert.equal(result.ok, false);
  assert.match(result.reason, /one-line character limit/);
});

test('validateAgentNoteUserMessage accepts the longest allowed user message', () => {
  const message = 'x'.repeat(AGENT_NOTE_USER_MESSAGE_MAX_LEN);
  const result = validateAgentNoteUserMessage(message);
  assert.equal(result.ok, true);
  assert.equal(result.queuedMessage.length, 80);
});

test('operator-attributed notes are distinguishable from plain coordinator notes', () => {
  assert.equal(isOperatorAttributedAgentNote(composeAgentNoteMessage('hi')), true);
  assert.equal(isOperatorAttributedAgentNote('use staging please'), false);
});

test('validateAgentNoteRole accepts declared roles', () => {
  const result = validateAgentNoteRole('coder', ['coder', 'cleaner']);
  assert.deepEqual(result, { ok: true });
});

test('validateAgentNoteRole refuses undeclared roles', () => {
  const result = validateAgentNoteRole('ghost', ['coder', 'cleaner']);
  assert.equal(result.ok, false);
  assert.match(result.reason, /that the role is not declared/);
});

test('isAgentNoteRequestShape accepts role and message strings', () => {
  assert.equal(isAgentNoteRequestShape({ role: 'coder', message: 'hi' }), true);
});

test('isAgentNoteRequestShape rejects non-objects and missing fields', () => {
  assert.equal(isAgentNoteRequestShape(null), false);
  assert.equal(isAgentNoteRequestShape({ role: 'coder' }), false);
  assert.equal(isAgentNoteRequestShape({ message: 'hi' }), false);
  assert.equal(isAgentNoteRequestShape({ role: 1, message: 'hi' }), false);
});

test('readDeclaredRoleNames returns an empty list when roles.tsv is missing', () => {
  const root = mkTmpDir('bl790-roles-');
  assert.deepEqual(readDeclaredRoleNames(root), []);
});

test('queueAgentNoteViaHandoff shells to swarm_handoff with coordinator role', async () => {
  const root = mkTmpDir('bl790-queue-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'role\tworktree\n');
  const calls = [];
  const result = await queueAgentNoteViaHandoff(root, 'coder', composeAgentNoteMessage('hi'), async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: '', stderr: '' };
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'bb');
  assert.match(calls[0].args[0], /swarm_handoff\.bb$/);
  assert.equal(calls[0].options.env.SWARMFORGE_ROLE, 'coordinator');
  const draft = fs.readFileSync(calls[0].args[1], 'utf8');
  assert.match(draft, /^type: note\n/m);
  assert.match(draft, /^to: coder\n/m);
  assert.match(draft, /^priority: 00\n/m);
  assert.match(draft, /^message: Bubble: hi\n/m);
});

test('queueAgentNoteViaHandoff surfaces handoff failures', async () => {
  const root = mkTmpDir('bl790-queue-fail-');
  const result = await queueAgentNoteViaHandoff(root, 'coder', composeAgentNoteMessage('hi'), async () => {
    throw new Error('boom');
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /handoff delivery failed/);
});

test('decideAgentNoteSend queues for a declared role', async () => {
  const root = mkTmpDir('bl790-decide-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${root}\tbranch\tCoder\tcursor\n`
  );
  const result = await decideAgentNoteSend(
    root,
    { role: 'coder', message: 'use staging please' },
    async () => ({ stdout: '', stderr: '' })
  );
  assert.deepEqual(result, {
    success: true,
    role: 'coder',
    message: composeAgentNoteMessage('use staging please'),
  });
});

test('decideAgentNoteSend refuses undeclared roles before queuing', async () => {
  const root = mkTmpDir('bl790-decide-role-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${root}\tbranch\tCoder\tcursor\n`
  );
  let execCalled = false;
  const result = await decideAgentNoteSend(
    root,
    { role: 'ghost', message: 'hi' },
    async () => {
      execCalled = true;
      return { stdout: '', stderr: '' };
    }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /that the role is not declared/);
  assert.equal(execCalled, false);
});
