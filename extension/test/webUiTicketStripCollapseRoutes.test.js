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
  assert.equal(isWebUiTicketStripCollapsedWriteRoute({ method: 'PUT' }, '/some-other-path'), false);
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
  assert.deepEqual(JSON.parse(res.body), { success: false, reason: 'expected surface query parameter' });
});

// BL-1542 hardener: exercises the `req.url ?? '/'` fallback and confirms
// a missing url still refuses cleanly rather than throwing.
test('read route: a missing req.url falls back to "/" and refuses for want of a surface', () => {
  const root = mkRoot();
  const routes = createWebUiTicketStripCollapsedRoutes(
    () => true,
    respondJson,
    () => Promise.resolve(null)
  );
  const route = routes.find((r) => r.matches({ method: 'GET' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  route.handle({ method: 'GET', url: undefined }, res, root, {});
  assert.equal(res.statusCode, 400);
});

test('write route: never reaches respond when requireControlAuth refuses', async () => {
  const root = mkRoot();
  const requireAuth = (req, res) => {
    respondJson(res, 401, { success: false, reason: 'unauthorized' });
    return false;
  };
  const readValidatedBody = () => Promise.resolve({ surface: 'live-screen', collapsed: true });
  const routes = createWebUiTicketStripCollapsedRoutes(requireAuth, respondJson, readValidatedBody);
  const route = routes.find((r) => r.matches({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  await route.handle({ method: 'PUT', url: '/web-ui-ticket-strip-collapsed' }, res, root, {});
  assert.equal(res.statusCode, 401);
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' }, 'auth refusal must not persist a write');
});

// BL-1542 hardener: pins the EXACT arguments the write route passes to
// readValidatedBody - the max-body-byte budget, the real shape validator
// (by identity, not merely "a function"), and the error reason string -
// so a mutant swapping any one of them (e.g. the wrong isShape function,
// or an empty error string) is caught here rather than only downstream.
test('write route: calls readValidatedBody with the exact max-bytes budget, the real shape validator, and its own error reason', async () => {
  const root = mkRoot();
  const {
    isWebUiTicketStripCollapsedWriteRequestShape,
  } = require('../out/bridge/webUiFontSizePreference');
  const {
    WEB_UI_TICKET_STRIP_COLLAPSED_WRITE_MAX_BODY_BYTES,
  } = require('../out/bridge/webUiTicketStripCollapseRoutes');
  let seenArgs = null;
  const readValidatedBody = (req, res, maxBytes, isShape, shapeErrorReason) => {
    seenArgs = { maxBytes, isShape, shapeErrorReason };
    return Promise.resolve(null);
  };
  const routes = createWebUiTicketStripCollapsedRoutes(() => true, respondJson, readValidatedBody);
  const route = routes.find((r) => r.matches({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  await route.handle({ method: 'PUT', url: '/web-ui-ticket-strip-collapsed' }, res, root, {});
  assert.equal(seenArgs.maxBytes, WEB_UI_TICKET_STRIP_COLLAPSED_WRITE_MAX_BODY_BYTES);
  assert.equal(seenArgs.isShape, isWebUiTicketStripCollapsedWriteRequestShape);
  assert.equal(seenArgs.shapeErrorReason, 'expected a JSON body of {surface, collapsed}');
});

// BL-1542 hardener: distinguishes startsWith from a mutant weakening it
// (e.g. endsWith, or matching any substring) - a URL that CONTAINS the
// path as a suffix but does not START with it must not match.
test('route matchers: a URL carrying the path as a SUFFIX, not a prefix, does not match', () => {
  assert.equal(isWebUiTicketStripCollapsedReadRoute({ method: 'GET' }, '/other/web-ui-ticket-strip-collapsed'), false);
  assert.equal(isWebUiTicketStripCollapsedPath('/other/web-ui-ticket-strip-collapsed'), false);
});

test('route matchers: a query-string suffix that is not "?" (e.g. no separator at all) does not match', () => {
  assert.equal(isWebUiTicketStripCollapsedReadRoute({ method: 'GET' }, '/web-ui-ticket-strip-collapsedX'), false);
  assert.equal(isWebUiTicketStripCollapsedPath('/web-ui-ticket-strip-collapsedX'), false);
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

// BL-1542 hardener: surfaceFromUrl's `url.includes('?') ? ... : ''`
// ternary decides whether to slice from the '?' or treat the WHOLE url as
// the query string. A mutant that always takes the "has '?'" branch
// (`.includes("")` is always true) is indistinguishable for every
// '?'-bearing or ordinary '?'-free URL this suite already exercises,
// because slicing from index 0 of a real request path never happens to
// contain "surface=". A URL with NO '?' but a literal '&surface=...'
// segment discriminates: URLSearchParams treats the whole string as one
// query, and "&" splits it into two pairs, one of which IS "surface=...".
test('read route: a URL with no "?" is NEVER parsed as a query, even when it contains a literal "&surface=" segment (surfaceFromUrl branch pin)', () => {
  // Deliberately calling handle() directly rather than via `matches` -
  // this URL has no '?' so the route matcher itself would not select it
  // for real traffic; the point is to pin surfaceFromUrl's OWN branch,
  // which handle() reaches regardless of how it was dispatched.
  //
  // The correct behaviour is 400: with no '?', the query must be treated
  // as EMPTY, never as the whole url string. A mutant that always takes
  // the "has '?'" branch (`url.includes("")` is always true) would instead
  // slice from index 0 - the whole url - and URLSearchParams would then
  // split on '&' and find "surface=live-screen", wrongly returning 200.
  const root = mkRoot();
  const routes = createWebUiTicketStripCollapsedRoutes(() => true, respondJson, () => Promise.resolve(null));
  const readRoute = routes[0];
  const res = fakeRes();
  readRoute.handle({ method: 'GET', url: '/web-ui-ticket-strip-collapsed&surface=live-screen' }, res, root, {});
  assert.equal(res.statusCode, 400);
});

// BL-1542 hardener: writeWebUiTicketStripCollapsed's own `collapsed must
// be a boolean` guard is unreachable through the REAL shape validator (it
// already requires `typeof collapsed === 'boolean'`), but the route's
// `readValidatedBody` is injected, so a test double can resolve a
// non-boolean `collapsed` at runtime (JS enforces nothing the TypeScript
// signature promises) and reach the route's own `!write.ok` branch.
test('write route: a non-boolean collapsed value from a test double reaches the write-failure branch and responds 400 with its reason', async () => {
  const root = mkRoot();
  const readValidatedBody = () => Promise.resolve({ surface: 'live-screen', collapsed: 'not-a-boolean' });
  const routes = createWebUiTicketStripCollapsedRoutes(() => true, respondJson, readValidatedBody);
  const route = routes.find((r) => r.matches({ method: 'PUT' }, '/web-ui-ticket-strip-collapsed'));
  const res = fakeRes();
  await route.handle({ method: 'PUT', url: '/web-ui-ticket-strip-collapsed' }, res, root, {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { success: false, reason: 'collapsed must be a boolean' });
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' }, 'a failed write must persist nothing');
});
