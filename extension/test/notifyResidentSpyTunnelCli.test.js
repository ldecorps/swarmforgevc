const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { notifyResidentSpyTunnelUrl, main } = require('../out/tools/notify-resident-spy-tunnel');
const { RESIDENT_SPY_SUBJECT_ID, RESIDENT_SPY_TOPIC_NAME } = require('../out/tools/telegramTopicDecisions');
const { buildBubblePairingDeepLink } = require('../out/concierge/residentSpyTunnelNotify');

// BL-716 hardening pass: notify-resident-spy-tunnel.ts had ZERO test
// coverage before this ticket touched it (added the pairingDeepLink field
// to the private-DM buttons call, dns-05). This file wires the whole
// notifyResidentSpyTunnelUrl/main() path against a stubbed global.fetch
// (the same seam relayOnboardingNegotiationTelegramCli.test.js and
// telegramFrontDeskBotCli.test.js already use, since these telegramClient
// calls are made without an injectable postFn) and a real tmp project root
// under .swarmforge/operator/, rather than reimplementing Telegram.

const TOKEN = '123456:test-bot-token';
const CHAT_ID = '999888777';
const PRINCIPAL_ID = '42424242';
const TOPIC_ID = 777;
const LIVE_URL = 'https://foo.trycloudflare.com/resident-spy?bearer=abc123';

function withFetch(handler, run) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return run().finally(() => {
    global.fetch = originalFetch;
  });
}

function withEnv(vars, run) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return run().finally(() => {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });
}

// Pre-seeds the topic map + standing title so ensureResidentSpyTopicStandalone
// takes the 'reuse' branch and syncStandingTopicTitleIfNeeded reads 'unchanged'
// - keeps each test's fetch handler scoped to the calls THAT test cares about
// instead of also stubbing createForumTopic/editForumTopic every time.
function setupProjectRoot() {
  const root = mkTmpDir('bl716-notify-resident-spy-');
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  fs.writeFileSync(
    path.join(opDir, 'telegram-topic-map.json'),
    JSON.stringify({ [String(TOPIC_ID)]: RESIDENT_SPY_SUBJECT_ID })
  );
  fs.writeFileSync(
    path.join(opDir, 'telegram-standing-topic-titles.json'),
    JSON.stringify({ [RESIDENT_SPY_SUBJECT_ID]: RESIDENT_SPY_TOPIC_NAME })
  );
  return root;
}

function readNotifyState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'resident-spy-tunnel-notify.json'), 'utf8'));
}

// Routes every telegramClient call this CLI makes to a canned response.
// `dm` overrides the /sendMessage response for the private-DM call
// specifically (identified by chat_id === PRINCIPAL_ID); `menuOk` toggles
// setChatMenuButton's outcome. Every other call succeeds.
function standardHandler({ dm, menuOk = true } = {}) {
  const calls = [];
  const handler = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    if (u.includes('/getMe')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'SwarmForgeBot' } }) };
    }
    if (u.includes('/setChatMenuButton')) {
      return menuOk
        ? { ok: true, status: 200, json: async () => ({ ok: true, result: true }) }
        : { ok: false, status: 400, json: async () => ({ ok: false, description: 'bad menu' }) };
    }
    if (u.includes('/sendMessage')) {
      const body = JSON.parse(opts.body);
      if (dm && body.chat_id === PRINCIPAL_ID) {
        return dm;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 555 } }) };
    }
    if (u.includes('/editMessageText')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/deleteMessage')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/editForumTopic')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/createForumTopic')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_thread_id: 888 } }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return { calls, handler };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('notifyResidentSpyTunnelUrl skips when TELEGRAM_BOT_TOKEN is missing', async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: CHAT_ID }, async () => {
    const result = await notifyResidentSpyTunnelUrl(setupProjectRoot(), LIVE_URL);
    assert.deepEqual(result, { notified: false, outcome: 'skipped', reason: 'missing-telegram-config' });
  });
});

