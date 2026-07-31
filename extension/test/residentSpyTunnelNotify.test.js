const assert = require('node:assert/strict');
const {
  buildResidentSpyMiniAppUrl,
  buildConsoleMiniAppUrl,
  consoleUrlFromLiveUrl,
  buildBubblePairingDeepLink,
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

test('buildBubblePairingDeepLink changes when the tunnel hostname changes', () => {
  const before = buildBubblePairingDeepLink('https://old-tunnel.trycloudflare.com/resident-spy?token=abc');
  const after = buildBubblePairingDeepLink('https://new-tunnel.trycloudflare.com/resident-spy?token=abc');
  assert.notEqual(before, after);
});

test('buildResidentSpyTunnelUrls includes the pairing deep link', () => {
  const urls = buildResidentSpyTunnelUrls('https://foo.trycloudflare.com', 'abc123');
  assert.equal(urls.pairingDeepLink, buildBubblePairingDeepLink(urls.liveUrl));
});

test('buildResidentSpyTunnelTopicButtons uses url buttons for group topics', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const buttons = buildResidentSpyTunnelTopicButtons({
    liveUrl: live,
    consoleUrl: consoleUrlFromLiveUrl(live),
    pairingDeepLink: buildBubblePairingDeepLink(live),
  });
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
  assert.equal(buttons[0][0].webAppUrl, consoleUrlFromLiveUrl(live));
  assert.equal(buttons[1][0].webAppUrl, live);
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
