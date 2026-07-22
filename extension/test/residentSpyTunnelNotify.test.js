const assert = require('node:assert/strict');
const {
  buildResidentSpyMiniAppUrl,
  buildConsoleMiniAppUrl,
  consoleUrlFromLiveUrl,
  buildResidentSpyTunnelTopicButtons,
  buildResidentSpyTunnelPrivateWebAppButtons,
  formatResidentSpyTunnelTopicMessage,
  shouldNotifyResidentSpyTunnel,
  shouldNotifyResidentSpyTunnelUrl,
  RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION,
  syncResidentSpyTunnelUrl,
} = require('../out/concierge/residentSpyTunnelNotify');

test('buildResidentSpyMiniAppUrl appends resident-spy path and token query', () => {
  assert.equal(
    buildResidentSpyMiniAppUrl('https://foo.trycloudflare.com/', 'abc123'),
    'https://foo.trycloudflare.com/resident-spy?token=abc123'
  );
});

test('buildConsoleMiniAppUrl appends console path and token query', () => {
  assert.equal(
    buildConsoleMiniAppUrl('https://foo.trycloudflare.com/', 'abc123'),
    'https://foo.trycloudflare.com/console?token=abc123'
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

test('buildResidentSpyTunnelTopicButtons uses url buttons for group topics', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const buttons = buildResidentSpyTunnelTopicButtons({
    liveUrl: live,
    consoleUrl: consoleUrlFromLiveUrl(live),
  });
  assert.equal(buttons[0][0].url, consoleUrlFromLiveUrl(live));
  assert.equal(buttons[0][0].webAppUrl, undefined);
});

test('buildResidentSpyTunnelPrivateWebAppButtons uses web_app for private chat', () => {
  const live = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  const buttons = buildResidentSpyTunnelPrivateWebAppButtons({
    liveUrl: live,
    consoleUrl: consoleUrlFromLiveUrl(live),
  });
  assert.equal(buttons[0][0].webAppUrl, consoleUrlFromLiveUrl(live));
  assert.equal(buttons[1][0].webAppUrl, live);
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