test('notifyResidentSpyTunnelUrl skips when TELEGRAM_CHAT_ID is missing', async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: undefined }, async () => {
    const result = await notifyResidentSpyTunnelUrl(setupProjectRoot(), LIVE_URL);
    assert.deepEqual(result, { notified: false, outcome: 'skipped', reason: 'missing-telegram-config' });
  });
});

test('notifyResidentSpyTunnelUrl posts the topic message and sends a private DM carrying the pairing deep link (BL-716 dns-05)', async () => {
  const root = setupProjectRoot();
  const { calls, handler } = standardHandler();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID: PRINCIPAL_ID }, () =>
    withFetch(handler, async () => {
      const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
      assert.equal(result.notified, true);
      assert.equal(result.outcome, 'posted');
      assert.equal(result.topicId, TOPIC_ID);
      assert.equal(result.menuButton, 'set');
      assert.equal(result.privateOutcome, 'private-dm-sent');
      assert.equal(readNotifyState(root).liveUrl, LIVE_URL);
    })
  );
  const statePath = path.join(root, '.swarmforge', 'operator', 'resident-spy-tunnel-notify.json');
  assert.ok(fs.readFileSync(statePath, 'utf8').endsWith('\n'), 'notify-state file should end with a trailing newline');
  // getBotUsername's result must actually reach the topic post (options.botUsername),
  // not a default {} that would silently fall back to "the front-desk bot".
  const topicPost = calls.find((c) => c.url.includes('/sendMessage') && c.body.chat_id === CHAT_ID);
  assert.match(topicPost.body.text, /@SwarmForgeBot/);
  // setChatMenuButton's exact request body, not a degenerate {}.
  const menuCall = calls.find((c) => c.url.includes('/setChatMenuButton'));
  assert.deepEqual(menuCall.body.menu_button, {
    type: 'web_app',
    text: 'SwarmForge',
    web_app: { url: 'https://foo.trycloudflare.com/console?bearer=abc123' },
  });
  // The private DM's exact prompt text.
  const dmCall = calls.find((c) => c.url.includes('/sendMessage') && c.body.chat_id === PRINCIPAL_ID);
  assert.equal(dmCall.body.text, 'SwarmForge console — tap to open inside Telegram:');
});

test('notifyResidentSpyTunnelUrl skips renaming the standing topic when the recorded title already matches (BL-716 hardening: syncStandingTopicTitleIfNeeded)', async () => {
  const root = setupProjectRoot();
  const { calls, handler } = standardHandler();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(calls.some((c) => c.url.includes('/editForumTopic')), false);
});

