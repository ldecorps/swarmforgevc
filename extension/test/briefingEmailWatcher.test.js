const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadSentBriefings,
  recordBriefingSent,
  findUnsentBriefings,
  buildBriefingSubject,
  sendUnsentBriefings,
  startBriefingEmailWatcher,
} = require('../out/notify/briefingEmailWatcher');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-briefings-'));
}

function writeBriefing(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

test('loadSentBriefings is empty when no sent-state file exists', () => {
  const dir = mkTmpDir();
  assert.deepEqual(loadSentBriefings(dir), new Set());
});

test('recordBriefingSent persists durably across reads', () => {
  const dir = mkTmpDir();
  recordBriefingSent(dir, '2026-07-02.md');
  assert.deepEqual(loadSentBriefings(dir), new Set(['2026-07-02.md']));
  recordBriefingSent(dir, '2026-07-03.md');
  assert.deepEqual(loadSentBriefings(dir), new Set(['2026-07-02.md', '2026-07-03.md']));
});

test('findUnsentBriefings lists only .md files not yet marked sent', () => {
  const dir = mkTmpDir();
  writeBriefing(dir, '2026-07-01.md', 'old');
  writeBriefing(dir, '2026-07-02.md', 'new');
  writeBriefing(dir, 'notes.txt', 'ignore me');
  recordBriefingSent(dir, '2026-07-01.md');
  assert.deepEqual(findUnsentBriefings(dir), ['2026-07-02.md']);
});

test('findUnsentBriefings returns empty for a directory that does not exist yet', () => {
  assert.deepEqual(findUnsentBriefings('/nonexistent/path/xyz'), []);
});

test('buildBriefingSubject includes the date and the first non-empty (headline) line', () => {
  const subject = buildBriefingSubject('2026-07-02', '\n\nUsers can now export CSV\nmore details...');
  assert.equal(subject, 'SwarmForge briefing 2026-07-02 - Users can now export CSV');
});

test('buildBriefingSubject falls back gracefully when the briefing body is empty', () => {
  assert.equal(buildBriefingSubject('2026-07-02', ''), 'SwarmForge briefing 2026-07-02');
});

// BL-099 briefing-03/07: exactly one email per committed briefing file.
test('sendUnsentBriefings sends each unsent file once and marks it sent', async () => {
  const dir = mkTmpDir();
  writeBriefing(dir, '2026-07-02.md', 'Headline feature\nmore.');
  const sentCalls = [];
  const result = await sendUnsentBriefings(dir, {
    readBriefingContent: (name) => fs.readFileSync(path.join(dir, name), 'utf-8'),
    sendEmail: async (subject, text) => {
      sentCalls.push({ subject, text });
      return true;
    },
  });
  assert.deepEqual(result, ['2026-07-02.md']);
  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].subject, 'SwarmForge briefing 2026-07-02 - Headline feature');
  assert.deepEqual(loadSentBriefings(dir), new Set(['2026-07-02.md']));
});

test('sendUnsentBriefings never re-sends a file already marked sent (idempotent across restarts)', async () => {
  const dir = mkTmpDir();
  writeBriefing(dir, '2026-07-02.md', 'Headline');
  recordBriefingSent(dir, '2026-07-02.md');
  const sentCalls = [];
  const result = await sendUnsentBriefings(dir, {
    readBriefingContent: (name) => fs.readFileSync(path.join(dir, name), 'utf-8'),
    sendEmail: async (subject, text) => {
      sentCalls.push({ subject, text });
      return true;
    },
  });
  assert.deepEqual(result, []);
  assert.equal(sentCalls.length, 0);
});

// Email failure never loses the briefing: a failed send is not marked sent.
test('sendUnsentBriefings retries a failed send on the next call instead of marking it sent', async () => {
  const dir = mkTmpDir();
  writeBriefing(dir, '2026-07-02.md', 'Headline');
  const firstAttempt = await sendUnsentBriefings(dir, {
    readBriefingContent: (name) => fs.readFileSync(path.join(dir, name), 'utf-8'),
    sendEmail: async () => false,
  });
  assert.deepEqual(firstAttempt, []);
  assert.deepEqual(loadSentBriefings(dir), new Set());

  const secondAttempt = await sendUnsentBriefings(dir, {
    readBriefingContent: (name) => fs.readFileSync(path.join(dir, name), 'utf-8'),
    sendEmail: async () => true,
  });
  assert.deepEqual(secondAttempt, ['2026-07-02.md']);
});

test('startBriefingEmailWatcher schedules a tick that sends unsent briefings, disposer clears it', async () => {
  const dir = mkTmpDir();
  writeBriefing(dir, '2026-07-02.md', 'Headline');
  let scheduled = null;
  let cleared = null;
  const dispose = startBriefingEmailWatcher(
    dir,
    {
      readBriefingContent: (name) => fs.readFileSync(path.join(dir, name), 'utf-8'),
      sendEmail: async () => true,
    },
    60000,
    (fn, ms) => {
      scheduled = { fn, ms };
      return 'handle-7';
    },
    (h) => {
      cleared = h;
    }
  );

  assert.equal(scheduled.ms, 60000);
  scheduled.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loadSentBriefings(dir), new Set(['2026-07-02.md']));

  dispose();
  assert.equal(cleared, 'handle-7');
});
