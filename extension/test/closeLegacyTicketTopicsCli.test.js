const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { closeLegacyTicketTopics, closeEachLegacyTopic, formatCloseSummary, main } = require('../out/tools/close-legacy-ticket-topics');
const { readBacklogTopicMap } = require('../out/concierge/backlogTopicMapStore');

// BL-494: a one-time reconcile that closes every legacy per-ticket topic -
// rate-limit safe (reusing telegramClient.ts's closeForumTopicWithRateLimitRetry,
// the SAME mechanism backfill-topic-icons.ts already relies on) and
// idempotent (each closed topic's key is dropped from the map).

function mkTmp() {
  return mkTmpDir('sfvc-close-legacy-topics-');
}

function writeTopicMap(targetPath, map) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog-topic-map.json'), JSON.stringify(map));
}

const TOKEN = '123:test-token';
const CHAT_ID = '999';

test('closeLegacyTicketTopics closes each legacy per-ticket topic and drops its key from the map', async () => {
  const target = mkTmp();
  writeTopicMap(target, { 'BL-1': 101, 'BL-2': 102 });

  const closedIds = [];
  const postFn = async (url, body) => {
    closedIds.push(JSON.parse(body).message_thread_id);
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const outcomes = await closeLegacyTicketTopics(target, TOKEN, CHAT_ID, async () => {}, postFn);

  assert.deepEqual(outcomes, [
    { backlogId: 'BL-1', closed: true },
    { backlogId: 'BL-2', closed: true },
  ]);
  assert.deepEqual(closedIds.sort(), [101, 102]);
  assert.deepEqual(readBacklogTopicMap(target), {}, 'expected every closed key dropped from the map');
});

test('closeLegacyTicketTopics never closes an epic topic or the reserved BACKLOG key', async () => {
  const target = mkTmp();
  writeTopicMap(target, { 'BL-1': 101, 'topic-consolidation': 500, BACKLOG: 600 });

  const closedIds = [];
  const postFn = async (url, body) => {
    closedIds.push(JSON.parse(body).message_thread_id);
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  await closeLegacyTicketTopics(target, TOKEN, CHAT_ID, async () => {}, postFn);

  assert.deepEqual(closedIds, [101]);
  assert.deepEqual(readBacklogTopicMap(target), { 'topic-consolidation': 500, BACKLOG: 600 });
});

test('closeLegacyTicketTopics honors a 429 retry_after before continuing, and still closes/drops every topic', async () => {
  const target = mkTmp();
  writeTopicMap(target, { 'BL-1': 101, 'BL-2': 102 });

  let calls = 0;
  const waits = [];
  const postFn = async (url, body) => {
    const threadId = JSON.parse(body).message_thread_id;
    calls += 1;
    if (threadId === 101 && calls === 1) {
      return { ok: false, status: 429, json: { ok: false, description: 'retry after 26', parameters: { retry_after: 26 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const outcomes = await closeLegacyTicketTopics(target, TOKEN, CHAT_ID, async (ms) => waits.push(ms), postFn);

  assert.deepEqual(waits, [26000], 'expected the wait to be exactly retry_after seconds, in ms');
  assert.deepEqual(
    outcomes.map((o) => o.closed),
    [true, true],
    'expected the rate-limited topic to still succeed after the retry, and no topic silently dropped'
  );
  assert.deepEqual(readBacklogTopicMap(target), {}, 'expected every per-ticket key dropped, none left behind by the 429');
});

test('closeLegacyTicketTopics is idempotent - re-running after every key is already dropped closes nothing and does not error', async () => {
  const target = mkTmp();
  writeTopicMap(target, {});

  const outcomes = await closeLegacyTicketTopics(target, TOKEN, CHAT_ID, async () => {}, async () => {
    throw new Error('should never call the Telegram API when no legacy topic remains');
  });

  assert.deepEqual(outcomes, []);
});

test('closeLegacyTicketTopics leaves a genuinely-failed close undropped, so a re-run picks it up again', async () => {
  const target = mkTmp();
  writeTopicMap(target, { 'BL-1': 101 });

  const outcomes = await closeLegacyTicketTopics(target, TOKEN, CHAT_ID, async () => {}, async () => ({
    ok: false,
    status: 400,
    json: { ok: false, description: 'topic not found' },
  }));

  assert.deepEqual(outcomes, [{ backlogId: 'BL-1', closed: false }]);
  assert.deepEqual(readBacklogTopicMap(target), { 'BL-1': 101 }, 'expected the failed close left in the map for a later re-run');
});

// ── closeEachLegacyTopic (the pure-ish loop, driven directly) ────────────

test('closeEachLegacyTopic calls close for every entry in order and reports each outcome', async () => {
  const calls = [];
  const outcomes = await closeEachLegacyTopic(
    [
      { backlogId: 'BL-1', topicId: 101 },
      { backlogId: 'BL-2', topicId: 102 },
    ],
    async (topicId) => {
      calls.push(topicId);
      return topicId === 101;
    }
  );

  assert.deepEqual(calls, [101, 102]);
  assert.deepEqual(outcomes, [
    { backlogId: 'BL-1', closed: true },
    { backlogId: 'BL-2', closed: false },
  ]);
});

// ── formatCloseSummary / main() thin-wrapper ─────────────────────────────

test('formatCloseSummary reports the closed count out of the total', () => {
  assert.equal(
    formatCloseSummary([
      { backlogId: 'BL-1', closed: true },
      { backlogId: 'BL-2', closed: true },
      { backlogId: 'BL-3', closed: false },
    ]),
    'CLOSED 2/3 legacy per-ticket topic(s) (1 not closed - see detail)'
  );
});

test('formatCloseSummary omits the parenthetical when every topic closed', () => {
  assert.equal(formatCloseSummary([{ backlogId: 'BL-1', closed: true }]), 'CLOSED 1/1 legacy per-ticket topic(s)');
});

test('main() prints usage and exits non-zero with no target path argument', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', 'close-legacy-ticket-topics.js'];
    await main();
    assert.equal(process.exitCode, 1);
    assert.ok(errors.some((e) => e.includes('Usage:')));
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    process.stderr.write = originalErrorWrite;
  }
});

test('main() reads the botToken/chatId env, closes nothing for an empty map, and prints the summary + JSON output', async () => {
  const target = mkTmp();
  writeTopicMap(target, {});
  const originalArgv = process.argv;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalStdoutWrite = process.stdout.write;
  const out = [];
  process.stdout.write = (chunk) => {
    out.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', 'close-legacy-ticket-topics.js', target];
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = CHAT_ID;
    await main();
    assert.ok(out.some((line) => line.includes('CLOSED 0/0')), 'expected the summary line on stdout');
    assert.ok(out.some((line) => line.trim() === '[]'), 'expected the JSON outcomes array on stdout');
  } finally {
    process.argv = originalArgv;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = originalChatId;
    process.stdout.write = originalStdoutWrite;
  }
});

test('the compiled CLI runs standalone as a subprocess and reports a missing target path', () => {
  const CLI = path.join(__dirname, '..', 'out', 'tools', 'close-legacy-ticket-topics.js');
  assert.throws(() => execFileSync('node', [CLI], { encoding: 'utf8' }));
});
