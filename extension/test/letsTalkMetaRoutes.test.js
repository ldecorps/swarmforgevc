const assert = require('node:assert/strict');
const {
  buildLetsTalkMetaStatus,
  isLetsTalkMetaRoute,
  createLetsTalkMetaRoutes,
} = require('../out/bridge/letsTalkMetaRoutes');

// BL-763: see specs/features/BL-763-bubble-tunnel-hand-fixes-swarm-stamp.feature
// scenarios "meta-01"/"meta-02" for the human-readable contract this file
// exercises at the unit level.

test('buildLetsTalkMetaStatus: reports the given instanceId and startedAt verbatim', () => {
  const status = buildLetsTalkMetaStatus('abc-123', '2026-08-13T00:00:00.000Z');
  assert.deepEqual(status, { instanceId: 'abc-123', startedAt: '2026-08-13T00:00:00.000Z' });
});

// BL-763 meta-01
test('isLetsTalkMetaRoute: matches GET /lets-talk/meta only', () => {
  assert.equal(isLetsTalkMetaRoute({ method: 'GET' }, '/lets-talk/meta'), true);
  assert.equal(isLetsTalkMetaRoute({ method: 'GET' }, '/lets-talk/meta?bearer=x'), true);
  assert.equal(isLetsTalkMetaRoute({ method: 'POST' }, '/lets-talk/meta'), false);
  assert.equal(isLetsTalkMetaRoute({ method: 'GET' }, '/lets-talk/other'), false);
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

// BL-763 meta-01: a subsequent GET against the same process returns the same instanceId.
test('createLetsTalkMetaRoutes: repeated GETs return the identical instanceId + startedAt', () => {
  const routes = createLetsTalkMetaRoutes('fixed-instance-id', '2026-08-13T00:00:00.000Z', () => true, respondJson);
  const route = routes.find((r) => r.matches({ method: 'GET' }, '/lets-talk/meta'));
  assert.ok(route);
  for (let i = 0; i < 5; i++) {
    const res = fakeRes();
    route.handle({ method: 'GET' }, res, '/target', {});
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.instanceId, 'fixed-instance-id');
    assert.equal(body.startedAt, '2026-08-13T00:00:00.000Z');
  }
});

test('createLetsTalkMetaRoutes: refuses when requireAuth fails, never reaching respond with meta', () => {
  const requireAuth = (req, res) => {
    respondJson(res, 401, { success: false, reason: 'unauthorized' });
    return false;
  };
  const routes = createLetsTalkMetaRoutes('id-1', 'started-1', requireAuth, respondJson);
  const route = routes[0];
  const res = fakeRes();
  route.handle({ method: 'GET' }, res, '/target', {});
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.success, false);
});

// BL-763 meta-02: the route reflects whatever instanceId it was constructed
// with verbatim — two routes built with different instanceIds (as two
// separate bridge process starts, i.e. a bounce, would produce) never
// report the same value. The actual per-process uniqueness guarantee (real
// instanceId generation) is exercised end-to-end in bridgeServer.test.js.
test('createLetsTalkMetaRoutes: a differently-constructed instanceId is reported, not memoized globally', () => {
  const routesA = createLetsTalkMetaRoutes('instance-A', 'started-A', () => true, respondJson);
  const routesB = createLetsTalkMetaRoutes('instance-B', 'started-B', () => true, respondJson);
  const resA = fakeRes();
  routesA[0].handle({ method: 'GET' }, resA, '/target', {});
  const resB = fakeRes();
  routesB[0].handle({ method: 'GET' }, resB, '/target', {});
  assert.notEqual(JSON.parse(resA.body).instanceId, JSON.parse(resB.body).instanceId);
});
