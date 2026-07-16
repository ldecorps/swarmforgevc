const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { backfillEpicTopicIcons, formatBackfillEpicSummary, main } = require('../out/tools/backfill-epic-topic-icons');
const { readSwarmIconId } = require('../out/concierge/blTopicStore');
const { readBacklogTopicMap } = require('../out/concierge/backlogTopicMapStore');
const { decideEpicTopicAction } = require('../out/concierge/topicRouter');

// BL-449: the one-time backfill for the three pre-existing, hand-created
// epic topics (147 Swarm Role Benchmarking, 149 Dynamic Routing, 151
// Onboarding a New Target Repo) - mirrors backfill-topic-icons.ts/
// backfill-standing-topic-icons.ts's own always-eligible, one-time
// maintenance-pass shape (BL-342/BL-418).

function mkTmp() {
  return mkTmpDir('sfvc-backfill-epic-icons-');
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

function writeEpicTopicMap(targetPath, map) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'epic-topic-map.json'), JSON.stringify(map));
}

const STICKERS_JSON = {
  ok: true,
  result: [
    { emoji: '🎙', custom_emoji_id: 'id-mic' },
    { emoji: '🎭', custom_emoji_id: 'id-masks' },
    { emoji: '🎬', custom_emoji_id: 'id-clapper' },
    { emoji: '🎤', custom_emoji_id: 'id-mic2' },
  ],
};

const TOKEN = '123:test-token';
const CHAT_ID = '999';

function fakePostFn(edits) {
  return async (url, body) => {
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: STICKERS_JSON };
    }
    edits.push(JSON.parse(body));
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
}

test('backfillEpicTopicIcons sets the finalised icon for each of the three seeded epics', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, { 'role-benchmarking': 147, 'dynamic-routing': 149, 'onboarding-target-repo': 151 });

  const edits = [];
  const outcomes = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn(edits));

  assert.deepEqual(
    outcomes.map((o) => o.outcome).sort(),
    ['updated', 'updated', 'updated']
  );
  assert.equal(readSwarmIconId(target, 'role-benchmarking'), 'id-mic');
  assert.equal(readSwarmIconId(target, 'dynamic-routing'), 'id-masks');
  assert.equal(readSwarmIconId(target, 'onboarding-target-repo'), 'id-clapper');
  assert.deepEqual(edits.map((e) => e.icon_custom_emoji_id).sort(), ['id-clapper', 'id-masks', 'id-mic']);
});

test('backfillEpicTopicIcons overrides an existing ownership marker - always eligible, unlike the live tick', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, { 'role-benchmarking': 147 });
  const { recordSwarmIconId } = require('../out/concierge/blTopicStore');
  recordSwarmIconId(target, 'role-benchmarking', 'some-stale-trophy-id');

  const outcomes = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  assert.deepEqual(outcomes, [{ epicId: 'role-benchmarking', outcome: 'updated' }]);
  assert.equal(readSwarmIconId(target, 'role-benchmarking'), 'id-mic');
});

// The mechanism this backfill uses to stop the live tick from re-treating a
// backfilled epic as newly-entered: seeding backlog-topic-map.json (the
// SAME map decideEpicTopicAction's own create-vs-reuse check reads) rather
// than a second, bespoke seen-set.
test('backfillEpicTopicIcons seeds backlog-topic-map.json so the live tick reuses, never re-creates, a backfilled epic topic', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, { 'role-benchmarking': 147, 'dynamic-routing': 149 });

  await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  const topicMap = readBacklogTopicMap(target);
  assert.equal(topicMap['role-benchmarking'], 147);
  assert.equal(topicMap['dynamic-routing'], 149);

  const action = decideEpicTopicAction('role-benchmarking', 'Swarm Role Benchmarking', topicMap, 'Epic: Swarm Role Benchmarking');
  assert.equal(action.kind, 'reuse', 'expected the live routing decision to REUSE the backfilled topic, never create a duplicate');
  assert.equal(action.topicId, 147);
});

