const assert = require('node:assert/strict');
const fc = require('fast-check');
const { randomUUID } = require('node:crypto');
const { createLetsTalkMetaRoutes } = require('../out/bridge/letsTalkMetaRoutes');

// BL-763 invariant 1 (BL-654 coder-authored): "GET /lets-talk/meta on a live
// bridge returns a stable instanceId for that process lifetime; a bounce
// yields a different instanceId." Split into the two halves a real process
// actually produces: (a) createLetsTalkMetaRoutes serves whatever
// instanceId/startedAt it was constructed with, verbatim, across ANY number
// of repeated requests within that construction ("that process lifetime");
// (b) randomUUID() — the exact generator bridgeServer.ts's startBridge()
// calls once per process start (see letsTalkMetaRoutes wiring, BL-763) — never
// repeats across many independent calls ("a bounce", i.e. a fresh
// startBridge() call, yields a different value). Runs ONLY via
// `npm run test:properties`.

function fakeRes() {
  const res = { statusCode: 0, body: undefined };
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.end = (body) => {
    res.body = body;
  };
  return res;
}

function respondJson(res, status, body) {
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

const idArb = fc.stringMatching(/^[a-zA-Z0-9-]{1,36}$/);
const startedAtArb = fc.stringMatching(/^[0-9TZ:.-]{1,32}$/);

test('property: createLetsTalkMetaRoutes serves the constructed instanceId/startedAt verbatim across any number of repeated GETs', () => {
  fc.assert(
    fc.property(idArb, startedAtArb, fc.integer({ min: 1, max: 50 }), (instanceId, startedAt, repeats) => {
      const routes = createLetsTalkMetaRoutes(instanceId, startedAt, () => true, respondJson);
      const route = routes.find((r) => r.matches({ method: 'GET' }, '/lets-talk/meta'));
      for (let i = 0; i < repeats; i++) {
        const res = fakeRes();
        route.handle({ method: 'GET' }, res, '/target', {});
        const body = JSON.parse(res.body);
        assert.equal(body.instanceId, instanceId, `repeat ${i}: instanceId drifted`);
        assert.equal(body.startedAt, startedAt, `repeat ${i}: startedAt drifted`);
      }
    })
  );
});

test('property: randomUUID() — the generator a bounce (fresh startBridge call) draws from — never repeats across many independent calls', () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 40 }), (count) => {
      const ids = Array.from({ length: count }, () => randomUUID());
      assert.equal(new Set(ids).size, ids.length, `duplicate among ${JSON.stringify(ids)}`);
    })
  );
});
