const assert = require('node:assert/strict');
const {
  buildResidentSpyMiniAppUrl,
  buildConsoleMiniAppUrl,
  consoleUrlFromLiveUrl,
  buildBubblePairingDeepLink,
  buildBubblePairingHttpsUrl,
  buildResidentSpyTunnelUrls,
  buildResidentSpyTunnelTopicButtons,
  buildResidentSpyTunnelPrivateWebAppButtons,
  formatResidentSpyTunnelTopicMessage,
  shouldNotifyResidentSpyTunnel,
  shouldNotifyResidentSpyTunnelUrl,
  RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION,
  syncResidentSpyTunnelUrl,
} = require('../out/concierge/residentSpyTunnelNotify');

test('buildResidentSpyMiniAppUrl appends resident-spy path and bearer query', () => {
  assert.equal(
    buildResidentSpyMiniAppUrl('https://foo.trycloudflare.com/', 'abc123'),
    'https://foo.trycloudflare.com/resident-spy?bearer=abc123'
  );
});

test('buildConsoleMiniAppUrl appends console path and bearer query', () => {
  assert.equal(
    buildConsoleMiniAppUrl('https://foo.trycloudflare.com/', 'abc123'),
    'https://foo.trycloudflare.com/console?bearer=abc123'
  );
});

test('consoleUrlFromLiveUrl rewrites the path to /console', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  assert.equal(consoleUrlFromLiveUrl(live), 'https://foo.trycloudflare.com/console?token=abc');
});

test('formatResidentSpyTunnelTopicMessage explains private bot menu and omits raw URL', () => {
  const text = formatResidentSpyTunnelTopicMessage('SwarmForgeBot');
  assert.match(text, /@SwarmForgeBot/);
  assert.match(text, /menu button/i);
  assert.doesNotMatch(text, /https:\/\//);
});

test('formatResidentSpyTunnelTopicMessage renders the exact message body with a bot username', () => {
  assert.equal(
    formatResidentSpyTunnelTopicMessage('SwarmForgeBot'),
    [
      'SwarmForge phone console',
      '',
      'In Telegram (recommended): open a private chat with @SwarmForgeBot, then tap the menu button (☰) next to the message field.',
      'That opens inside Telegram with fullscreen support.',
      '',
      'Browser fallback: tap the button below.',
      '',
      'Bubble pairing stale? Tap "Update Bubble pairing" to re-pair without hunting logs.',
    ].join('\n')
  );
});

test('formatResidentSpyTunnelTopicMessage falls back to "the front-desk bot" when no botUsername is given', () => {
  const text = formatResidentSpyTunnelTopicMessage();
  assert.match(text, /open a private chat with the front-desk bot,/);
});

test('formatResidentSpyTunnelTopicMessage mentions the Bubble re-pair button (BL-716 dns-05)', () => {
  const text = formatResidentSpyTunnelTopicMessage();
  assert.match(text, /Update Bubble pairing/);
});

test('buildBubblePairingDeepLink builds a swarmforge-bubble pair URI from the live URL and its token', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc123';
  assert.equal(
    buildBubblePairingDeepLink(live),
    'swarmforge-bubble://pair?url=https%3A%2F%2Ffoo.trycloudflare.com&token=abc123'
  );
});

test('buildBubblePairingDeepLink falls back to a bearer query param', () => {
  const live = 'https://foo.trycloudflare.com/console?bearer=xyz';
  assert.equal(
    buildBubblePairingDeepLink(live),
    'swarmforge-bubble://pair?url=https%3A%2F%2Ffoo.trycloudflare.com&token=xyz'
  );
});

test('buildBubblePairingDeepLink defaults token to empty string when neither token nor bearer is present', () => {
  assert.equal(
    buildBubblePairingDeepLink('https://foo.trycloudflare.com/resident-spy'),
    'swarmforge-bubble://pair?url=https%3A%2F%2Ffoo.trycloudflare.com&token='
  );
});

test('buildBubblePairingDeepLink changes when the tunnel hostname changes', () => {
  const before = buildBubblePairingDeepLink('https://old-tunnel.trycloudflare.com/resident-spy?token=abc');
  const after = buildBubblePairingDeepLink('https://new-tunnel.trycloudflare.com/resident-spy?token=abc');
  assert.notEqual(before, after);
});

