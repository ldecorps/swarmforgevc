const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  classifyTopicThread,
  mayWriteTrackedTopicRecord,
  readSupervisorSwarmIconId,
  recordSupervisorSwarmIconId,
  retireTrackedSupervisorRecords,
} = require('../out/concierge/topicThreadKind');
const {
  appendMessage,
  readRecord,
  recordPath,
  readSwarmIconId,
  recordSwarmIconId,
} = require('../out/concierge/blTopicStore');

function mkRoot() {
  return mkTmpDir('bl695-');
}

test('classify: BL/GH are tickets; SUP is supervisor; other is unbound', () => {
  assert.equal(classifyTopicThread('BL-695'), 'ticket');
  assert.equal(classifyTopicThread('GH-12'), 'ticket');
  assert.equal(classifyTopicThread('SUP-12'), 'supervisor');
  assert.equal(classifyTopicThread('mystery'), 'unbound');
  assert.equal(mayWriteTrackedTopicRecord('BL-695'), true);
  assert.equal(mayWriteTrackedTopicRecord('SUP-12'), false);
});

test('appendMessage never writes a tracked record for SUP', () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'backlog', 'topics'), { recursive: true });
  const entry = appendMessage(root, 'SUP-12', { author: 'human', type: 'inbound', text: 'hi' });
  assert.equal(entry, undefined);
  assert.equal(fs.existsSync(recordPath(root, 'SUP-12')), false);
});

test('appendMessage still records a ticket topic', () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'backlog', 'topics'), { recursive: true });
  const entry = appendMessage(root, 'BL-695', { author: 'swarm', type: 'outbound', text: 'hello' });
  assert.ok(entry);
  assert.equal(readRecord(root, 'BL-695').messages.length, 1);
  assert.equal(readRecord(root, 'BL-695').messages[0].text, 'hello');
});

test('supervisor icon memory is untracked under .swarmforge', () => {
  const root = mkRoot();
  recordSwarmIconId(root, 'SUP-12', 'icon-1');
  assert.equal(readSwarmIconId(root, 'SUP-12'), 'icon-1');
  assert.equal(fs.existsSync(recordPath(root, 'SUP-12')), false);
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-12'), 'icon-1');
  assert.ok(fs.existsSync(path.join(root, '.swarmforge', 'supervisor-topic-icons.json')));
});

test('unbound thread writes nothing and is reported', () => {
  const root = mkRoot();
  const reports = [];
  appendMessage(root, 'ORPHAN-1', { author: 'human', type: 'inbound', text: 'x' }, () => {}, (id) => reports.push(id));
  assert.deepEqual(reports, ['ORPHAN-1']);
  assert.equal(fs.existsSync(recordPath(root, 'ORPHAN-1')), false);
});

test('retireTrackedSupervisorRecords migrates icons then deletes SUP json', () => {
  const root = mkRoot();
  const topics = path.join(root, 'backlog', 'topics');
  fs.mkdirSync(topics, { recursive: true });
  fs.writeFileSync(path.join(topics, 'SUP-9.json'), JSON.stringify({ id: 'SUP-9', messages: [], swarmIconId: 'abc' }));
  fs.writeFileSync(path.join(topics, 'BL-1.json'), JSON.stringify({ id: 'BL-1', messages: [] }));
  const removed = retireTrackedSupervisorRecords(root, topics);
  assert.equal(removed.length, 1);
  assert.equal(fs.existsSync(path.join(topics, 'SUP-9.json')), false);
  assert.equal(fs.existsSync(path.join(topics, 'BL-1.json')), true);
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-9'), 'abc');
});

test('BL-695 bounce inv2: front-desk main migrates SUP icons before standing topics', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'tools', 'telegram-front-desk-bot.ts'),
    'utf8'
  );
  const mainIdx = src.indexOf('export async function main(): Promise<void>');
  assert.ok(mainIdx !== -1);
  const mainBody = src.slice(mainIdx);
  const migrateAt = mainBody.indexOf('retireTrackedSupervisorRecords(targetPath, topicsDir(targetPath))');
  const operatorAt = mainBody.indexOf('await ensureOperatorTopic(targetPath');
  assert.ok(migrateAt !== -1, 'expected migrate call in main()');
  assert.ok(operatorAt !== -1, 'expected ensureOperatorTopic in main()');
  assert.ok(migrateAt < operatorAt, 'migrate must run before standing Operator topic bind');
});


