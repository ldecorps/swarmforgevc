const assert = require('node:assert/strict');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  isWebUiTicketStripCollapsedReadRoute,
  isWebUiTicketStripCollapsedWriteRoute,
  isWebUiTicketStripCollapsedPath,
  createWebUiTicketStripCollapsedRoutes,
} = require('../out/bridge/webUiTicketStripCollapseRoutes');
const { writeWebUiTicketStripCollapsed, readWebUiTicketStripCollapsed } = require('../out/bridge/webUiFontSizePreference');

// BL-1542: GET/PUT /web-ui-ticket-strip-collapsed unit coverage, same shape
// letsTalkMetaRoutes.test.js and webUiFontSizePreference.test.js already
// use for their own siblings.

test('isWebUiTicketStripCollapsedReadRoute: matches GET only, with or without a query', () => {
  assert.equal(isWebUiTicketStripCollapsedReadRoute({ method: 'GET' }, '/web-ui-ticket-strip-collapsed'), true);
  assert.equal(
    isWebUiTicketStripCollapsedReadRoute({ method: 'GET' }, '/web-ui-ticket-strip-collapsed?surface=live-screen'),
    true
  );
  assert.equal(isWebUiTicketStripCollapsedReadRoute({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'), false);
  assert.equal(isWebUiTicketStripCollapsedReadRoute({ method: 'GET' }, '/web-ui-font-size'), false);
});

test('isWebUiTicketStripCollapsedWriteRoute: matches PUT only', () => {
  assert.equal(isWebUiTicketStripCollapsedWriteRoute({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'), true);
  assert.equal(isWebUiTicketStripCollapsedWriteRoute({ method: 'GET' }, '/web-ui-ticket-strip-collapsed'), false);
});

test('isWebUiTicketStripCollapsedPath: matches the bare path and the query-string form', () => {
  assert.equal(isWebUiTicketStripCollapsedPath('/web-ui-ticket-strip-collapsed'), true);
  assert.equal(isWebUiTicketStripCollapsedPath('/web-ui-ticket-strip-collapsed?surface=live-screen'), true);
  assert.equal(isWebUiTicketStripCollapsedPath('/web-ui-font-size'), false);
});

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: undefined };
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers;
  };
  res.end = (body) => {
    res.body = body;
  };
  return res;
}

function respondJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function mkRoot() {
  return mkTmpDir('sfvc-web-ui-ticket-strip-routes-');
}

test('read route: defaults to collapsed:false with no stored preference', () => {
  const root = mkRoot();
  const readValidatedBody = () => Promise.resolve(null);
  const routes = createWebUiTicketStripCollapsedRoutes(() => true, respondJson, readValidatedBody);
  const route = routes.find((r) => r.matches({ method: 'GET' }, '/web-ui-ticket-strip-collapsed?surface=live-screen'));
  const res = fakeRes();
  route.handle({ method: 'GET', url: '/web-ui-ticket-strip-collapsed?surface=live-screen' }, res, root, {});
  const body = JSON.parse(res.body);
  assert.deepEqual(body, { success: true, surface: 'live-screen', collapsed: false });
});

test('read route: reports a stored true value', () => {
  const root = mkRoot();
  writeWebUiTicketStripCollapsed(root, 'live-screen', true);
  const routes = createWebUiTicketStripCollapsedRoutes(
    () => true,
    respondJson,
    () => Promise.resolve(null)
  );
  const route = routes.find((r) => r.matches({ method: 'GET' }, '/web-ui-ticket-strip-collapsed?surface=live-screen'));
  const res = fakeRes();
  route.handle({ method: 'GET', url: '/web-ui-ticket-strip-collapsed?surface=live-screen' }, res, root, {});
  assert.deepEqual(JSON.parse(res.body), { success: true, surface: 'live-screen', collapsed: true });
});

test('read route: refuses with 400 when no surface query parameter is given', () => {
  const root = mkRoot();
  const routes = createWebUiTicketStripCollapsedRoutes(
    () => true,
    respondJson,
    () => Promise.resolve(null)
  );
  const route = routes.find((r) => r.matches({ method: 'GET' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  route.handle({ method: 'GET', url: '/web-ui-ticket-strip-collapsed' }, res, root, {});
  assert.equal(res.statusCode, 400);
});

test('read route: never reaches respond when requireControlAuth refuses', () => {
  const root = mkRoot();
  const requireAuth = (req, res) => {
    respondJson(res, 401, { success: false, reason: 'unauthorized' });
    return false;
  };
  const routes = createWebUiTicketStripCollapsedRoutes(requireAuth, respondJson, () => Promise.resolve(null));
  const route = routes.find((r) => r.matches({ method: 'GET' }, '/web-ui-ticket-strip-collapsed?surface=live-screen'));
  const res = fakeRes();
  route.handle({ method: 'GET', url: '/web-ui-ticket-strip-collapsed?surface=live-screen' }, res, root, {});
  assert.equal(res.statusCode, 401);
});

test('write route: persists and echoes the written value', async () => {
  const root = mkRoot();
  const readValidatedBody = () => Promise.resolve({ surface: 'live-screen', collapsed: true });
  const routes = createWebUiTicketStripCollapsedRoutes(() => true, respondJson, readValidatedBody);
  const route = routes.find((r) => r.matches({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  await route.handle({ method: 'PUT', url: '/web-ui-ticket-strip-collapsed' }, res, root, {});
  assert.deepEqual(JSON.parse(res.body), { success: true, surface: 'live-screen', collapsed: true });
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'stored', collapsed: true });
});

test('write route: a rejected body shape never reaches respond (readValidatedBody already refused)', async () => {
  const root = mkRoot();
  const readValidatedBody = (req, res) => {
    respondJson(res, 400, { success: false, reason: 'bad shape' });
    return Promise.resolve(null);
  };
  const routes = createWebUiTicketStripCollapsedRoutes(() => true, respondJson, readValidatedBody);
  const route = routes.find((r) => r.matches({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  await route.handle({ method: 'PUT', url: '/web-ui-ticket-strip-collapsed' }, res, root, {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' });
});