test('buildResidentSpyTunnelUrls includes the pairing deep link', () => {
  const urls = buildResidentSpyTunnelUrls('https://foo.trycloudflare.com', 'abc123');
  assert.equal(urls.pairingDeepLink, buildBubblePairingDeepLink(urls.liveUrl));
});

// BL-788: the bridge's own pre-auth /pair page (always openable in a
// browser), as distinct from pairingDeepLink's bare custom-scheme URI
// (which fails silently with no fallback when Bubble is not installed).
test('buildBubblePairingHttpsUrl builds an HTTPS /pair URL on the tunnel origin, carrying the token', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc123';
  assert.equal(buildBubblePairingHttpsUrl(live), 'https://foo.trycloudflare.com/pair?token=abc123');
});

test('buildBubblePairingHttpsUrl falls back to a bearer query param', () => {
  const live = 'https://foo.trycloudflare.com/console?bearer=xyz';
  assert.equal(buildBubblePairingHttpsUrl(live), 'https://foo.trycloudflare.com/pair?token=xyz');
});

test('buildBubblePairingHttpsUrl defaults token to empty string when neither token nor bearer is present', () => {
  assert.equal(
    buildBubblePairingHttpsUrl('https://foo.trycloudflare.com/resident-spy'),
    'https://foo.trycloudflare.com/pair?token='
  );
});

test('buildResidentSpyTunnelUrls includes the HTTPS pairing URL', () => {
  const urls = buildResidentSpyTunnelUrls('https://foo.trycloudflare.com', 'abc123');
  assert.equal(urls.pairingHttpsUrl, buildBubblePairingHttpsUrl(urls.liveUrl));
  assert.match(urls.pairingHttpsUrl, /^https:\/\//);
  assert.match(urls.pairingHttpsUrl, /token=abc123$/);
});

test('buildResidentSpyTunnelTopicButtons uses url buttons for group topics', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const buttons = buildResidentSpyTunnelTopicButtons({
    liveUrl: live,
    consoleUrl: consoleUrlFromLiveUrl(live),
    pairingDeepLink: buildBubblePairingDeepLink(live),
  });
  assert.equal(buttons[0][0].text, 'Open in browser');
  assert.equal(buttons[0][0].url, consoleUrlFromLiveUrl(live));
  assert.equal(buttons[0][0].webAppUrl, undefined);
  assert.equal(buttons[1][0].text, 'Update Bubble pairing');
  assert.equal(buttons[1][0].url, buildBubblePairingDeepLink(live));
});

test('buildResidentSpyTunnelPrivateWebAppButtons uses web_app for private chat plus a plain-url re-pair button', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const buttons = buildResidentSpyTunnelPrivateWebAppButtons({
    liveUrl: live,
    consoleUrl: consoleUrlFromLiveUrl(live),
    pairingDeepLink: buildBubblePairingDeepLink(live),
  });
  assert.equal(buttons[0][0].text, 'Open console');
  assert.equal(buttons[0][0].webAppUrl, consoleUrlFromLiveUrl(live));
  assert.equal(buttons[1][0].text, 'Live screen');
  assert.equal(buttons[1][0].webAppUrl, live);
  assert.equal(buttons[2][0].text, 'Update Bubble pairing');
  assert.equal(buttons[2][0].url, buildBubblePairingDeepLink(live));
  assert.equal(buttons[2][0].webAppUrl, undefined);
});

test('shouldNotifyResidentSpyTunnel is true when the URL changed or format version is stale', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const urls = { liveUrl: live, consoleUrl: consoleUrlFromLiveUrl(live) };
  assert.equal(shouldNotifyResidentSpyTunnel(undefined, urls), true);
  assert.equal(
    shouldNotifyResidentSpyTunnel(
      { liveUrl: live, consoleUrl: urls.consoleUrl, formatVersion: RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION },
      urls
    ),
    false
  );
  assert.equal(shouldNotifyResidentSpyTunnel({ url: live }, urls), true);
});