test('retire ignores non-SUP names with prefix/suffix (regex anchors)', () => {
  const root = mkRoot();
  const topics = path.join(root, 'backlog', 'topics');
  fs.mkdirSync(topics, { recursive: true });
  fs.writeFileSync(path.join(topics, 'xSUP-1.json'), '{}');
  fs.writeFileSync(path.join(topics, 'SUP-1.jsonx'), '{}');
  fs.writeFileSync(path.join(topics, 'SUP-12.json'), JSON.stringify({ swarmIconId: 'z' }));
  const removed = retireTrackedSupervisorRecords(root, topics);
  assert.equal(removed.length, 1);
  assert.equal(fs.existsSync(path.join(topics, 'xSUP-1.json')), true);
  assert.equal(fs.existsSync(path.join(topics, 'SUP-1.jsonx')), true);
  assert.equal(fs.existsSync(path.join(topics, 'SUP-12.json')), false);
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-12'), 'z');
});

test('retire still deletes corrupt SUP json without migrating', () => {
  const root = mkRoot();
  const topics = path.join(root, 'backlog', 'topics');
  fs.mkdirSync(topics, { recursive: true });
  fs.writeFileSync(path.join(topics, 'SUP-3.json'), '{not-json');
  const removed = retireTrackedSupervisorRecords(root, topics);
  assert.equal(removed.length, 1);
  assert.equal(fs.existsSync(path.join(topics, 'SUP-3.json')), false);
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-3'), undefined);
});

test('retire skips empty swarmIconId string', () => {
  const root = mkRoot();
  const topics = path.join(root, 'backlog', 'topics');
  fs.mkdirSync(topics, { recursive: true });
  fs.writeFileSync(path.join(topics, 'SUP-4.json'), JSON.stringify({ swarmIconId: '' }));
  retireTrackedSupervisorRecords(root, topics);
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-4'), undefined);
});

test('readSupervisorIconMap ignores array JSON and missing file', () => {
  const root = mkRoot();
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-1'), undefined);
  const file = path.join(root, '.swarmforge', 'supervisor-topic-icons.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '[]');
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-1'), undefined);
});

test('retire returns [] when topics dir missing', () => {
  const root = mkRoot();
  assert.deepEqual(retireTrackedSupervisorRecords(root, path.join(root, 'nope')), []);
});

test('classify case-insensitive ticket and supervisor ids', () => {
  assert.equal(classifyTopicThread('bl-10'), 'ticket');
  assert.equal(classifyTopicThread('gh-10'), 'ticket');
  assert.equal(classifyTopicThread('sup-10'), 'supervisor');
});


test('ticket regex requires full-string BL/GH ids (anchors)', () => {
  assert.equal(classifyTopicThread('xBL-1'), 'unbound');
  assert.equal(classifyTopicThread('BL-1x'), 'unbound');
  assert.equal(classifyTopicThread('xGH-2'), 'unbound');
  assert.equal(classifyTopicThread('GH-2y'), 'unbound');
  assert.equal(mayWriteTrackedTopicRecord('xBL-1'), false);
});

test('supervisor regex requires full-string SUP ids', () => {
  assert.equal(classifyTopicThread('xSUP-1'), 'unbound');
  assert.equal(classifyTopicThread('SUP-1x'), 'unbound');
});

test('retire does not migrate non-string swarmIconId', () => {
  const root = mkRoot();
  const topics = path.join(root, 'backlog', 'topics');
  fs.mkdirSync(topics, { recursive: true });
  fs.writeFileSync(path.join(topics, 'SUP-5.json'), JSON.stringify({ swarmIconId: 99 }));
  retireTrackedSupervisorRecords(root, topics);
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-5'), undefined);
});
