const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  backfillStandingTopicIcons,
  formatBackfillStandingSummary,
  main,
} = require('../out/tools/backfill-standing-topic-icons');
const { readSwarmIconId } = require('../out/concierge/blTopicStore');
const { readTickState } = require('../out/tools/telegram-front-desk-bot');

// BL-418: the standing-topic sibling of backfill-topic-icons.ts's own test
// (BL-342 scenario 07) - a bulk, human-initiated seed for the Operator
// topic and every open support subject's topic, always eligible regardless
// of any existing ownership marker (mirrors BL-342's own backfill posture
// exactly), that ALSO seeds the live tick's own standingIconSeenIds so it
// never re-touches what this backfill just set.

function mkTmp() {
  return mkTmpDir('sfvc-backfill-standing-icons-');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// A real git repo (mirrors backfillTopicIconsCli.test.js's own mkGitRepo) -
// blTopicStore's recordSwarmIconId commits every write, so a non-repo
// fixture would report (harmless, but noisy) commit failures to stderr on
// every test here.
function mkGitRepo() {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return target;
}

function writeTopicMap(targetPath, map) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-topic-map.json'), JSON.stringify(map));
}

const STICKERS_JSON = {
  ok: true,
  result: [
    { emoji: '🎟', custom_emoji_id: 'id-ticket' },
    { emoji: '🏛', custom_emoji_id: 'id-opera-house' },
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

test('backfillStandingTopicIcons sets the Operator topic to the opera house and every support subject to the box office', async () => {
  const target = mkGitRepo();
  writeTopicMap(target, {
    701: 'OPERATOR',
    801: 'SUP-001',
    802: 'SUP-002',
    __default__: 'SUP-003',
  });

  const edits = [];
  const outcomes = await backfillStandingTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn(edits));

  assert.deepEqual(
    outcomes.map((o) => o.outcome).sort(),
    ['updated', 'updated', 'updated']
  );
  assert.equal(readSwarmIconId(target, 'OPERATOR'), 'id-opera-house');
  assert.equal(readSwarmIconId(target, 'SUP-001'), 'id-ticket');
  assert.equal(readSwarmIconId(target, 'SUP-002'), 'id-ticket');
  // SUP-003's only binding is __default__ (a DM/General origin, no real
  // Telegram topic) - never a target, exactly like the DEFAULT_SUBJECT_KEY
  // exclusion the live tick's own standingTopicTargets applies.
  assert.equal(readSwarmIconId(target, 'SUP-003'), undefined);
  assert.deepEqual(edits.map((e) => e.icon_custom_emoji_id).sort(), ['id-opera-house', 'id-ticket', 'id-ticket']);
});

test('backfillStandingTopicIcons overrides an existing ownership marker - the backfill is always-eligible, unlike the live tick', async () => {
  const target = mkGitRepo();
  writeTopicMap(target, { 701: 'OPERATOR' });
  const { recordSwarmIconId } = require('../out/concierge/blTopicStore');
  recordSwarmIconId(target, 'OPERATOR', 'some-stale-id');

  const edits = [];
  const outcomes = await backfillStandingTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn(edits));

  assert.deepEqual(outcomes, [{ id: 'OPERATOR', outcome: 'updated' }]);
  assert.equal(readSwarmIconId(target, 'OPERATOR'), 'id-opera-house');
});

test('backfillStandingTopicIcons seeds standingIconSeenIds so the live tick never re-treats these as newly entered', async () => {
  const target = mkGitRepo();
  writeTopicMap(target, { 701: 'OPERATOR', 801: 'SUP-001' });

  await backfillStandingTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  const state = readTickState(target);
  assert.deepEqual([...state.standingIconSeenIds].sort(), ['OPERATOR', 'SUP-001']);
});

test('backfillStandingTopicIcons merges into an EXISTING standingIconSeenIds set rather than clobbering it', async () => {
  const target = mkGitRepo();
  writeTopicMap(target, { 801: 'SUP-002' });
  const { writeTickState } = require('../out/tools/telegram-front-desk-bot');
  writeTickState(target, { snapshot: null, emittedKeys: [], standingIconSeenIds: ['SUP-001'] });

  await backfillStandingTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  const state = readTickState(target);
  assert.deepEqual([...state.standingIconSeenIds].sort(), ['SUP-001', 'SUP-002']);
});

test('backfillStandingTopicIcons is a clean no-op when no standing topics exist yet', async () => {
  const target = mkGitRepo();
  writeTopicMap(target, {});

  const outcomes = await backfillStandingTopicIcons(target, TOKEN, CHAT_ID, async () => {}, fakePostFn([]));

  assert.deepEqual(outcomes, []);
});

// ── formatBackfillStandingSummary / main() thin-wrapper ─────────────────

test('formatBackfillStandingSummary reports the updated count out of the total', () => {
  assert.equal(
    formatBackfillStandingSummary([
      { id: 'OPERATOR', outcome: 'updated' },
      { id: 'SUP-001', outcome: 'updated' },
      { id: 'SUP-002', outcome: 'skipped-unresolved-icon' },
    ]),
    'BACKFILLED 2/3 standing topic(s) (1 not updated - see detail)'
  );
});

test('formatBackfillStandingSummary omits the parenthetical when every topic updated', () => {
  assert.equal(formatBackfillStandingSummary([{ id: 'OPERATOR', outcome: 'updated' }]), 'BACKFILLED 1/1 standing topic(s)');
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
    process.argv = ['node', 'backfill-standing-topic-icons.js'];
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
  const CLI = path.join(__dirname, '..', 'out', 'tools', 'backfill-standing-topic-icons.js');
  assert.throws(() => execFileSync('node', [CLI], { encoding: 'utf8' }));
});
