const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { repairBlTopicRecords, main } = require('../out/tools/repair-bl-topic-records');
const { readRecord, recordPath } = require('../out/concierge/blTopicStore');

// BL-348: the CLI cross-references backlog/topics/*.json against
// readBacklogFolders(...).done and repairs exactly the records whose first
// message is already their own completion summary (see
// topicRecordRepair.test.js for the pure detection logic). This file
// covers the filesystem/backlog wiring and the commit.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-repair-bl-topics-'));
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

function writeDoneTicket(targetPath, id, title) {
  const dir = path.join(targetPath, 'backlog', 'done');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: ${title}\nstatus: done\n`);
}

function writeTopicRecord(targetPath, id, record) {
  const filePath = recordPath(targetPath, id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record));
}

test('repairBlTopicRecords repairs a record whose first message is already its own completion summary', () => {
  const target = mkGitRepo();
  writeDoneTicket(target, 'BL-900', 'Fix the thing');
  writeTopicRecord(target, 'BL-900', {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-900 - Fix the thing is complete.' }],
  });

  const result = repairBlTopicRecords(target);
  assert.deepEqual(result.outcomes, [{ backlogId: 'BL-900', repaired: true, reason: 'missing-opener-repaired' }]);

  const record = readRecord(target, 'BL-900');
  assert.equal(record.messages.length, 2);
  assert.match(record.messages[0].text, /^What it is: Fix the thing/);
  assert.equal(record.messages[1].text, 'BL-900 - Fix the thing is complete.');
});

test('a repaired record is actually committed (durable), not just written to disk', () => {
  const target = mkGitRepo();
  writeDoneTicket(target, 'BL-900', 'Fix the thing');
  writeTopicRecord(target, 'BL-900', {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-900 - Fix the thing is complete.' }],
  });

  repairBlTopicRecords(target);

  const filePath = recordPath(target, 'BL-900');
  const log = execFileSync('git', ['-C', target, 'log', '--format=%H', '--', filePath], { encoding: 'utf8' }).trim();
  assert.notEqual(log, '', 'expected the repaired record to have a real commit touching it');
});

test('a record that already has a real opener is left untouched', () => {
  const target = mkGitRepo();
  writeDoneTicket(target, 'BL-900', 'Fix the thing');
  const original = {
    id: 'BL-900',
    messages: [
      { seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'What it is: Fix the thing' },
      { seq: 1, ts: 2000, author: 'swarm', type: 'outbound', text: 'BL-900 - Fix the thing is complete.' },
    ],
  };
  writeTopicRecord(target, 'BL-900', original);

  const result = repairBlTopicRecords(target);
  assert.deepEqual(result.outcomes, [{ backlogId: 'BL-900', repaired: false, reason: 'opener-already-present' }]);
  assert.deepEqual(readRecord(target, 'BL-900'), original);
});

test('a topic record with no matching .done ticket is left untouched (nothing to regenerate an opener from)', () => {
  const target = mkGitRepo();
  writeTopicRecord(target, 'BL-900', {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-900 - Fix the thing is complete.' }],
  });

  const result = repairBlTopicRecords(target);
  assert.deepEqual(result.outcomes, [{ backlogId: 'BL-900', repaired: false, reason: 'no-matching-done-ticket' }]);
});

test('returns an empty result when backlog/topics does not exist at all', () => {
  const target = mkGitRepo();
  assert.deepEqual(repairBlTopicRecords(target), { outcomes: [] });
});

test('repairs multiple offending records independently, in the same run', () => {
  const target = mkGitRepo();
  writeDoneTicket(target, 'BL-900', 'First ticket');
  writeDoneTicket(target, 'BL-901', 'Second ticket');
  writeTopicRecord(target, 'BL-900', {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-900 - First ticket is complete.' }],
  });
  writeTopicRecord(target, 'BL-901', {
    id: 'BL-901',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-901 - Second ticket is complete.' }],
  });

  const result = repairBlTopicRecords(target);
  const byId = Object.fromEntries(result.outcomes.map((o) => [o.backlogId, o]));
  assert.equal(byId['BL-900'].repaired, true);
  assert.equal(byId['BL-901'].repaired, true);
  assert.equal(readRecord(target, 'BL-900').messages.length, 2);
  assert.equal(readRecord(target, 'BL-901').messages.length, 2);
});

test('the repaired record\'s FIRST message ts is strictly before the completion it now precedes', () => {
  const target = mkGitRepo();
  writeDoneTicket(target, 'BL-900', 'Fix the thing');
  writeTopicRecord(target, 'BL-900', {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 5000, author: 'swarm', type: 'outbound', text: 'BL-900 - Fix the thing is complete.' }],
  });

  repairBlTopicRecords(target);
  const record = readRecord(target, 'BL-900');
  assert.ok(record.messages[0].ts < record.messages[1].ts);
});

test('main() runs end to end via argv, exits non-zero with a usage message when no target is given', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', 'repair-bl-topic-records.js'];
    process.exitCode = undefined;
    await main();
    assert.equal(process.exitCode, 1);
    assert.ok(writes.join('').includes('Usage:'));
  } finally {
    process.stderr.write = originalWrite;
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }
});

test('main() prints the JSON result to stdout when a target is given', async () => {
  const target = mkGitRepo();
  writeDoneTicket(target, 'BL-900', 'Fix the thing');
  writeTopicRecord(target, 'BL-900', {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'swarm', type: 'outbound', text: 'BL-900 - Fix the thing is complete.' }],
  });

  const originalArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', 'repair-bl-topic-records.js', target];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = originalArgv;
  }
  const printed = JSON.parse(writes.join(''));
  assert.deepEqual(printed.outcomes, [{ backlogId: 'BL-900', repaired: true, reason: 'missing-opener-repaired' }]);
});