test('notifyResidentSpyTunnelUrl renames the standing topic and persists the new title when the recorded title is stale', async () => {
  const root = setupProjectRoot();
  // Overwrite the pre-seeded title with something stale so
  // decideStandingTopicTitleSync reports 'update', not 'unchanged'.
  const titlesPath = path.join(root, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json');
  fs.writeFileSync(titlesPath, JSON.stringify({ [RESIDENT_SPY_SUBJECT_ID]: 'Old Title' }));
  const { calls, handler } = standardHandler();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  const renameCall = calls.find((c) => c.url.includes('/editForumTopic'));
  assert.ok(renameCall, 'expected an editForumTopic call to rename the stale topic');
  assert.equal(renameCall.body.name, RESIDENT_SPY_TOPIC_NAME);
  assert.equal(renameCall.body.message_thread_id, TOPIC_ID);
  assert.equal(readJson(titlesPath)[RESIDENT_SPY_SUBJECT_ID], RESIDENT_SPY_TOPIC_NAME);
});

test('notifyResidentSpyTunnelUrl creates a fresh topic, records it in the topic map, and seeds its standing title when none exists yet', async () => {
  const root = mkTmpDir('bl716-notify-resident-spy-create-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  const { calls, handler } = standardHandler();
  const result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(result.outcome, 'posted');
  assert.equal(result.topicId, 888);
  assert.ok(calls.some((c) => c.url.includes('/createForumTopic')));
  const topicMapPath = path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
  assert.equal(readJson(topicMapPath)['888'], RESIDENT_SPY_SUBJECT_ID);
  assert.ok(fs.readFileSync(topicMapPath, 'utf8').endsWith('\n'), 'topic map file should end with a trailing newline');
  const titlesPath = path.join(root, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json');
  assert.equal(readJson(titlesPath)[RESIDENT_SPY_SUBJECT_ID], RESIDENT_SPY_TOPIC_NAME);
});

test('notifyResidentSpyTunnelUrl treats a "success but no thread id" createForumTopic reply the same as an outright failure', async () => {
  // Telegram's own {success:true} carries no guarantee the result payload
  // has a message_thread_id - `!created.success || created.messageThreadId
  // === undefined` must still catch this asymmetric case (success=true,
  // messageThreadId=undefined), not just outright failure (both true).
  const root = mkTmpDir('bl716-notify-resident-spy-create-no-threadid-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  const handler = async (url, opts) => {
    const u = String(url);
    if (u.includes('/createForumTopic')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    }
    return standardHandler().handler(url, opts);
  };
  const result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(result.outcome, 'failed-no-topic');
  assert.equal(fs.existsSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json')), false);
});

test('notifyResidentSpyTunnelUrl reads a corrupt topic-map.json as empty (creates a fresh topic instead of crashing)', async () => {
  const root = mkTmpDir('bl716-notify-resident-spy-corrupt-topicmap-');
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  fs.writeFileSync(path.join(opDir, 'telegram-topic-map.json'), '{not valid json');
  const { handler, calls } = standardHandler();
  const result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(result.outcome, 'posted');
  assert.ok(calls.some((c) => c.url.includes('/createForumTopic')), 'a corrupt map should be treated as empty, not reused');
});

test('notifyResidentSpyTunnelUrl reads a corrupt resident-spy-tunnel-notify.json as no prior state (treats it as a first-ever notify)', async () => {
  const root = setupProjectRoot();
  const statePath = path.join(root, '.swarmforge', 'operator', 'resident-spy-tunnel-notify.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{not valid json');
  const result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(standardHandler().handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(result.outcome, 'posted');
  assert.equal(readJson(statePath).liveUrl, LIVE_URL);
});

test('notifyResidentSpyTunnelUrl reads corrupt standing-topic-titles.json as empty rather than crashing, and still renames the topic', async () => {
  const root = setupProjectRoot();
  const titlesPath = path.join(root, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json');
  fs.writeFileSync(titlesPath, '{not valid json');
  const { handler, calls } = standardHandler();
  const result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(result.outcome, 'posted');
  assert.ok(calls.some((c) => c.url.includes('/editForumTopic')), 'an unreadable titles file should read as "no recorded title" and trigger a rename');
  assert.equal(readJson(titlesPath)[RESIDENT_SPY_SUBJECT_ID], RESIDENT_SPY_TOPIC_NAME);
});

test('notifyResidentSpyTunnelUrl logs and continues (does not persist a new title) when renaming the standing topic fails', async () => {
  const root = setupProjectRoot();
  const titlesPath = path.join(root, '.swarmforge', 'operator', 'telegram-standing-topic-titles.json');
  fs.writeFileSync(titlesPath, JSON.stringify({ [RESIDENT_SPY_SUBJECT_ID]: 'Old Title' }));
  const handler = async (url, opts) => {
    const u = String(url);
    if (u.includes('/editForumTopic')) {
      return { ok: false, status: 400, json: async () => ({ ok: false, description: 'topic not found' }) };
    }
    return standardHandler().handler(url, opts);
  };
  const previousStderr = process.stderr.write;
  const stderrChunks = [];
  process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
  let result;
  try {
    result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () => withFetch(handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL)));
  } finally {
    process.stderr.write = previousStderr;
  }
  // The overall notify still succeeds even though the topic rename failed.
  assert.equal(result.outcome, 'posted');
  assert.equal(readJson(titlesPath)[RESIDENT_SPY_SUBJECT_ID], 'Old Title');
  assert.ok(stderrChunks.some((c) => c.includes('failed to rename') && c.includes('topic not found')));
});

test('notifyResidentSpyTunnelUrl re-posts and deletes the stale topic message end-to-end when editMessageText fails', async () => {
  const root = setupProjectRoot();
  const firstDeleteCalls = [];
  const firstHandler = async (url, opts) => {
    const u = String(url);
    if (u.includes('/deleteMessage')) firstDeleteCalls.push(JSON.parse(opts.body));
    return standardHandler().handler(url, opts);
  };
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(firstHandler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  const firstMessageId = readNotifyState(root).messageId;
  assert.equal(typeof firstMessageId, 'number');

  // Second call: same liveUrl (forces the edit path, not a fresh post) but
  // editMessageText fails - the CLI must fall back to post+delete, wired
  // all the way through its real editMessage/deleteMessage adapters.
  const statePath = path.join(root, '.swarmforge', 'operator', 'resident-spy-tunnel-notify.json');
  fs.writeFileSync(statePath, JSON.stringify({ ...readJson(statePath), formatVersion: 1 }));
  const deleteCalls = [];
  const postIds = [900];
  const secondHandler = async (url, opts) => {
    const u = String(url);
    if (u.includes('/editMessageText')) {
      return { ok: false, status: 400, json: async () => ({ ok: false, description: 'message to edit not found' }) };
    }
    if (u.includes('/deleteMessage')) {
      deleteCalls.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/sendMessage')) {
      const body = JSON.parse(opts.body);
      if (body.message_thread_id !== undefined) {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: postIds.shift() } }) };
      }
    }
    return standardHandler().handler(url, opts);
  };
  const result = await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
    withFetch(secondHandler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL))
  );
  assert.equal(result.outcome, 'posted');
  assert.equal(readNotifyState(root).messageId, 900);
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].message_id, firstMessageId);
});