test('shouldNotifyResidentSpyTunnel derives consoleUrl from the legacy url field (not just the modern consoleUrl field) and still says unchanged once formatVersion is current', () => {
  // Distinguishes the `prev.consoleUrl ?? (liveUrl ? consoleUrlFromLiveUrl(liveUrl) : undefined)`
  // fallback from a `&&` mutant: with no prev.consoleUrl but a legacy `url`
  // and a current formatVersion, only the real `??` fallback derives a
  // consoleUrl that MATCHES urls.consoleUrl and returns false (unchanged).
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const urls = { liveUrl: live, consoleUrl: consoleUrlFromLiveUrl(live) };
  assert.equal(
    shouldNotifyResidentSpyTunnel({ url: live, formatVersion: RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION }, urls),
    false
  );
});

test('shouldNotifyResidentSpyTunnel is true when only the liveUrl changed (consoleUrl still matches)', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prev = { liveUrl: 'https://old.trycloudflare.com/resident-spy?token=abc', consoleUrl: consoleUrlFromLiveUrl(live), formatVersion: RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION };
  const urls = { liveUrl: live, consoleUrl: consoleUrlFromLiveUrl(live) };
  assert.equal(shouldNotifyResidentSpyTunnel(prev, urls), true);
});

test('shouldNotifyResidentSpyTunnel is true when only the consoleUrl changed (liveUrl still matches)', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prev = { liveUrl: live, consoleUrl: 'https://old.trycloudflare.com/console?token=abc', formatVersion: RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION };
  const urls = { liveUrl: live, consoleUrl: consoleUrlFromLiveUrl(live) };
  assert.equal(shouldNotifyResidentSpyTunnel(prev, urls), true);
});

test('shouldNotifyResidentSpyTunnelUrl remains compatible with live URL only', () => {
  const url = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  assert.equal(shouldNotifyResidentSpyTunnelUrl(undefined, url), true);
  assert.equal(shouldNotifyResidentSpyTunnelUrl(url, url), false);
});

test('syncResidentSpyTunnelUrl posts topic buttons on first notify', async () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  let posted;
  const result = await syncResidentSpyTunnelUrl(
    live,
    undefined,
    {
      ensureTopic: async () => 42,
      postMessage: async (topicId, text, buttons) => {
        posted = { topicId, text, buttons };
        return 99;
      },
      editMessage: async () => false,
    },
    { botUsername: 'SwarmForgeBot' }
  );
  assert.equal(result.outcome, 'posted');
  assert.equal(result.state.messageId, 99);
  assert.equal(posted.topicId, 42);
  assert.equal(posted.buttons[0][0].url, consoleUrlFromLiveUrl(live));
});

test('syncResidentSpyTunnelUrl returns failed-no-topic and leaves prevState untouched when ensureTopic cannot resolve a topic id', async () => {
  const prevState = { topicId: 1, liveUrl: 'https://old.trycloudflare.com', messageId: 5 };
  const result = await syncResidentSpyTunnelUrl(
    'https://foo.trycloudflare.com/resident-spy?token=abc',
    prevState,
    {
      ensureTopic: async () => undefined,
      postMessage: async () => { throw new Error('must not post'); },
      editMessage: async () => { throw new Error('must not edit'); },
    }
  );
  assert.equal(result.outcome, 'failed-no-topic');
  assert.equal(result.state, prevState);
});

test('syncResidentSpyTunnelUrl edits the existing message in place when the topic and message are unchanged', async () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prevState = { topicId: 42, messageId: 99, liveUrl: 'https://old.trycloudflare.com', consoleUrl: 'https://old.trycloudflare.com/console' };
  let edited;
  const result = await syncResidentSpyTunnelUrl(
    live,
    prevState,
    {
      ensureTopic: async () => 42,
      postMessage: async () => { throw new Error('must not post'); },
      editMessage: async (topicId, messageId, text, buttons) => {
        edited = { topicId, messageId, text, buttons };
        return true;
      },
    }
  );
  assert.equal(result.outcome, 'edited');
  assert.equal(result.state.messageId, 99);
  assert.equal(result.state.liveUrl, live);
  assert.equal(edited.topicId, 42);
  assert.equal(edited.messageId, 99);
});

