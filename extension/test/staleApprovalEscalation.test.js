'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  APPROVAL_ASK_LOCATOR,
} = require('../out/concierge/topicRouter');
const {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_STALE_AFTER_MS,
  approvalAskPostedAtMs,
  buildStaleApprovalDigest,
  buildTelegramDeepLink,
  lastHumanActivityMs,
  listLiveApprovalAskCandidates,
  parseHumanApprovalState,
  readLastStaleApprovalEmailMs,
  resetStaleApprovalMissingKeyWarningForTests,
  resolvePositiveMs,
  selectStaleApprovalAsks,
  staleApprovalEscalationStatePath,
  sweepStaleApprovalAsks,
  writeLastStaleApprovalEmailMs,
} = require('../out/notify/staleApprovalEscalation');

const NOW = Date.parse('2026-08-24T12:00:00Z');
const HOUR = 3_600_000;
const THRESHOLD = DEFAULT_STALE_AFTER_MS;
const COOLDOWN = DEFAULT_COOLDOWN_MS;

function askMsg(ts, id = 'BL-100') {
  return {
    seq: 1,
    ts,
    author: 'swarm',
    type: 'outbound',
    text: `${id} ${APPROVAL_ASK_LOCATOR} before it can proceed.`,
  };
}

function inbound(ts, seq = 2) {
  return { seq, ts, author: 'human', type: 'inbound', text: 'looking' };
}

function outboundNoise(ts, seq = 3) {
  return { seq, ts, author: 'swarm', type: 'outbound', text: 'status update' };
}

function record(messages) {
  return { id: 'BL-100', messages };
}

function candidate(overrides = {}) {
  const id = overrides.id ?? 'BL-100';
  const postedAt = overrides.postedAt ?? NOW - 3 * HOUR;
  return {
    id,
    state: overrides.state ?? 'pending',
    topicRecord:
      Object.prototype.hasOwnProperty.call(overrides, 'topicRecord')
        ? overrides.topicRecord
        : record([askMsg(postedAt, id)]),
    askMessageId: overrides.askMessageId,
    askTopicId: overrides.askTopicId,
  };
}

function mkSweepAdapters(overrides = {}) {
  const sent = [];
  const warnings = [];
  let lastSent = overrides.lastSentMs ?? null;
  const apiKey = Object.prototype.hasOwnProperty.call(overrides, 'apiKey')
    ? overrides.apiKey
    : 're_test';
  return {
    sent,
    warnings,
    adapters: {
      nowMs: () => overrides.nowMs ?? NOW,
      listCandidates: () => overrides.candidates ?? [candidate()],
      sendEmail: async (message) => {
        sent.push(message);
        return { success: true };
      },
      readLastSentMs: () => lastSent,
      writeLastSentMs: (ms) => {
        lastSent = ms;
      },
      readApiKey: () => apiKey,
      warnMissingApiKey: () => warnings.push('missing-key'),
      ...overrides.adapterOverrides,
    },
  };
}

function mkConfig(overrides = {}) {
  return {
    to: 'human@example.com',
    from: 'onboarding@resend.dev',
    chatId: '-1004415865297',
    staleAfterMs: THRESHOLD,
    cooldownMs: COOLDOWN,
    ...overrides,
  };
}

test('resolvePositiveMs falls back when unset or non-positive', () => {
  assert.equal(resolvePositiveMs(undefined, 9), 9);
  assert.equal(resolvePositiveMs('7200000', 9), 7_200_000);
  assert.equal(resolvePositiveMs('0', 9), 9);
  assert.equal(resolvePositiveMs('nope', 9), 9);
});

test('parseHumanApprovalState maps known values and pending-review', () => {
  assert.equal(parseHumanApprovalState('id: BL-1\nhuman_approval: pending\n'), 'pending');
  assert.equal(parseHumanApprovalState('human_approval: pending-review\n'), 'pending');
  assert.equal(parseHumanApprovalState('human_approval: amending\n'), 'amending');
  assert.equal(parseHumanApprovalState('human_approval: approved\n'), 'approved');
  assert.equal(parseHumanApprovalState('human_approval: rejected\n'), 'rejected');
  assert.equal(parseHumanApprovalState('id: BL-1\n'), 'absent');
});

test('approvalAskPostedAtMs uses the latest outbound ask, never earlier ones', () => {
  const r = record([
    askMsg(NOW - 5 * HOUR),
    askMsg(NOW - 1 * HOUR),
  ]);
  r.messages[1].seq = 2;
  assert.equal(approvalAskPostedAtMs(r), NOW - HOUR);
});

