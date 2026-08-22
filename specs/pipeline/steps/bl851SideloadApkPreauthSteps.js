'use strict';

// BL-851: step handlers for "The one route that skips the bearer check
// serves published APKs and nothing else". Drives the REAL compiled bridge
// server (out/bridge/bridgeServer.js) end to end over real HTTP, mirroring
// burnRateSteps.js's own startBridge pattern. Containment against the WHOLE
// input space is a property test
// (extension/test/sideloadApk.property.test.js, BL-654) - these scenarios
// sample a handful of concrete request shapes, they do not discharge the
// invariant (see the feature file's own header note).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));

const TOKEN = 'aps-sideload-apk-token';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-sideload-apk-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function publicDirFor(target) {
  return path.join(target, '.swarmforge', 'operator', 'public');
}

// Sends the exact raw path bytes on the request line. Unlike fetch(), which
// runs the URL through the WHATWG URL parser (dot-segment removal,
// backslash treated as a path separator for special schemes) before the
// request ever reaches the wire, http.request's `path` option is used
// as-is. That is what makes the percent-encoded/backslash Examples
// meaningful: they exercise what the SERVER actually receives, not what a
// browser-shaped client would already have normalized away.
function rawRequest(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withBridge(target, fn) {
  const handle = await startBridge(target, path.join(target, 'runs.jsonl'), TOKEN);
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

// Every Examples: column value is validated against an explicit lookup and
// throws on anything else (engineering.prompt's Scenario Outline rule) -
// never a bare passthrough that would lump a mutated token into a silent
// default.
const ENCODED_TARGET_PATHS = {
  'a plainly encoded parent-directory climb': '/swarmforge-float-companion-%2e%2e%2Fescape-marker.apk',
  'a doubly encoded parent-directory climb': '/swarmforge-float-companion-%252e%252e%252Fescape-marker.apk',
  'a backslash-separated climb': '/swarmforge-float-companion-..\\..\\escape-marker.apk',
};
const SYMLINK_TARGET_TOKEN = 'a symlink inside the directory pointing outside it';

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a bridge serving sideload APKs from the published public directory$/, (ctx) => {
    ctx.target = mkTmp();
    ctx.publicDir = publicDirFor(ctx.target);
    mkdirp(ctx.publicDir);
    // Planted OUTSIDE the public directory - if any escape path manages to
    // reach it, its distinctive bytes would show up in the response body.
    ctx.escapeMarker = 'BL-851-host-secret-should-never-be-served';
    fs.writeFileSync(path.join(ctx.target, 'escape-marker.apk'), ctx.escapeMarker);
  });

  // ── sideload-apk-preauth-01 / 02 (shared When) ─────────────────────
  registry.define(/^a published APK in the public directory$/, (ctx) => {
    ctx.apkName = 'swarmforge-float-companion-1.2.3.apk';
    ctx.apkBytes = Buffer.from('PK-fixture-apk-bytes');
    fs.writeFileSync(path.join(ctx.publicDir, ctx.apkName), ctx.apkBytes);
  });

  registry.define(/^no file of that name in the public directory$/, (ctx) => {
    ctx.apkName = 'swarmforge-float-companion-does-not-exist.apk';
  });

  registry.define(/^it is requested by name without credentials$/, async (ctx) => {
    await withBridge(ctx.target, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/${ctx.apkName}`);
      ctx.status = res.status;
      ctx.contentType = res.headers.get('content-type');
      ctx.body = Buffer.from(await res.arrayBuffer());
    });
  });

  registry.define(/^it is served$/, (ctx) => {
    assert.equal(ctx.status, 200);
    assert.equal(Buffer.compare(ctx.body, ctx.apkBytes), 0);
  });

  registry.define(/^it is served as an Android package download$/, (ctx) => {
    assert.equal(ctx.contentType, 'application/vnd.android.package-archive');
  });

  registry.define(/^the response is not found$/, (ctx) => {
    assert.equal(ctx.status, 404);
  });

  // ── sideload-apk-preauth-03 / 04 (shared When/Then) ────────────────
  registry.define(/^a request naming (.+) outside the public directory$/, (ctx, token) => {
    if (token === SYMLINK_TARGET_TOKEN) {
      const symlinkName = 'swarmforge-float-companion-escape-symlink.apk';
      fs.symlinkSync(path.join(ctx.target, 'escape-marker.apk'), path.join(ctx.publicDir, symlinkName));
      ctx.rawRequestPath = `/${symlinkName}`;
      return;
    }
    if (!(token in ENCODED_TARGET_PATHS)) {
      throw new Error(`unknown outside-target token: ${token}`);
    }
    ctx.rawRequestPath = ENCODED_TARGET_PATHS[token];
  });

  registry.define(/^a directory in the public directory whose name matches the pattern$/, (ctx) => {
    const dirName = 'swarmforge-float-companion-a-directory.apk';
    fs.mkdirSync(path.join(ctx.publicDir, dirName));
    ctx.rawRequestPath = `/${dirName}`;
  });

  registry.define(/^it is requested without credentials$/, async (ctx) => {
    await withBridge(ctx.target, async (handle) => {
      const res = await rawRequest(handle.port, ctx.rawRequestPath);
      ctx.status = res.status;
      ctx.body = res.body;
    });
  });

  registry.define(/^no file content is served$/, (ctx) => {
    assert.notEqual(ctx.status, 200);
    assert.equal(ctx.body.includes(ctx.escapeMarker), false);
  });

  // ── sideload-apk-preauth-05 ─────────────────────────────────────────
  registry.define(/^a request to any route other than a published APK$/, (ctx) => {
    ctx.rawRequestPath = '/pipeline';
  });

  registry.define(/^it is made without credentials$/, async (ctx) => {
    await withBridge(ctx.target, async (handle) => {
      const res = await rawRequest(handle.port, ctx.rawRequestPath);
      ctx.status = res.status;
    });
  });

  registry.define(/^it is rejected as unauthorized$/, (ctx) => {
    assert.equal(ctx.status, 401);
  });
}

module.exports = { registerSteps };
