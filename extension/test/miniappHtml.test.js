const assert = require('node:assert/strict');
const { buildResidentSpyHtml } = require('../out/bridge/miniappHtml');

const STATE = {
  pipeline: [
    { role: 'coder', displayName: 'Coder', status: 'active' },
    { role: 'cleaner', displayName: 'Cleaner', status: 'idle' },
  ],
  agents: [],
  backlog: { active: [], paused: [], done: [] },
  runLog: [],
};

test('resident spy menu exposes pipeline-grid and mono-router feed buttons on a phone-safe page', () => {
  const html = buildResidentSpyHtml(STATE, { token: 'tok 1' });

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /data-testid="pipeline-grid-button"/);
  assert.match(html, /href="\/resident-spy\?view=pipeline&amp;token=tok\+1"/);
  assert.match(html, /data-testid="mono-router-feed-button"/);
  assert.match(html, /href="\/resident-spy\?view=mono-router-feed&amp;token=tok\+1"/);
  assert.match(html, /overflow-x: hidden/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /overflow-wrap: anywhere/);
});

test('pipeline destination renders the status grid without the below-grid links section', () => {
  const html = buildResidentSpyHtml(STATE, { view: 'pipeline', token: 'tok' });

  assert.match(html, /data-testid="pipeline-status-grid"/);
  assert.match(html, /STATUS GRID/);
  assert.match(html, /Coder/);
  assert.match(html, /active/);
  assert.doesNotMatch(html, /below-grid-links/);
});

test('mono-router destination renders a resident live feed backed by bridge events', () => {
  const html = buildResidentSpyHtml(STATE, { view: 'mono-router-feed', token: 'tok' });

  assert.match(html, /data-testid="mono-router-resident-feed"/);
  assert.match(html, /mono-router RESIDENT/);
  assert.match(html, /new EventSource\("\/events\?token=tok"\)/);
  assert.match(html, /data-testid="resident-feed-log"/);
});

test('mono-router destination omits an empty event query string when no token is present', () => {
  const html = buildResidentSpyHtml(STATE, { view: 'mono-router-feed' });

  assert.match(html, /new EventSource\("\/events"\)/);
  assert.doesNotMatch(html, /new EventSource\("\/events\?"/);
});
