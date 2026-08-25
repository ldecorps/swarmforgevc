const assert = require('node:assert/strict');
const { renderPanel } = require('./helpers/renderPanel');

// BL-421: renders the REAL webview HTML shell (getWebviewHtml) and evaluates
// the REAL media/panel.js source in jsdom, then asserts on the rendered
// decision-menu banner markup a browser would actually show - a resolved
// AskUserQuestion menu lingering in a tile's transcript must be visibly
// marked, not left indistinguishable from a live one (BL-068's precedent:
// a state-only unit test of the classifier is not proof the tile renders it).

const ALL_ROLES = [
  { role: 'specifier', displayName: 'Specifier', agent: 'claude' },
  { role: 'coder', displayName: 'Coder', agent: 'claude' },
];

function bannerEl(document, role) {
  const tile = document.querySelector(`.tile[data-role="${role}"]`);
  return tile.querySelector('.tile-decision-banner');
}

// BL-421 rendered-decision-banner-01
test('a live decision status renders a visible LIVE banner', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  dispatch({ type: 'decisionStatus', events: [{ role: 'specifier', status: 'live' }] });

  const banner = bannerEl(document, 'specifier');
  assert.ok(banner.classList.contains('visible'), 'the banner must be visible for a live decision');
  assert.ok(banner.classList.contains('live'), 'the banner must carry the live styling class');
  assert.ok(!banner.classList.contains('resolved'), 'a live banner must not also carry the resolved class');
  assert.match(banner.textContent, /awaiting/i, 'the banner text must say the decision is awaiting an answer');
});

// BL-421 rendered-decision-banner-02
test('a resolved decision status renders a visible RESOLVED banner, distinct from live', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  dispatch({ type: 'decisionStatus', events: [{ role: 'specifier', status: 'resolved' }] });

  const banner = bannerEl(document, 'specifier');
  assert.ok(banner.classList.contains('visible'), 'the banner must be visible for a resolved decision');
  assert.ok(banner.classList.contains('resolved'), 'the banner must carry the resolved styling class');
  assert.ok(!banner.classList.contains('live'), 'a resolved banner must not also carry the live class');
  assert.doesNotMatch(banner.textContent, /awaiting/i, 'resolved text must not read as an actionable prompt');
});

// BL-421 rendered-decision-banner-03
test('a none decision status shows no banner, and a prior banner clears once resolved to none', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  dispatch({ type: 'decisionStatus', events: [{ role: 'specifier', status: 'live' }] });
  assert.ok(bannerEl(document, 'specifier').classList.contains('visible'));

  dispatch({ type: 'decisionStatus', events: [{ role: 'specifier', status: 'none' }] });
  const banner = bannerEl(document, 'specifier');
  assert.ok(!banner.classList.contains('visible'), 'the banner must be hidden once the status clears to none');
  assert.ok(!banner.classList.contains('live'));
  assert.ok(!banner.classList.contains('resolved'));
});

// BL-421 rendered-decision-banner-04
test('a decision status for one role does not affect another role\'s tile', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  dispatch({ type: 'decisionStatus', events: [{ role: 'specifier', status: 'live' }] });

  const coderBanner = bannerEl(document, 'coder');
  assert.ok(!coderBanner.classList.contains('visible'), 'an unrelated tile must show no banner');
});
