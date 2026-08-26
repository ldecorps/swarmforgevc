const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  topicLabelForId,
  formatAgoLabel,
  collectUnreadFromRecord,
  buildCatchUpQueue,
  buildCatchUpState,
  computeCatchUpStateLive,
} = require('../out/bridge/catchUpLive');
const { withMessageMarkedRead } = require('../out/bridge/catchUpReadState');

const NOW = 1_700_000_000_000;

function mkTmp() {
  return mkTmpDir('sfvc-catch-up-live-');
}

function writeTopicRecord(targetPath, id, messages) {
  const dir = path.join(targetPath, 'backlog', 'topics');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, messages }));
}

test('topicLabelForId maps standing subjects and BL tickets', () => {
  assert.equal(topicLabelForId('AGENT_QUESTIONS'), 'Agent Questions');
  assert.equal(topicLabelForId('BL-528'), 'BL-528');
  assert.equal(topicLabelForId('swarmforge-console'), 'Swarmforge Console');
});

test('formatAgoLabel buckets elapsed time for glanceable display', () => {
  assert.equal(formatAgoLabel(NOW - 30_000, NOW), 'just now');
  assert.equal(formatAgoLabel(NOW - 5 * 60_000, NOW), '5m ago');
  assert.equal(formatAgoLabel(NOW - 2 * 60 * 60_000, NOW), '2h ago');
  assert.equal(formatAgoLabel(NOW - 2 * 24 * 60 * 60_000, NOW), '2d ago');
  assert.equal(formatAgoLabel(NOW - 4 * 24 * 60 * 60_000, NOW), '3d+ ago');
});

test('collectUnreadFromRecord includes only outbound messages not yet marked read', () => {
  const record = {
    id: 'BL-100',
    messages: [
      { seq: 0, ts: NOW - 1000, author: 'human', type: 'inbound', text: 'hi' },
      { seq: 1, ts: NOW - 500, author: 'swarm', type: 'outbound', text: 'hello' },
      { seq: 2, ts: NOW, author: 'QA', type: 'outbound', text: 'approved' },
    ],
  };
  const empty = collectUnreadFromRecord(record, { readKeys: [] }, NOW);
  assert.equal(empty.length, 2);
  assert.deepEqual(empty.map((m) => m.seq), [1, 2]);

  const partial = collectUnreadFromRecord(record, withMessageMarkedRead({ readKeys: [] }, 'BL-100', 1), NOW);
  assert.deepEqual(partial.map((m) => m.seq), [2]);
});

test('buildCatchUpQueue orders unread messages oldest-first across topics', () => {
  const records = [
    {
      id: 'BL-200',
      messages: [{ seq: 0, ts: NOW - 2000, author: 'swarm', type: 'outbound', text: 'older' }],
    },
    {
      id: 'BL-201',
      messages: [{ seq: 0, ts: NOW - 1000, author: 'swarm', type: 'outbound', text: 'newer' }],
    },
  ];
  const queue = buildCatchUpQueue(records, { readKeys: [] }, NOW);
  assert.deepEqual(queue.map((m) => m.text), ['older', 'newer']);
  assert.equal(queue[1].topicLabel, 'BL-201');
  assert.equal(queue[1].agoLabel, 'just now');
});

test('computeCatchUpStateLive reads topic records from disk', () => {
  const root = mkTmp();
  writeTopicRecord(root, 'BL-300', [
    { seq: 0, ts: NOW - 60_000, author: 'swarm', type: 'outbound', text: 'needs eyes' },
  ]);
  const state = computeCatchUpStateLive(root, { readKeys: [] }, NOW);
  assert.equal(state.total, 1);
  assert.equal(state.items[0].author, 'swarm');
  assert.equal(state.items[0].text, 'needs eyes');
});

test('buildCatchUpState returns empty when everything is already read', () => {
  const records = [
    {
      id: 'BL-400',
      messages: [{ seq: 0, ts: NOW, author: 'swarm', type: 'outbound', text: 'done' }],
    },
  ];
  const readState = withMessageMarkedRead({ readKeys: [] }, 'BL-400', 0);
  assert.deepEqual(buildCatchUpState(records, readState, NOW), { items: [], total: 0 });
});