test('approvalAskPostedAtMs and lastHumanActivityMs fail closed without evidence', () => {
  assert.equal(approvalAskPostedAtMs(undefined), undefined);
  assert.equal(approvalAskPostedAtMs(record([])), undefined);
  assert.equal(approvalAskPostedAtMs(record([outboundNoise(NOW)])), undefined);
  assert.equal(lastHumanActivityMs(undefined), undefined);
  assert.equal(lastHumanActivityMs(record([askMsg(NOW)])), undefined);
});

test('selectStaleApprovalAsks keeps pending/amending past threshold oldest-first', () => {
  const selected = selectStaleApprovalAsks(
    [
      candidate({ id: 'BL-200', postedAt: NOW - 3 * HOUR }),
      candidate({ id: 'BL-100', postedAt: NOW - 5 * HOUR }),
      candidate({ id: 'BL-300', state: 'approved', postedAt: NOW - 5 * HOUR }),
      candidate({ id: 'BL-400', postedAt: NOW - 30 * 60 * 1000 }),
    ],
    NOW,
    THRESHOLD
  );
  assert.deepEqual(
    selected.map((e) => e.id),
    ['BL-100', 'BL-200']
  );
});

test('selectStaleApprovalAsks: inbound resets the clock; outbound noise does not', () => {
  const withInbound = selectStaleApprovalAsks(
    [
      candidate({
        topicRecord: record([
          askMsg(NOW - 5 * HOUR),
          inbound(NOW - 10 * 60 * 1000),
        ]),
      }),
    ],
    NOW,
    THRESHOLD
  );
  assert.equal(withInbound.length, 0);

  const withOutbound = selectStaleApprovalAsks(
    [
      candidate({
        topicRecord: record([
          askMsg(NOW - 5 * HOUR),
          outboundNoise(NOW - 10 * 60 * 1000),
        ]),
      }),
    ],
    NOW,
    THRESHOLD
  );
  assert.equal(withOutbound.length, 1);
});

test('selectStaleApprovalAsks fails closed when the topic record or ask is missing', () => {
  assert.equal(
    selectStaleApprovalAsks([candidate({ topicRecord: undefined })], NOW, THRESHOLD).length,
    0
  );
  assert.equal(
    selectStaleApprovalAsks([candidate({ topicRecord: record([]) })], NOW, THRESHOLD).length,
    0
  );
});

test('buildTelegramDeepLink strips -100 and degrades without a usable chat id', () => {
  assert.equal(
    buildTelegramDeepLink('-1004415865297', 1785, 6719),
    'https://t.me/c/4415865297/1785/6719'
  );
  assert.equal(
    buildTelegramDeepLink('4415865297', 1785, 6719),
    'https://t.me/c/4415865297/1785/6719'
  );
  assert.equal(buildTelegramDeepLink('-1004415865297', 1785), 'https://t.me/c/4415865297/1785');
  assert.equal(buildTelegramDeepLink('not-a-number', 1785, 6719), undefined);
});

test('buildStaleApprovalDigest orders lines and includes deep links', () => {
  const digest = buildStaleApprovalDigest(
    [
      {
        id: 'BL-100',
        state: 'pending',
        waitedSinceMs: NOW - 5 * HOUR,
        askMessageId: 1,
        askTopicId: 1785,
        deepLink: 'https://t.me/c/1/1785/1',
      },
      {
        id: 'BL-200',
        state: 'amending',
        waitedSinceMs: NOW - 3 * HOUR,
        askMessageId: 2,
        askTopicId: 1785,
        deepLink: 'https://t.me/c/1/1785/2',
      },
    ],
    NOW
  );
  assert.equal(digest.subject, 'Stale approval asks: 2 tickets');
  assert.match(digest.text, /BL-100 \(pending, waiting 5h\) https:\/\/t\.me\/c\/1\/1785\/1/);
  assert.match(digest.text, /BL-200 \(amending, waiting 3h\) https:\/\/t\.me\/c\/1\/1785\/2/);
  assert.ok(digest.text.indexOf('BL-100') < digest.text.indexOf('BL-200'));
});

