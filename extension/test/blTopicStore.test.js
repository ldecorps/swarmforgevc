const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readRecord, appendMessage, recordPath, commitTopicRecord } = require('../out/concierge/blTopicStore');

// BL-329: the durable, git-tracked, per-ticket record of every message sent
// in a BL topic - inbound and outbound - so the Telegram topic becomes a
// disposable PROJECTION of state held in the repo rather than the source of
// truth itself. Mirrors support_thread_store.bb's own shape (one JSON
// record per id, atomic whole-file write via tmp+rename) but lives OUTSIDE
// .swarmforge/ (gitignored, lost on a fresh checkout) - under backlog/
// topics/, alongside the ticket itself.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl-topic-store-'));
}

// BL-348: appendMessage now reports a commit failure via an injectable
// reporter (default: loud stderr) rather than silently discarding it -
// every test below except the ones specifically ABOUT that reporting
// behavior passes this no-op so a plain (non-git) mkTmp() target, used
// throughout this file for tests that have nothing to do with git, does
// not spam real stderr on every run.
const SILENT = () => {};
function append(targetPath, ticketId, message) {
  return appendMessage(targetPath, ticketId, message, SILENT);
}

test('readRecord returns an empty record for a ticket with no messages yet', () => {
  const targetPath = mkTmp();
  assert.deepEqual(readRecord(targetPath, 'BL-900'), { id: 'BL-900', messages: [] });
});

test('appendMessage then readRecord round-trips the exact message', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'hello', ts: 1000 });
  assert.deepEqual(readRecord(targetPath, 'BL-900'), {
    id: 'BL-900',
    messages: [{ seq: 0, ts: 1000, author: 'human', type: 'inbound', text: 'hello' }],
  });
});

test('appendMessage carries order, timestamp, author and text for both directions (BL-329 serialise-topic-01)', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'a question', ts: 1000 });
  append(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: 'an answer', ts: 2000 });
  const record = readRecord(targetPath, 'BL-900');
  assert.equal(record.messages.length, 2);
  assert.deepEqual(record.messages[0], { seq: 0, ts: 1000, author: 'human', type: 'inbound', text: 'a question' });
  assert.deepEqual(record.messages[1], { seq: 1, ts: 2000, author: 'coder', type: 'outbound', text: 'an answer' });
});

test('appendMessage assigns a monotonically increasing seq regardless of call order across directions', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: '1', ts: 1 });
  append(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: '2', ts: 2 });
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: '3', ts: 3 });
  const seqs = readRecord(targetPath, 'BL-900').messages.map((m) => m.seq);
  assert.deepEqual(seqs, [0, 1, 2]);
});

test('the record lives in the repository, keyed by ticket, not under .swarmforge/ (BL-329 serialise-topic-02)', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const p = recordPath(targetPath, 'BL-900');
  assert.ok(p.includes(`${path.sep}backlog${path.sep}topics${path.sep}`), `expected the record under backlog/topics/, got ${p}`);
  assert.ok(!p.includes('.swarmforge'), `expected the record OUTSIDE the gitignored .swarmforge/ tree, got ${p}`);
  assert.ok(fs.existsSync(p), 'expected the record file to actually exist on disk');
});

test('a ticket record contains only that ticket\'s own messages, never another ticket\'s (BL-329 serialise-topic-02)', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'for 900', ts: 1 });
  append(targetPath, 'BL-901', { author: 'human', type: 'inbound', text: 'for 901', ts: 2 });
  assert.deepEqual(
    readRecord(targetPath, 'BL-900').messages.map((m) => m.text),
    ['for 900']
  );
  assert.deepEqual(
    readRecord(targetPath, 'BL-901').messages.map((m) => m.text),
    ['for 901']
  );
});

test('the record preserves the order messages were sent in, even out of alphabetical/random text order (BL-329 serialise-topic-03)', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'third-ish text but sent first', ts: 1 });
  append(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: 'aaa sent second', ts: 2 });
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'zzz sent third', ts: 3 });
  assert.deepEqual(
    readRecord(targetPath, 'BL-900').messages.map((m) => m.text),
    ['third-ish text but sent first', 'aaa sent second', 'zzz sent third']
  );
});

