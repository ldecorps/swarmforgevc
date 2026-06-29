const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MessageBus } = require('../out/orchestrator/MessageBus');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bus-'));
}

test('MessageBus write creates a message file atomically', () => {
  const dir = mkTmp();
  const bus = new MessageBus(dir);
  bus.write({ from: 'specifier', to: 'coder', subject: 'task', body: 'do the thing', status: 'pending' });
  const files = fs.readdirSync(path.join(dir, '.swarmforge', 'messages'));
  assert.equal(files.length, 1);
});

test('MessageBus readFor returns messages addressed to recipient', () => {
  const dir = mkTmp();
  const bus = new MessageBus(dir);
  bus.write({ from: 'specifier', to: 'coder', subject: 'task', body: 'do the thing', status: 'pending' });
  bus.write({ from: 'coder', to: 'cleaner', subject: 'handoff', body: 'clean this', status: 'pending' });
  const msgs = bus.readFor('coder');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].subject, 'task');
});

test('MessageBus readFor returns empty array when no messages', () => {
  const dir = mkTmp();
  const bus = new MessageBus(dir);
  assert.deepEqual(bus.readFor('coder'), []);
});

test('MessageBus ack updates message status to done', () => {
  const dir = mkTmp();
  const bus = new MessageBus(dir);
  bus.write({ from: 'a', to: 'b', subject: 's', body: 'x', status: 'pending' });
  const [msg] = bus.readFor('b');
  bus.ack(msg.id);
  const updated = bus.readFor('b');
  assert.equal(updated.length, 0);
});

test('MessageBus written message is readable by another MessageBus instance', () => {
  const dir = mkTmp();
  const writer = new MessageBus(dir);
  writer.write({ from: 'a', to: 'b', subject: 's', body: 'hello', status: 'pending' });
  const reader = new MessageBus(dir);
  const msgs = reader.readFor('b');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body, 'hello');
});