test('backfillEpicTopicIcons never clobbers an already-mapped epic topic id in backlog-topic-map.json', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, { 'role-benchmarking': 147 });
  const { writeBacklogTopicMap } = require('../out/concierge/backlogTopicMapStore');
  writeBacklogTopicMap(target, { 'role-benchmarking': 999, 'BL-1': 42 });

  await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  const topicMap = readBacklogTopicMap(target);
  assert.equal(topicMap['role-benchmarking'], 999, 'expected the pre-existing mapping to win, never overwritten by the backfill input');
  assert.equal(topicMap['BL-1'], 42, 'expected an unrelated existing mapping to survive untouched');
});

test('backfillEpicTopicIcons is a clean no-op when the epic-topic-map file is empty', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, {});

  const outcomes = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  assert.deepEqual(outcomes, []);
});

// ── engineering "wiring test that adds a NEW on-disk input" rule: place the
//    fixture with real content, then break-then-fix it ────────────────────

test('backfillEpicTopicIcons: the epic-topic-map.json read is load-bearing - blanking it drops every outcome, restoring it recovers them', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, { 'role-benchmarking': 147, 'dynamic-routing': 149 });

  const withMap = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));
  assert.equal(withMap.length, 2, 'expected the real fixture content to drive two outcomes');

  // Break: blank the fixture file the wiring reads.
  writeEpicTopicMap(target, {});
  const withBlankedMap = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));
  assert.deepEqual(withBlankedMap, [], 'expected the blanked map to produce no outcomes - proves the read is load-bearing, not a default fallback masking a broken read');

  // Fix: restore it.
  writeEpicTopicMap(target, { 'role-benchmarking': 147, 'dynamic-routing': 149 });
  const restored = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));
  assert.equal(restored.length, 2, 'expected restoring the fixture to recover both outcomes');
});

// ── pool assignment for an epic beyond the finalised three ────────────────

test('backfillEpicTopicIcons assigns pool icons distinctly across multiple epics in one run, seeded epics keep their fixed glyphs', async () => {
  const target = mkGitRepo();
  writeEpicTopicMap(target, { 'role-benchmarking': 147, 'dynamic-routing': 149, 'onboarding-target-repo': 151, 'fleet-second-swarm': 160 });

  const edits = [];
  const outcomes = await backfillEpicTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn(edits));

  assert.deepEqual(
    outcomes.map((o) => o.outcome).sort(),
    ['updated', 'updated', 'updated', 'updated']
  );
  assert.equal(readSwarmIconId(target, 'fleet-second-swarm'), 'id-mic2', 'expected the 4th, unseeded epic to get the next distinct pool icon (🎤), never collide with the seeded three');
});

// ── formatBackfillEpicSummary / main() thin-wrapper ────────────────────────

test('formatBackfillEpicSummary reports the updated count out of the total', () => {
  assert.equal(
    formatBackfillEpicSummary([
      { epicId: 'role-benchmarking', outcome: 'updated' },
      { epicId: 'dynamic-routing', outcome: 'updated' },
      { epicId: 'onboarding-target-repo', outcome: 'skipped-unresolved-icon' },
    ]),
    'BACKFILLED 2/3 epic topic(s) (1 not updated - see detail)'
  );
});

test('formatBackfillEpicSummary omits the parenthetical when every topic updated', () => {
  assert.equal(formatBackfillEpicSummary([{ epicId: 'role-benchmarking', outcome: 'updated' }]), 'BACKFILLED 1/1 epic topic(s)');
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
    process.argv = ['node', 'backfill-epic-topic-icons.js'];
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
  const CLI = path.join(__dirname, '..', 'out', 'tools', 'backfill-epic-topic-icons.js');
  assert.throws(() => execFileSync('node', [CLI], { encoding: 'utf8' }));
});