test('sweepStaleApprovalAsks sends one digest past threshold and respects cooldown', async () => {
  resetStaleApprovalMissingKeyWarningForTests();
  const { sent, adapters } = mkSweepAdapters({
    candidates: [
      candidate({ id: 'BL-100', postedAt: NOW - 5 * HOUR, askTopicId: 1785, askMessageId: 10 }),
      candidate({ id: 'BL-200', postedAt: NOW - 3 * HOUR, askTopicId: 1785, askMessageId: 20 }),
    ],
  });
  assert.equal(await sweepStaleApprovalAsks(mkConfig(), adapters), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Stale approval asks: 2 tickets');
  assert.ok(sent[0].text.indexOf('BL-100') < sent[0].text.indexOf('BL-200'));
  assert.match(sent[0].text, /https:\/\/t\.me\/c\/4415865297\/1785\/10/);

  assert.equal(await sweepStaleApprovalAsks(mkConfig(), adapters), 'not-sent');
  assert.equal(sent.length, 1);
});

test('sweepStaleApprovalAsks writes cooldown before send (anti-storm)', async () => {
  resetStaleApprovalMissingKeyWarningForTests();
  let lastSent = null;
  let writeCount = 0;
  const { adapters } = mkSweepAdapters({
    candidates: [candidate({ postedAt: NOW - 5 * HOUR, askTopicId: 1785, askMessageId: 10 })],
    adapterOverrides: {
      readLastSentMs: () => lastSent,
      writeLastSentMs: (ms) => {
        writeCount += 1;
        lastSent = ms;
      },
      sendEmail: async () => {
        assert.equal(writeCount, 1, 'cooldown must be written before sendEmail');
        throw new Error('resend down');
      },
    },
  });
  await assert.rejects(() => sweepStaleApprovalAsks(mkConfig(), adapters), /resend down/);
  assert.equal(writeCount, 1);
  assert.equal(lastSent, NOW);
});

test('sweepStaleApprovalAsks does not send inside the threshold', async () => {
  const { sent, adapters } = mkSweepAdapters({
    candidates: [candidate({ postedAt: NOW - 30 * 60 * 1000 })],
  });
  assert.equal(await sweepStaleApprovalAsks(mkConfig(), adapters), 'not-sent');
  assert.equal(sent.length, 0);
});

test('sweepStaleApprovalAsks warns once when recipient is set but API key is missing', async () => {
  resetStaleApprovalMissingKeyWarningForTests();
  const { sent, warnings, adapters } = mkSweepAdapters({ apiKey: undefined });
  assert.equal(await sweepStaleApprovalAsks(mkConfig(), adapters), 'warned');
  assert.equal(await sweepStaleApprovalAsks(mkConfig(), adapters), 'warned');
  assert.equal(warnings.length, 1);
  assert.equal(sent.length, 0);
});

test('sweepStaleApprovalAsks is a quiet no-op when no recipient is configured', async () => {
  resetStaleApprovalMissingKeyWarningForTests();
  const { sent, warnings, adapters } = mkSweepAdapters();
  assert.equal(await sweepStaleApprovalAsks(mkConfig({ to: undefined }), adapters), 'not-sent');
  assert.equal(sent.length, 0);
  assert.equal(warnings.length, 0);
});

test('cooldown state file read/write is load-bearing on disk', () => {
  const root = mkTmpDir('sfvc-bl584-cooldown-');
  assert.equal(readLastStaleApprovalEmailMs(root), null);
  writeLastStaleApprovalEmailMs(root, 12345);
  assert.equal(readLastStaleApprovalEmailMs(root), 12345);
  assert.deepEqual(JSON.parse(fs.readFileSync(staleApprovalEscalationStatePath(root), 'utf8')), {
    lastSentMs: 12345,
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('listLiveApprovalAskCandidates walks live YAML and joins ask + topic evidence', () => {
  const root = mkTmpDir('sfvc-bl584-scan-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-100.yaml'),
    'id: BL-100\nhuman_approval: pending\n'
  );
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', 'BL-200.yaml'),
    'id: BL-200\nhuman_approval: amending\n'
  );
  const topic = record([askMsg(NOW - 3 * HOUR)]);
  const listed = listLiveApprovalAskCandidates(root, {
    readTopicRecord: (id) => (id === 'BL-100' ? topic : undefined),
    readAskMessages: () => ({
      'BL-100': { topicId: 1785, messageId: 6719 },
    }),
  });
  const byId = Object.fromEntries(listed.map((c) => [c.id, c]));
  assert.equal(byId['BL-100'].state, 'pending');
  assert.equal(byId['BL-100'].askTopicId, 1785);
  assert.equal(byId['BL-100'].askMessageId, 6719);
  assert.equal(byId['BL-100'].topicRecord, topic);
  assert.equal(byId['BL-200'].state, 'amending');
  assert.equal(byId['BL-200'].askMessageId, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('BL-584 wiring: front-desk bot source wires the sweep into concierge tick adapters', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'tools', 'telegram-front-desk-bot.ts'),
    'utf8'
  );
  assert.match(src, /sweepStaleApprovalAsks:\s*async\s*\(nowMs\)\s*=>/);
  assert.match(src, /listLiveApprovalAskCandidates/);
  assert.match(src, /sendResendEmail/);
  assert.match(src, /readEffectiveConfigValue\(targetPath,\s*'notify_email_to'\)/);
  assert.match(src, /process\.env\.RESEND_API_KEY/);
  assert.doesNotMatch(src, /from ['"]\.\.\/notify\/secrets['"]/);
});
