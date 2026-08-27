'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const {
  AGENT_NOTE_MESSAGE_MAX_LEN,
  AGENT_NOTE_OPERATOR_PREFIX,
  AGENT_NOTE_USER_MESSAGE_MAX_LEN,
  composeAgentNoteMessage,
  decideAgentNoteSend,
  validateAgentNoteUserMessage,
} = require('../out/bridge/agentNotesCore');

// BL-790 invariants, coder-authored per BL-654.
// Runs ONLY via `npm run test:properties`.

const printableArb = fc.constantFrom(...'abcXYZ0123 ./-_:é中');
const forbiddenCharArb = fc.constantFrom('\n', '\r', '\x00', '\x0b', '\x1f', '\x7f');
const userMessageCharArb = fc.oneof({ weight: 3, arbitrary: printableArb }, { weight: 1, arbitrary: forbiddenCharArb });
const userMessageArb = fc.oneof(
  fc.array(userMessageCharArb, { maxLength: 120 }).map((cs) => cs.join('')),
  fc.string({ unit: 'binary', maxLength: 120 })
);
const roleArb = fc.constantFrom('coder', 'cleaner', 'architect', 'specifier', 'coordinator', 'ghost');

function mkTargetWithRoles(roles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl790-prop-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const tsv = roles
    .map((role) => [role, `${role}-wt`, root, `swarmforge-${role}`, role, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${tsv}\n`);
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  return root;
}

function countAgentNoteDrafts(root) {
  const dir = path.join(root, 'tmp');
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return fs.readdirSync(dir).filter((name) => name.startsWith('agent-note-draft-')).length;
}

function countOutboxNotes(root) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'outbox');
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return fs.readdirSync(dir).filter((name) => name.endsWith('.handoff')).length;
}

// Matches agentNotesCore hasForbiddenLineOrControl (tab is allowed on a single line).
const FORBIDDEN_CHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\n|\r/;

test('BL-790 invariant 2: no caller message produces a queued header over 80 chars or spanning more than one line', () => {
  fc.assert(
    fc.property(userMessageArb, (message) => {
      const result = validateAgentNoteUserMessage(message);
      if (result.ok) {
        assert.doesNotMatch(result.queuedMessage, FORBIDDEN_CHAR);
        assert.ok(result.queuedMessage.length <= AGENT_NOTE_MESSAGE_MAX_LEN);
        assert.equal(result.queuedMessage, composeAgentNoteMessage(message));
        return true;
      }
      if (message.length === 0) {
        return result.reason.includes('that a note needs a message');
      }
      if (FORBIDDEN_CHAR.test(message)) {
        return result.reason.includes('the single-line requirement');
      }
      return result.reason.includes('the one-line character limit');
    }),
    { numRuns: 500 }
  );
});

test('BL-790 invariant 1: successful sends always shell to swarm_handoff.bb, never write mailbox paths directly', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: AGENT_NOTE_USER_MESSAGE_MAX_LEN }).filter((s) => !FORBIDDEN_CHAR.test(s)),
      async (message) => {
        const root = mkTargetWithRoles(['coder']);
        const execCalls = [];
        const exec = async (file, args, options) => {
          execCalls.push({ file, args, options });
          return { stdout: '', stderr: '' };
        };
        const result = await decideAgentNoteSend(root, { role: 'coder', message }, exec);
        if (!result.success) {
          return false;
        }
        assert.equal(execCalls.length, 1);
        assert.match(execCalls[0].file, /bb$/);
        assert.match(execCalls[0].args[0], /swarm_handoff\.bb$/);
        assert.equal(execCalls[0].options.env.SWARMFORGE_ROLE, 'coordinator');
        for (const dirName of ['inbox', 'outbox']) {
          const dir = path.join(root, '.swarmforge', 'handoffs', dirName);
          if (fs.existsSync(dir)) {
            assert.equal(fs.readdirSync(dir).length, 0, 'must not hand-write mailbox files');
          }
        }
        return true;
      }
    ),
    { numRuns: 40 }
  );
});

test('BL-790 invariant 3: a refused request queues nothing — no draft, no parcel', async () => {
  await fc.assert(
    fc.asyncProperty(userMessageArb, roleArb, async (message, role) => {
      const root = mkTargetWithRoles(['coder', 'cleaner']);
      const execCalls = [];
      const exec = async (file, args, options) => {
        execCalls.push({ file, args, options });
        return { stdout: '', stderr: '' };
      };
      const draftsBefore = countAgentNoteDrafts(root);
      const outboxBefore = countOutboxNotes(root);
      const result = await decideAgentNoteSend(root, { role, message }, exec);
      const validation = validateAgentNoteUserMessage(message);
      const roleOk = ['coder', 'cleaner'].includes(role);
      const shouldSucceed = roleOk && validation.ok;
      if (shouldSucceed) {
        assert.equal(result.success, true);
        assert.equal(execCalls.length, 1);
        return true;
      }
      assert.equal(result.success, false);
      assert.equal(execCalls.length, 0);
      assert.equal(countAgentNoteDrafts(root), draftsBefore);
      assert.equal(countOutboxNotes(root), outboxBefore);
      return true;
    }),
    { numRuns: 200 }
  );
});

test('BL-790: concrete cases the properties above generalize', async () => {
  const overBudget = 'x'.repeat(AGENT_NOTE_USER_MESSAGE_MAX_LEN + 1);
  assert.equal(validateAgentNoteUserMessage(overBudget).ok, false);
  assert.equal(validateAgentNoteUserMessage('a\nb').ok, false);
  assert.equal(validateAgentNoteUserMessage('').ok, false);

  const root = mkTargetWithRoles(['specifier']);
  let execCount = 0;
  const refused = await decideAgentNoteSend(root, { role: 'ghost', message: 'hi' }, async () => {
    execCount += 1;
    return { stdout: '', stderr: '' };
  });
  assert.equal(refused.success, false);
  assert.equal(execCount, 0);
  assert.equal(countAgentNoteDrafts(root), 0);

  const send = await decideAgentNoteSend(
    mkTargetWithRoles(['specifier']),
    { role: 'specifier', message: 'use staging' },
    async () => ({ stdout: '', stderr: '' })
  );
  assert.equal(send.success, true);
  assert.ok(send.message.startsWith(AGENT_NOTE_OPERATOR_PREFIX));
});