test('notifyResidentSpyTunnelUrl private DM buttons include the exact pairing deep link for this URL', async () => {
  const root = setupProjectRoot();
  const { calls, handler } = standardHandler();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID: PRINCIPAL_ID }, () =>
    withFetch(handler, async () => {
      await notifyResidentSpyTunnelUrl(root, LIVE_URL);
    })
  );
  const dmCall = calls.find((c) => c.url.includes('/sendMessage') && c.body.chat_id === PRINCIPAL_ID);
  assert.ok(dmCall, 'expected a sendMessage call to the principal user');
  const buttons = dmCall.body.reply_markup.inline_keyboard;
  const pairButton = buttons.flat().find((b) => b.text === 'Update Bubble pairing');
  assert.ok(pairButton, 'expected an "Update Bubble pairing" button');
  assert.equal(pairButton.url, buildBubblePairingDeepLink(LIVE_URL));
});

test('notifyResidentSpyTunnelUrl never sends a private DM when TELEGRAM_PRINCIPAL_USER_ID is unset', async () => {
  const root = setupProjectRoot();
  const { calls, handler } = standardHandler();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID: undefined }, () =>
    withFetch(handler, async () => {
      const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
      assert.equal(result.privateOutcome, undefined);
    })
  );
  assert.equal(calls.some((c) => c.url.includes('/sendMessage') && c.body.chat_id === PRINCIPAL_ID), false);
});

