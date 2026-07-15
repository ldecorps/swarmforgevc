const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readRecord, appendMessage, recordPath, commitTopicRecord, hasCompletionRecord, isRecordCommitted, hasUpdateId, readSwarmIconId, recordSwarmIconId } = require('../out/concierge/blTopicStore');

// BL-329: the durable, git-tracked, per-ticket record of every message sent
// in a BL topic - inbound and outbound - so the Telegram topic becomes a
// disposable PROJECTION of state held in the repo rather than the source of
// truth itself. Mirrors support_thread_store.bb's own shape (one JSON
// record per id, atomic whole-file write via tmp+rename) but lives OUTSIDE
// .swarmforge/ (gitignored, lost on a fresh checkout) - under backlog/
// topics/, alongside the ticket itself.

function mkTmp() {
  return mkTmpDir('sfvc-bl-topic-store-');
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

// BL-390: a REWRITE that produces byte-identical content is not a failure to
// commit - the record is already fully durable, and there is genuinely
// nothing new to commit. Redefined from "returns false" (indistinguishable
// from a genuine git failure, which wrongly triggered appendMessage's own
// commit-failure durability warning for a benign no-op) to an explicit
// "true, already durable, no commit minted" outcome - and no NEW commit is
// created for that file at all (the actual defect: a persister that mints a
// commit, or a false failure report, for a no-op rewrite).
test('commitTopicRecord returns true (already durable) and mints NO new commit when there is nothing new to commit', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  const before = execFileSync('git', ['-C', target, 'log', '--oneline', '--', filePath], { encoding: 'utf8' });

  assert.doesNotThrow(() => commitTopicRecord(target, filePath, 'BL-900'));
  assert.equal(commitTopicRecord(target, filePath, 'BL-900'), true);

  const after = execFileSync('git', ['-C', target, 'log', '--oneline', '--', filePath], { encoding: 'utf8' });
  assert.equal(after, before, 'expected no new commit to have been minted for a byte-identical rewrite');
});

test('commitTopicRecord returns false (never throws) when the target is not a git repo at all', () => {
  const target = mkTmp();
  append(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  assert.doesNotThrow(() => commitTopicRecord(target, filePath, 'BL-900'));
  assert.equal(commitTopicRecord(target, filePath, 'BL-900'), false);
});

// ── BL-390: a-churn-rewrite-does-not-mint-a-commit ──────────────────────

test('BL-390 scenario 01: rewriting a record with EXACTLY the content it already had commits nothing', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  const headBefore = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  // Re-write the exact same bytes already on disk (and already committed) -
  // simulates any future full-rewrite caller re-persisting unchanged state.
  fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf8'));
  commitTopicRecord(target, filePath, 'BL-900');

  const headAfter = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(headAfter, headBefore, 'expected HEAD to be unchanged - no commit minted for identical content');
});

// BL-390 hardening: commitTopicRecord's own no-op guard is
// `if (isFileCommitted(...)) return true`. isFileCommitted reads
// `git status --porcelain` for the path, which prints nothing both when a
// file IS durably committed and when it was never written at all - so a
// filePath that does not exist on disk must never short-circuit "already
// durable" (true) without ever attempting a commit; that would be a silent
// no-commit-at-all bug for a file that has, in fact, never been persisted.
test('commitTopicRecord does not report a never-written file as already durable', () => {
  const target = mkGitRepo();
  const filePath = recordPath(target, 'BL-900');
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(commitTopicRecord(target, filePath, 'BL-900'), false);
});

test('BL-390 scenario 02: a record that genuinely changed is still committed', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');
  const headBefore = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  append(target, 'BL-900', { author: 'coder', type: 'outbound', text: 'a genuinely new message', ts: 2 });

  const headAfter = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.notEqual(headAfter, headBefore, 'expected a new commit for genuinely changed content');
});