test('the record survives a restart of the writing process - a fresh read after append sees every prior message (BL-329 serialise-topic-04)', () => {
  const targetPath = mkTmp();
  append(targetPath, 'BL-900', { author: 'human', type: 'inbound', text: 'before restart', ts: 1 });
  // Simulate a process restart: nothing but the filesystem carries state
  // forward - re-reading from a fresh call must see what was written.
  const afterRestart = readRecord(targetPath, 'BL-900');
  assert.deepEqual(afterRestart.messages.map((m) => m.text), ['before restart']);
  append(targetPath, 'BL-900', { author: 'coder', type: 'outbound', text: 'after restart', ts: 2 });
  assert.deepEqual(readRecord(targetPath, 'BL-900').messages.map((m) => m.text), ['before restart', 'after restart']);
});

test('readRecord tolerates a missing backlog/topics directory entirely (never crashes on a fresh checkout)', () => {
  const targetPath = mkTmp();
  assert.doesNotThrow(() => readRecord(targetPath, 'BL-999'));
});

// ── commitTopicRecord / appendMessage's own git-durability (architect
//    bounce, 2026-07-13): a record that is merely NOT gitignored is still
//    lost on a fresh checkout / disk failure - "durable" requires it is
//    actually git-committed. Mirrors costHealthSidecar.test.js's own
//    git-fixture pattern exactly (real `git init` repo, scoped commit,
//    fail-open when there is nothing to commit or no repo at all). ───────

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

test('commitTopicRecord commits only the record file, scoped, into a real repo', () => {
  const target = mkGitRepo();

  // An unrelated dirty file must NOT be swept into the record's own commit.
  fs.writeFileSync(path.join(target, 'unrelated.txt'), 'do not commit me');

  // Write the file directly (never via appendMessage, which already
  // auto-commits - this test is about commitTopicRecord's OWN contract in
  // isolation) so the commit attempted below is genuinely a fresh one.
  const filePath = recordPath(target, 'BL-900');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ id: 'BL-900', messages: [] }));
  const committed = commitTopicRecord(target, filePath, 'BL-900');
  assert.equal(committed, true);

  const status = execFileSync('git', ['-C', target, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.match(status, /unrelated\.txt/, 'the unrelated file must remain uncommitted (still dirty)');
  assert.doesNotMatch(status, /backlog\/topics/, 'the record itself must no longer show as dirty (it was committed)');

  const log = execFileSync('git', ['-C', target, 'log', '--format=%s', '--', filePath], { encoding: 'utf8' });
  assert.match(log, /BL-900/);
});

test('commitTopicRecord returns false (never throws) when there is nothing new to commit', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  commitTopicRecord(target, filePath, 'BL-900');

  assert.doesNotThrow(() => commitTopicRecord(target, filePath, 'BL-900'));
  assert.equal(commitTopicRecord(target, filePath, 'BL-900'), false);
});

test('commitTopicRecord returns false (never throws) when the target is not a git repo at all', () => {
  const target = mkTmp();
  append(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  assert.doesNotThrow(() => commitTopicRecord(target, filePath, 'BL-900'));
  assert.equal(commitTopicRecord(target, filePath, 'BL-900'), false);
});

test('appendMessage itself commits the record into a real repo - the record actually survives a fresh checkout, not merely a non-gitignored write (architect bounce)', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'a durable message', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  const log = execFileSync('git', ['-C', target, 'log', '--format=%H', '--', filePath], { encoding: 'utf8' }).trim();
  assert.notEqual(log, '', 'expected the record file to have at least one real commit touching it');
});

test('appendMessage never throws even when the target path is not a git repo (fails open, write still succeeds)', () => {
  const target = mkTmp();
  assert.doesNotThrow(() => append(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 }));
  assert.deepEqual(readRecord(target, 'BL-900').messages.map((m) => m.text), ['hi']);
});

// BL-348: a commit failure must be reported, never silently dropped - proven
// with a capturing spy (never the real stderr default) so the assertion is
// on the exact (ticketId, filePath) reported, not merely "did not throw".
test('appendMessage reports the commit failure (ticketId, filePath) via the injected reporter when the target is not a git repo', () => {
  const target = mkTmp();
  const calls = [];
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 }, (ticketId, filePath) => {
    calls.push({ ticketId, filePath });
  });
  assert.equal(calls.length, 1, 'expected the reporter to fire exactly once');
  assert.equal(calls[0].ticketId, 'BL-900');
  assert.equal(calls[0].filePath, recordPath(target, 'BL-900'));
});

test('appendMessage does NOT report a failure when the commit actually succeeds', () => {
  const target = mkGitRepo();
  const calls = [];
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 }, (ticketId, filePath) => {
    calls.push({ ticketId, filePath });
  });
  assert.deepEqual(calls, [], 'expected no reporter call on a successful commit');
});