test('notifyResidentSpyTunnelUrl reports the DM error text on a failed private send', async () => {
  const root = setupProjectRoot();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID: PRINCIPAL_ID }, () =>
    withFetch(
      standardHandler({ dm: { ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' }) } }).handler,
      async () => {
        const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
        assert.match(result.privateOutcome, /Forbidden: bot was blocked/);
      }
    )
  );
});

test('notifyResidentSpyTunnelUrl still reports a defined privateOutcome when the DM failure carries no description text', async () => {
  // sendTelegramMessage's own formatApiFailureError always returns a non-empty
  // "Telegram API responded with status N" string on any failure (with or
  // without a `description` field) - so the `dm.error ?? 'private-dm-failed'`
  // fallback in notify-resident-spy-tunnel.ts can never observe a falsy
  // dm.error through the real client. This asserts the reachable half of
  // that ternary (dm.error wins) with an empty description, rather than
  // fabricating an unreachable falsy-error fixture for the other half.
  const root = setupProjectRoot();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID: PRINCIPAL_ID }, () =>
    withFetch(
      standardHandler({ dm: { ok: false, status: 500, json: async () => ({ ok: false }) } }).handler,
      async () => {
        const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
        assert.equal(result.privateOutcome, 'Telegram API responded with status 500');
      }
    )
  );
});

test('notifyResidentSpyTunnelUrl reports menuButton "set" on success and the error text on failure', async () => {
  const root = setupProjectRoot();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, async () => {
    await withFetch(standardHandler({ menuOk: true }).handler, async () => {
      const ok = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
      assert.equal(ok.menuButton, 'set');
    });
    await withFetch(standardHandler({ menuOk: false }).handler, async () => {
      const failed = await notifyResidentSpyTunnelUrl(root, `${LIVE_URL}&x=2`);
      assert.equal(failed.menuButton, 'Telegram API responded with status 400: bad menu');
    });
  });
});

test('notifyResidentSpyTunnelUrl edits in place (outcome "edited") on a second call with the same URL topic content changed only by format version, and reports notified=true', async () => {
  const root = setupProjectRoot();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, async () => {
    await withFetch(standardHandler().handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL));
    // Force a re-notify (stale formatVersion) so the edit branch runs against
    // the existing messageId written by the first call.
    const statePath = path.join(root, '.swarmforge', 'operator', 'resident-spy-tunnel-notify.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    fs.writeFileSync(statePath, JSON.stringify({ ...state, formatVersion: 1 }));

    await withFetch(standardHandler().handler, async () => {
      const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
      assert.equal(result.outcome, 'edited');
      assert.equal(result.notified, true);
    });
  });
});

test('notifyResidentSpyTunnelUrl reports notified=false and falls back to the topic map lookup for topicId when unchanged', async () => {
  const root = setupProjectRoot();
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, async () => {
    await withFetch(standardHandler().handler, () => notifyResidentSpyTunnelUrl(root, LIVE_URL));
    // Second call with the identical URL/state is a genuine no-op (skipped-unchanged).
    const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
    assert.equal(result.outcome, 'skipped-unchanged');
    assert.equal(result.notified, false);
    assert.equal(result.topicId, TOPIC_ID);
  });
});

test('notifyResidentSpyTunnelUrl falls back to topicForSubject when the stored state has no topicId of its own', async () => {
  const root = setupProjectRoot();
  const opDir = path.join(root, '.swarmforge', 'operator');
  // A state with the SAME liveUrl/consoleUrl/formatVersion as would be
  // computed (so shouldNotifyResidentSpyTunnel says "unchanged") but no
  // topicId field - result.state.topicId ?? topicForSubject(...) must reach
  // for the topic map instead of returning undefined.
  const consoleUrl = LIVE_URL.replace('/resident-spy', '/console');
  fs.writeFileSync(
    path.join(opDir, 'resident-spy-tunnel-notify.json'),
    JSON.stringify({ liveUrl: LIVE_URL, consoleUrl, formatVersion: 4 })
  );
  await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, async () => {
    const result = await notifyResidentSpyTunnelUrl(root, LIVE_URL);
    assert.equal(result.outcome, 'skipped-unchanged');
    assert.equal(result.topicId, TOPIC_ID);
  });
});

// ── main() (BL-716 hardening: also zero coverage before this pass) ──────

