const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildResidentSpyMiniAppUrl,
  formatResidentSpyTunnelTopicMessage,
  shouldNotifyResidentSpyTunnelUrl,
} = require('../out/concierge/residentSpyTunnelNotify');

test('buildResidentSpyMiniAppUrl appends resident-spy path and token query', () => {
  assert.equal(
    buildResidentSpyMiniAppUrl('https://foo.trycloudflare.com/', 'abc123'),
    'https://foo.trycloudflare.com/resident-spy?token=abc123'
  );
});

test('formatResidentSpyTunnelTopicMessage includes the full URL on its own line', () => {
  const url = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  assert.match(formatResidentSpyTunnelTopicMessage(url), /Live feed \(Mini App\):/);
  assert.match(formatResidentSpyTunnelTopicMessage(url), new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('shouldNotifyResidentSpyTunnelUrl is true only when the URL changed', () => {
  const url = 'https://foo.trycloudflare.com/resident-spy?token=abc';
  assert.equal(shouldNotifyResidentSpyTunnelUrl(undefined, url), true);
  assert.equal(shouldNotifyResidentSpyTunnelUrl(url, url), false);
  assert.equal(
    shouldNotifyResidentSpyTunnelUrl(url, 'https://bar.trycloudflare.com/resident-spy?token=abc'),
    true
  );
});
