'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readLog } = require('../out/swarm/messageBus');
const { logHumanInput, isHumanInputMessage } = require('../out/swarm/humanInput');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-human-'));
}

// ── logHumanInput ──────────────────────────────────────────────────────────

test('logHumanInput creates a message file with from: human', () => {
  const dir = mkTmp();
  const id = logHumanInput(dir, 'cleaner', 'please refactor this', 1);
  const logPath = path.join(dir, `${id}.log`);
  assert.ok(fs.existsSync(logPath));
  const events = readLog(logPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'created');
  assert.equal(events[0].from, 'human');
  assert.equal(events[0].to, 'cleaner');
  assert.equal(events[0].subject, 'human-input');
  assert.equal(events[0].body, 'please refactor this');
});

test('logHumanInput returns a stable id matching the log filename', () => {
  const dir = mkTmp();
  const id = logHumanInput(dir, 'coder', 'nudge', 2);
  assert.ok(fs.existsSync(path.join(dir, `${id}.log`)));
});

// ── isHumanInputMessage ────────────────────────────────────────────────────

test('isHumanInputMessage returns true for human-input messages', () => {
  const dir = mkTmp();
  const id = logHumanInput(dir, 'coder', 'nudge', 1);
  const logPath = path.join(dir, `${id}.log`);
  assert.ok(isHumanInputMessage(logPath));
});

test('isHumanInputMessage returns false for agent-to-agent messages', () => {
  const { createMessage } = require('../out/swarm/messageBus');
  const dir = mkTmp();
  const id = createMessage(dir, { from: 'coder', to: 'cleaner', subject: 'work', body: 'do it', seq: 1 });
  const logPath = path.join(dir, `${id}.log`);
  assert.equal(isHumanInputMessage(logPath), false);
});

test('isHumanInputMessage returns false for non-existent log', () => {
  assert.equal(isHumanInputMessage('/nonexistent/path.log'), false);
});

// ── human-input messages are not chased ───────────────────────────────────

test('human-input messages have subject human-input (used by chase monitor to skip)', () => {
  const dir = mkTmp();
  const id = logHumanInput(dir, 'coder', 'some instruction', 1);
  const events = readLog(path.join(dir, `${id}.log`));
  assert.equal(events[0].subject, 'human-input');
});