function withProcessExit(run) {
  const previousExit = process.exit;
  const codes = [];
  process.exit = (code) => {
    codes.push(code);
    throw new Error(`__process_exit_${code}__`);
  };
  return run(codes).finally(() => {
    process.exit = previousExit;
  });
}

test('main() errors and exits 1 when --url is missing', async () => {
  await withProcessExit(async (codes) => {
    const previousError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
      await assert.rejects(() => main(['--project-root', setupProjectRoot()]));
    } finally {
      console.error = previousError;
    }
    assert.deepEqual(codes, [1]);
    assert.ok(errors.some((e) => e.includes('--url is required')));
  });
});

test('main() errors and exits 1 when --url is the last argument with no value', async () => {
  await withProcessExit(async (codes) => {
    const previousError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(() => main(['--project-root', setupProjectRoot(), '--url']));
    } finally {
      console.error = previousError;
    }
    assert.deepEqual(codes, [1]);
  });
});

test('main() reads --project-root, calls notifyResidentSpyTunnelUrl, and prints the JSON result without exiting on success', async () => {
  const root = setupProjectRoot();
  const previousLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
      withFetch(standardHandler().handler, () => main(['--url', LIVE_URL, '--project-root', root]))
    );
  } finally {
    console.log = previousLog;
  }
  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.outcome, 'posted');
});

test('main() exits 1 when notifyResidentSpyTunnelUrl reports a "failed*" outcome', async () => {
  const root = setupProjectRoot();
  const previousLog = console.log;
  console.log = () => {};
  try {
    await withProcessExit(async (codes) => {
      // Missing telegram config -> outcome 'skipped', not 'failed*' - use a
      // handler that fails ensureTopic instead: point at a project root with
      // NO topic map and a createForumTopic call that fails, forcing
      // 'failed-no-topic'.
      const emptyRoot = mkTmpDir('bl716-notify-resident-spy-empty-');
      fs.mkdirSync(path.join(emptyRoot, '.swarmforge', 'operator'), { recursive: true });
      await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
        withFetch(async (url, opts) => {
          const u = String(url);
          if (u.includes('/getMe')) {
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'SwarmForgeBot' } }) };
          }
          if (u.includes('/createForumTopic')) {
            return { ok: false, status: 400, json: async () => ({ ok: false, description: 'cannot create topic' }) };
          }
          throw new Error(`unexpected fetch: ${u}`);
        }, () => assert.rejects(() => main(['--url', LIVE_URL, '--project-root', emptyRoot])))
      );
      assert.deepEqual(codes, [1]);
      // A failed create must never write a bogus topic-map entry keyed by
      // an undefined message_thread_id.
      assert.equal(fs.existsSync(path.join(emptyRoot, '.swarmforge', 'operator', 'telegram-topic-map.json')), false);
    });
  } finally {
    console.log = previousLog;
  }
});

test('main() defaults argv to process.argv.slice(2) when called with no explicit args', async () => {
  const root = setupProjectRoot();
  const previousArgv = process.argv;
  const previousLog = console.log;
  console.log = () => {};
  process.argv = ['node', 'notify-resident-spy-tunnel.js', '--url', LIVE_URL, '--project-root', root];
  try {
    await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
      withFetch(standardHandler().handler, () => main())
    );
  } finally {
    process.argv = previousArgv;
    console.log = previousLog;
  }
});

test('main() resolves the project root by walking up to the nearest .swarmforge when --project-root is omitted', async () => {
  const root = setupProjectRoot();
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  const previousCwd = process.cwd;
  const previousLog = console.log;
  console.log = () => {};
  process.cwd = () => nested;
  try {
    await withEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID }, () =>
      withFetch(standardHandler().handler, () => main(['--url', LIVE_URL]))
    );
  } finally {
    process.cwd = previousCwd;
    console.log = previousLog;
  }
  assert.equal(readNotifyState(root).liveUrl, LIVE_URL);
});