test('BL-390 scenario 03: nothing is pushed when nothing was committed - HEAD carries no new commit for a fixture remote to receive', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  const filePath = recordPath(target, 'BL-900');

  const remote = mkTmp();
  git(remote, ['init', '-q', '--bare']);
  git(target, ['remote', 'add', 'origin', remote]);
  git(target, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  const remoteHeadBefore = execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

  fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf8'));
  commitTopicRecord(target, filePath, 'BL-900');
  git(target, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);

  const remoteHeadAfter = execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  assert.equal(remoteHeadAfter, remoteHeadBefore, 'expected nothing new to have been pushed to the remote');
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

// ── hasCompletionRecord (BL-331: the shared "is this record verified
//    complete" predicate, extracted from BL-330's own isAlreadyReconciled) ──

test('hasCompletionRecord is false for an empty record (no messages at all)', () => {
  assert.equal(hasCompletionRecord({ id: 'BL-900', messages: [] }, 'BL-900 - a fine feature is complete.'), false);
});

test('hasCompletionRecord is false when the record has messages but none match the exact completion text', () => {
  const record = { id: 'BL-900', messages: [{ seq: 0, ts: 1, author: 'human', type: 'inbound', text: 'a question' }] };
  assert.equal(hasCompletionRecord(record, 'BL-900 - a fine feature is complete.'), false);
});

test('hasCompletionRecord is false when the exact text is present but recorded as INBOUND, never outbound', () => {
  const text = 'BL-900 - a fine feature is complete.';
  const record = { id: 'BL-900', messages: [{ seq: 0, ts: 1, author: 'human', type: 'inbound', text }] };
  assert.equal(hasCompletionRecord(record, text), false);
});

test('hasCompletionRecord is true once the exact completion text was recorded as an outbound message', () => {
  const text = 'BL-900 - a fine feature is complete.';
  const record = {
    id: 'BL-900',
    messages: [
      { seq: 0, ts: 1, author: 'human', type: 'inbound', text: 'a question' },
      { seq: 1, ts: 2, author: 'swarm', type: 'outbound', text },
    ],
  };
  assert.equal(hasCompletionRecord(record, text), true);
});

// ── isRecordCommitted (BL-331 architect bounce: content correctness alone
//    cannot prove durability - appendMessage's own write can succeed while
//    its commit fails) ───────────────────────────────────────────────────

test('isRecordCommitted is true once appendMessage has actually committed the record into a real repo', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  assert.equal(isRecordCommitted(target, 'BL-900'), true);
});

test('isRecordCommitted is false when the record was written but the commit failed (not a git repo at all)', () => {
  const target = mkTmp();
  append(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  assert.equal(isRecordCommitted(target, 'BL-900'), false, "the write succeeded (readRecord round-trips it) but it is not durable - never treat this as verified");
});

test('isRecordCommitted is false after a SECOND append whose own commit has not happened yet is simulated (a real uncommitted write on top of a committed one)', () => {
  const target = mkGitRepo();
  appendMessage(target, 'BL-900', { author: 'human', type: 'inbound', text: 'first', ts: 1 }); // committed
  // Simulate a second write landing without its commit succeeding, by
  // writing directly (bypassing appendMessage's own auto-commit) - the
  // exact shape of the crash window CommitFailureReporter documents.
  const record = readRecord(target, 'BL-900');
  record.messages.push({ seq: 1, ts: 2, author: 'human', type: 'inbound', text: 'second, uncommitted' });
  fs.writeFileSync(recordPath(target, 'BL-900'), JSON.stringify(record));
  assert.equal(isRecordCommitted(target, 'BL-900'), false);
});

// ── hasUpdateId / appendMessage's updateId (BL-389 scenarios 04/05: the
//    idempotency gate that was missing for postOperatorContext, the exact
//    adapter whose redelivery flooded a topic record with 209 duplicate
//    commits) ────────────────────────────────────────────────────────────

test('appendMessage carries the originating updateId through to the stored record', () => {
  const target = mkTmp();
  append(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1, updateId: 501 });
  assert.equal(readRecord(target, 'BL-900').messages[0].updateId, 501);
});

test('hasUpdateId is false for an empty record', () => {
  assert.equal(hasUpdateId({ id: 'BL-900', messages: [] }, 501), false);
});

test('hasUpdateId is false when updateId is undefined, regardless of what is on record (no origin to compare)', () => {
  const record = { id: 'BL-900', messages: [{ seq: 0, ts: 1, author: 'human', type: 'inbound', text: 'hi', updateId: 501 }] };
  assert.equal(hasUpdateId(record, undefined), false);
});

test('hasUpdateId is false when the record holds only OTHER updateIds', () => {
  const record = { id: 'BL-900', messages: [{ seq: 0, ts: 1, author: 'human', type: 'inbound', text: 'hi', updateId: 501 }] };
  assert.equal(hasUpdateId(record, 502), false);
});

test('hasUpdateId is true once a message with that exact updateId is on record', () => {
  const record = { id: 'BL-900', messages: [{ seq: 0, ts: 1, author: 'human', type: 'inbound', text: 'hi', updateId: 501 }] };
  assert.equal(hasUpdateId(record, 501), true);
});

test('hasUpdateId is false for a message with no updateId at all (older records, outbound/swarm text)', () => {
  const record = { id: 'BL-900', messages: [{ seq: 0, ts: 1, author: 'swarm', type: 'outbound', text: 'hi' }] };
  assert.equal(hasUpdateId(record, 501), false);
});

// ── readSwarmIconId / recordSwarmIconId (BL-342: the "did the swarm set
//    this topic's icon" marker - absent means never touch it) ───────────

test('readSwarmIconId is undefined for a ticket with no topic record at all', () => {
  const target = mkTmp();
  assert.equal(readSwarmIconId(target, 'BL-900'), undefined);
});

test('recordSwarmIconId then readSwarmIconId round-trips the exact icon id', () => {
  const target = mkTmp();
  recordSwarmIconId(target, 'BL-900', 'icon-check', SILENT);
  assert.equal(readSwarmIconId(target, 'BL-900'), 'icon-check');
});

test('recordSwarmIconId works on a brand-new topic with no messages yet (set at creation time)', () => {
  const target = mkTmp();
  recordSwarmIconId(target, 'BL-900', 'icon-bulb', SILENT);
  const record = readRecord(target, 'BL-900');
  assert.deepEqual(record.messages, []);
  assert.equal(record.swarmIconId, 'icon-bulb');
});

test('recordSwarmIconId does not disturb existing messages on the same record', () => {
  const target = mkTmp();
  append(target, 'BL-900', { author: 'human', type: 'inbound', text: 'hi', ts: 1 });
  recordSwarmIconId(target, 'BL-900', 'icon-check', SILENT);
  const record = readRecord(target, 'BL-900');
  assert.equal(record.messages.length, 1);
  assert.equal(record.swarmIconId, 'icon-check');
});

test('recordSwarmIconId overwrites a prior swarm-set icon id (a genuine state change)', () => {
  const target = mkTmp();
  recordSwarmIconId(target, 'BL-900', 'icon-bulb', SILENT);
  recordSwarmIconId(target, 'BL-900', 'icon-check', SILENT);
  assert.equal(readSwarmIconId(target, 'BL-900'), 'icon-check');
});

test('BL-390: recordSwarmIconId mints no new commit when the icon id is unchanged (a no-op rewrite)', () => {
  const target = mkGitRepo();
  recordSwarmIconId(target, 'BL-900', 'icon-check');
  const filePath = recordPath(target, 'BL-900');
  const headBefore = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  recordSwarmIconId(target, 'BL-900', 'icon-check');

  const headAfter = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(headAfter, headBefore, 'expected no new commit for re-setting the identical icon id');
});