test('syncResidentSpyTunnelUrl re-posts and deletes the stale message when the edit fails', async () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prevState = { topicId: 42, messageId: 99, liveUrl: 'https://old.trycloudflare.com', consoleUrl: 'https://old.trycloudflare.com/console' };
  let deletedMessageId;
  let posted;
  const result = await syncResidentSpyTunnelUrl(
    live,
    prevState,
    {
      ensureTopic: async () => 42,
      postMessage: async (topicId, text, buttons) => {
        posted = { topicId, text, buttons };
        return 200;
      },
      editMessage: async () => false,
      deleteMessage: async (messageId) => {
        deletedMessageId = messageId;
        return true;
      },
    }
  );
  assert.equal(result.outcome, 'posted');
  assert.equal(result.state.messageId, 200);
  assert.equal(deletedMessageId, 99);
  assert.equal(posted.topicId, 42);
});

test('syncResidentSpyTunnelUrl re-posts without attempting a delete when the adapters carry no deleteMessage', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prevState = { topicId: 42, messageId: 99, liveUrl: 'https://old.trycloudflare.com', consoleUrl: 'https://old.trycloudflare.com/console' };
  return syncResidentSpyTunnelUrl(
    live,
    prevState,
    {
      ensureTopic: async () => 42,
      postMessage: async () => 200,
      editMessage: async () => false,
      // deleteMessage intentionally omitted - `if (adapters.deleteMessage)`
      // must actually gate the call, not just be present-but-truthy in
      // every other test.
    }
  ).then((result) => {
    assert.equal(result.outcome, 'posted');
    assert.equal(result.state.messageId, 200);
  });
});

test('syncResidentSpyTunnelUrl returns the exact prevState object (not a fresh {}) when the notify is a genuine no-op', async () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prevState = {
    topicId: 42,
    messageId: 99,
    liveUrl: live,
    consoleUrl: consoleUrlFromLiveUrl(live),
    formatVersion: RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION,
  };
  const result = await syncResidentSpyTunnelUrl(live, prevState, {
    ensureTopic: async () => { throw new Error('must not ensure a topic when unchanged'); },
    postMessage: async () => { throw new Error('must not post when unchanged'); },
    editMessage: async () => { throw new Error('must not edit when unchanged'); },
  });
  assert.equal(result.outcome, 'skipped-unchanged');
  assert.equal(result.state, prevState);
  assert.equal(result.state.messageId, 99);
});

test('syncResidentSpyTunnelUrl reports failed-edit and keeps prevState when both the edit and the fallback repost fail', async () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prevState = { topicId: 42, messageId: 99, liveUrl: 'https://old.trycloudflare.com', consoleUrl: 'https://old.trycloudflare.com/console' };
  const result = await syncResidentSpyTunnelUrl(
    live,
    prevState,
    {
      ensureTopic: async () => 42,
      postMessage: async () => undefined,
      editMessage: async () => false,
      deleteMessage: async () => { throw new Error('must not delete when repost failed'); },
    }
  );
  assert.equal(result.outcome, 'failed-edit');
  assert.equal(result.state, prevState);
});

test('syncResidentSpyTunnelUrl posts fresh (does not edit) when the topic was reminted to a different id', async () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const prevState = { topicId: 1, messageId: 99, liveUrl: 'https://old.trycloudflare.com', consoleUrl: 'https://old.trycloudflare.com/console' };
  let posted;
  const result = await syncResidentSpyTunnelUrl(
    live,
    prevState,
    {
      ensureTopic: async () => 2,
      postMessage: async (topicId, text, buttons) => {
        posted = { topicId };
        return 300;
      },
      editMessage: async () => { throw new Error('must not edit a reminted topic'); },
    }
  );
  assert.equal(result.outcome, 'posted');
  assert.equal(posted.topicId, 2);
  assert.equal(result.state.messageId, 300);
});

test('syncResidentSpyTunnelUrl returns failed-post (undefined messageId) and preserves state fields when the first post fails', async () => {
  const result = await syncResidentSpyTunnelUrl(
    'https://foo.trycloudflare.com/resident-spy?token=abc',
    undefined,
    {
      ensureTopic: async () => 42,
      postMessage: async () => undefined,
      editMessage: async () => false,
    }
  );
  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.state.messageId, undefined);
  assert.equal(result.state.topicId, 42);
});
