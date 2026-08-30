const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  classifyTopicThread,
  mayWriteTrackedTopicRecord,
  readSupervisorSwarmIconId,
  recordSupervisorSwarmIconId,
  readUnboundSwarmIconId,
  recordUnboundSwarmIconId,
  isStorableTopicId,
  reportMarkerRefusedToStderr,
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

// BL-1210 hardening: a malformed-but-parseable store (a JSON array, not an
// object) must fall back to an empty MAP, not be treated as-is. A read-only
// assertion cannot discriminate this - `[]['SUP-1']` and `{}['SUP-1']` both
// read back `undefined` - so this drives the fallback through a WRITE:
// setting a property on an array literal is legal JS but JSON.stringify
// silently drops it (`JSON.stringify(Object.assign([], {x:1}))` === '[]'),
// so a recovered write on top of an unrecovered array would vanish on disk.
test('a malformed (array) icon store recovers to an empty map, not the array, so a write on top of it survives', () => {
  const root = mkRoot();
  const file = path.join(root, '.swarmforge', 'topic-icons.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '[]');
  recordUnboundSwarmIconId(root, 'role-benchmarking', '🎯');
  assert.equal(readUnboundSwarmIconId(root, 'role-benchmarking'), '🎯');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Array.isArray(onDisk), false, 'the recovered store must be an object, not the malformed array');
  assert.equal(onDisk['role-benchmarking'], '🎯');
});

// A bare JSON primitive (not an array, not an object) hits the same
// fallback from a different direction - `typeof parsed === 'object'` is
// false for a string, so this exercises that half of the guard rather than
// the `!Array.isArray` half above.
test('a malformed (primitive) icon store also recovers to an empty map', () => {
  const root = mkRoot();
  const file = path.join(root, '.swarmforge', 'supervisor-topic-icons.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '"not an object"');
  recordSupervisorSwarmIconId(root, 'SUP-9', '🛰️');
  assert.equal(readSupervisorSwarmIconId(root, 'SUP-9'), '🛰️');
});

// BL-1210: isStorableTopicId's `typeof` guard is defensive - every TYPED
// caller already passes a string - so only a call that bypasses the type
// system exercises it. Kept real rather than deleted: a value arriving from
// JSON or an untyped caller is exactly the case this guard exists for.
test('isStorableTopicId refuses a non-string id, not just a blank one', () => {
  assert.equal(isStorableTopicId(undefined), false);
  assert.equal(isStorableTopicId(null), false);
  assert.equal(isStorableTopicId(42), false);
  assert.equal(isStorableTopicId(''), false);
  assert.equal(isStorableTopicId('   '), false);
  assert.equal(isStorableTopicId('BL-1'), true);
});

// BL-1210: reportMarkerRefusedToStderr is a DIFFERENT event from BL-695's
// reportUnboundThreadToStderr (constants and wording proposed in the
// coder's own comment) - assert its own text, not just that some stderr
// write happened.
test('reportMarkerRefusedToStderr writes the BL-1210 refusal line, not the BL-695 tracked-record line', () => {
  const chunks = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    reportMarkerRefusedToStderr('mystery-id');
  } finally {
    process.stderr.write = original;
  }
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /mystery-id/);
  assert.match(chunks[0], /no store will hold an icon ownership marker/);
  assert.doesNotMatch(chunks[0], /writing no tracked topic record/);
});
