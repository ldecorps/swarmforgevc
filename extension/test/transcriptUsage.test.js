const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseTranscriptLines, projectSlug, readTranscriptUsage } = require('../out/metrics/transcriptUsage');

// BL-100 cost-01: parseTranscriptLines is a pure function over provided
// JSONL lines (fake transcripts in tests, per the ticket's own
// non-behavioral gate); readTranscriptUsage is the thin fs adapter.

function assistantLine(overrides = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-09T11:38:10.165Z',
    message: {
      id: 'msg_1',
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
      ...overrides.message,
    },
    ...overrides.top,
  });
}

test('parseTranscriptLines extracts usage from an assistant line', () => {
  const records = parseTranscriptLines([assistantLine()]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    messageId: 'msg_1',
    timestampMs: Date.parse('2026-07-09T11:38:10.165Z'),
    model: 'claude-sonnet-5',
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
  });
});

test('parseTranscriptLines dedups repeated lines sharing the same message.id (one API response split across content-block lines)', () => {
  const lines = [assistantLine(), assistantLine(), assistantLine()];
  const records = parseTranscriptLines(lines);
  assert.equal(records.length, 1, 'must count each unique message.id once, not once per content-block line');
});

test('parseTranscriptLines keeps distinct message ids separate', () => {
  const lines = [
    assistantLine({ message: { id: 'msg_1' } }),
    assistantLine({ message: { id: 'msg_2' } }),
  ];
  const records = parseTranscriptLines(lines);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.messageId).sort(), ['msg_1', 'msg_2']);
});

test('parseTranscriptLines ignores non-assistant line types (user, system, custom-title, etc.)', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-07-09T11:38:10.165Z' }),
    JSON.stringify({ type: 'system' }),
    JSON.stringify({ type: 'custom-title', title: 'x' }),
  ];
  assert.deepEqual(parseTranscriptLines(lines), []);
});

test('parseTranscriptLines skips malformed JSON lines without throwing', () => {
  assert.doesNotThrow(() => parseTranscriptLines(['not json', '{"unterminated', assistantLine()]));
  assert.equal(parseTranscriptLines(['not json', assistantLine()]).length, 1);
});

test('parseTranscriptLines skips blank lines', () => {
  assert.deepEqual(parseTranscriptLines(['', '   ', '\n']), []);
});

test('parseTranscriptLines skips an assistant line missing usage or message.id', () => {
  const lines = [
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-09T11:38:10.165Z', message: { id: 'msg_1' } }), // no usage
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-09T11:38:10.165Z',
      message: { usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }), // no id
  ];
  assert.deepEqual(parseTranscriptLines(lines), []);
});

test('parseTranscriptLines treats missing token fields as zero rather than NaN', () => {
  const records = parseTranscriptLines([
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-09T11:38:10.165Z',
      message: { id: 'msg_1', model: 'claude-sonnet-5', usage: { input_tokens: 5 } },
    }),
  ]);
  assert.deepEqual(records[0].usage, { inputTokens: 5, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
});

test('parseTranscriptLines defaults an unknown model to "unknown" rather than throwing', () => {
  const records = parseTranscriptLines([
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-09T11:38:10.165Z',
      message: { id: 'msg_1', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }),
  ]);
  assert.equal(records[0].model, 'unknown');
});

// ── projectSlug ──────────────────────────────────────────────────────────

test('projectSlug replaces path separators and dots with dashes, matching the real ~/.claude/projects/ convention', () => {
  assert.equal(
    projectSlug('/home/carillon/swarmforgevc/.worktrees/coder'),
    '-home-carillon-swarmforgevc--worktrees-coder'
  );
});

// ── readTranscriptUsage (thin fs adapter) ───────────────────────────────

test('readTranscriptUsage reads and concatenates every .jsonl file under the worktree\'s slug directory', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-claude-projects-'));
  const worktreePath = '/fake/worktree/coder';
  const slugDir = path.join(projectsDir, projectSlug(worktreePath));
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'session1.jsonl'), assistantLine({ message: { id: 'a' } }) + '\n');
  fs.writeFileSync(path.join(slugDir, 'session2.jsonl'), assistantLine({ message: { id: 'b' } }) + '\n');
  fs.writeFileSync(path.join(slugDir, 'not-a-transcript.txt'), 'ignore me');

  const records = readTranscriptUsage(worktreePath, projectsDir);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.messageId).sort(), ['a', 'b']);
});

test('readTranscriptUsage returns an empty array when the role never ran here (no slug directory)', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-claude-projects-'));
  assert.deepEqual(readTranscriptUsage('/never/ran/here', projectsDir), []);
});
