const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { backfillTopicIcons, setTopicIconWithRateLimitRetry, formatBackfillSummary, main } = require('../out/tools/backfill-topic-icons');
const { readSwarmIconId } = require('../out/concierge/blTopicStore');

// BL-342 scenario 07: a bulk backfill that is rate-limited still completes
// every topic - the Operator's own hand pass hit "Too Many Requests: retry
// after 26" after 19 of 26 calls and silently dropped the remaining 7.

function mkTmp() {
  return mkTmpDir('sfvc-backfill-icons-');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkGitRepo() {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return target;
}

function writeTicket(targetPath, folder, id, title, type) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: ${title}\ntype: ${type}\n`);
}

function writeTopicMap(targetPath, map) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog-topic-map.json'), JSON.stringify(map));
}

// BL-417: feature-in-flight remapped from the bulb to the musical note.
const STICKERS_JSON = {
  ok: true,
  result: [
    { emoji: '✅', custom_emoji_id: 'id-check' },
    { emoji: '🦠', custom_emoji_id: 'id-microbe' },
    { emoji: '🎵', custom_emoji_id: 'id-note' },
    { emoji: '🔍', custom_emoji_id: 'id-magnifier' },
  ],
};

const TOKEN = '123:test-token';
const CHAT_ID = '999';

test('backfillTopicIcons sets the computed icon for every non-epic ticket that has a topic', async () => {
  const target = mkGitRepo();
  writeTicket(target, 'active', 'BL-1', 'a feature', 'feature');
  writeTicket(target, 'active', 'BL-2', 'a bug', 'bug');
  writeTicket(target, 'paused', 'BL-3', 'a paused one', 'feature');
  writeTicket(target, 'done', 'BL-4', 'a shipped one', 'bug');
  writeTopicMap(target, { 'BL-1': 101, 'BL-2': 102, 'BL-3': 103, 'BL-4': 104 });

  const edits = [];
  const postFn = async (url, body) => {
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: STICKERS_JSON };
    }
    edits.push(JSON.parse(body));
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const outcomes = await backfillTopicIcons(target, TOKEN, CHAT_ID, async () => {}, postFn);

  assert.deepEqual(
    outcomes.map((o) => o.outcome),
    ['updated', 'updated', 'updated', 'updated']
  );
  assert.deepEqual(
    edits.map((e) => e.icon_custom_emoji_id).sort(),
    ['id-check', 'id-magnifier', 'id-microbe', 'id-note']
  );
  assert.equal(readSwarmIconId(target, 'BL-1'), 'id-note');
  assert.equal(readSwarmIconId(target, 'BL-4'), 'id-check');
});

test('backfillTopicIcons skips an epic-defining ticket entirely, even if it has a topic', async () => {
  const target = mkGitRepo();
  writeTicket(target, 'active', 'BL-500', 'EPIC — some initiative', 'epic');
  writeTopicMap(target, { 'BL-500': 500 });

  const edits = [];
  const postFn = async (url, body) => {
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: STICKERS_JSON };
    }
    edits.push(JSON.parse(body));
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const outcomes = await backfillTopicIcons(target, TOKEN, CHAT_ID, async () => {}, postFn);

  assert.deepEqual(outcomes, []);
  assert.deepEqual(edits, []);
});

test('backfillTopicIcons skips a ticket with no topic at all, without failing the whole run', async () => {
  const target = mkGitRepo();
  writeTicket(target, 'active', 'BL-1', 'no topic yet', 'feature');
  writeTopicMap(target, {});

  const postFn = async (url) => {
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: STICKERS_JSON };
    }
    throw new Error('should never call editForumTopic for a ticket with no topic');
  };

  const outcomes = await backfillTopicIcons(target, TOKEN, CHAT_ID, async () => {}, postFn);

  assert.deepEqual(outcomes, []);
});

// ── BL-342 scenario 07: rate-limit handling, the ticket's own live repro ──

test('setTopicIconWithRateLimitRetry waits exactly retry_after seconds and retries the SAME topic on a 429', async () => {
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 26', parameters: { retry_after: 26 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  const waits = [];

  const result = await setTopicIconWithRateLimitRetry(TOKEN, CHAT_ID, 101, 'id-bulb', async (ms) => waits.push(ms), postFn);

  assert.equal(result, true);
  assert.equal(calls, 2, 'expected the rate-limited call to be retried, never dropped');
  assert.deepEqual(waits, [26000], 'expected the wait to be EXACTLY retry_after seconds, in ms, never a generic guess');
});

test('setTopicIconWithRateLimitRetry keeps retrying through MULTIPLE consecutive rate-limit responses until it succeeds', async () => {
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    if (calls <= 3) {
      return { ok: false, status: 429, json: { ok: false, description: 'retry after 5', parameters: { retry_after: 5 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  const waits = [];

  const result = await setTopicIconWithRateLimitRetry(TOKEN, CHAT_ID, 101, 'id-bulb', async (ms) => waits.push(ms), postFn);

  assert.equal(result, true);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [5000, 5000, 5000]);
});

test('setTopicIconWithRateLimitRetry does NOT retry a genuine (non-429) failure - returns false immediately', async () => {
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    return { ok: false, status: 400, json: { ok: false, description: 'topic not found' } };
  };
  const waits = [];

  const result = await setTopicIconWithRateLimitRetry(TOKEN, CHAT_ID, 101, 'id-bulb', async (ms) => waits.push(ms), postFn);

  assert.equal(result, false);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

// The ticket's own live repro, at realistic scale: 26 topics, the 20th
// call rate-limited (matching "hit the limit AFTER 19 calls") - every
// topic must still end up updated, none silently dropped.
test('backfillTopicIcons completes ALL topics even when the rate limit is hit partway through a large batch', async () => {
  const target = mkGitRepo();
  const topicMap = {};
  for (let i = 1; i <= 26; i++) {
    const id = `BL-${i}`;
    writeTicket(target, 'active', id, `ticket ${i}`, 'feature');
    topicMap[id] = 100 + i;
  }
  writeTopicMap(target, topicMap);

  let editCalls = 0;
  const waits = [];
  const postFn = async (url) => {
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: STICKERS_JSON };
    }
    editCalls += 1;
    if (editCalls === 20) {
      return { ok: false, status: 429, json: { ok: false, description: 'retry after 26', parameters: { retry_after: 26 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const outcomes = await backfillTopicIcons(target, TOKEN, CHAT_ID, async (ms) => waits.push(ms), postFn);

  assert.equal(outcomes.length, 26, 'expected every one of the 26 topics to be processed');
  assert.ok(
    outcomes.every((o) => o.outcome === 'updated'),
    `expected every topic to end up updated, none silently dropped, got: ${JSON.stringify(outcomes)}`
  );
  assert.deepEqual(waits, [26000], 'expected exactly one rate-limit wait, honouring the server-told duration');
});

// ── formatBackfillSummary / main() thin-wrapper (CLI main()-thin-wrapper
//    rule: called in-process, not only reachable via a subprocess) ────────

test('formatBackfillSummary reports the updated count out of the total', () => {
  assert.equal(
    formatBackfillSummary([
      { backlogId: 'BL-1', outcome: 'updated' },
      { backlogId: 'BL-2', outcome: 'updated' },
      { backlogId: 'BL-3', outcome: 'skipped-unresolved-icon' },
    ]),
    'BACKFILLED 2/3 topic(s) (1 not updated - see detail)'
  );
});

test('formatBackfillSummary omits the parenthetical when every topic updated', () => {
  assert.equal(formatBackfillSummary([{ backlogId: 'BL-1', outcome: 'updated' }]), 'BACKFILLED 1/1 topic(s)');
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
    process.argv = ['node', 'backfill-topic-icons.js'];
    await main();
    assert.equal(process.exitCode, 1);
    assert.ok(errors.some((e) => e.includes('Usage:')));
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    process.stderr.write = originalErrorWrite;
  }
});

test('the compiled CLI runs standalone as a subprocess and reports a missing target path', () => {
  const CLI = path.join(__dirname, '..', 'out', 'tools', 'backfill-topic-icons.js');
  assert.throws(() => execFileSync('node', [CLI], { encoding: 'utf8' }));
});
