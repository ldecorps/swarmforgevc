'use strict';

// BL-788: step handlers for "Bubble pairing and client-log hotfix, adopted
// under review" (specs/features/BL-788-bubble-pairing-client-logs-adopt.feature).
// Drives the REAL compiled bridge server (out/bridge/bridgeServer.js) and
// tunnel-notify module (out/concierge/residentSpyTunnelNotify.js) over real
// HTTP / direct calls, mirroring bl851SideloadApkPreauthSteps.js's and
// bl866CompanionManifestPackageCatalogSteps.js's own startBridge pattern -
// Background starts a fresh bridge per scenario, the last step of each
// scenario stops it. Containment against the whole input space (invariant
// 1) and the package-id consistency check (invariant 2) are property tests
// (extension/test/bl788BubblePairingInvariants.property.test.js, BL-654) -
// these scenarios sample a handful of concrete request shapes, they do not
// discharge those invariants themselves.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { buildResidentSpyTunnelUrls } = require(path.join(EXT_DIR, 'out', 'concierge', 'residentSpyTunnelNotify'));

const GRADLE_FILE = path.join(__dirname, '..', '..', '..', 'android', 'app', 'build.gradle.kts');
const TOKEN = 'aps-bubble-pairing-token';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bubble-pairing-'));
}

function publicDirFor(target) {
  return path.join(target, '.swarmforge', 'operator', 'public');
}

// Sends the exact raw path bytes on the request line - see
// bl851SideloadApkPreauthSteps.js's own rationale (fetch()'s WHATWG URL
// parser would collapse dot-segments/normalize percent-escapes before the
// request ever reaches the wire, defeating the point of the encoded and
// traversal-shaped examples).
function rawRequest(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function shippedApplicationId() {
  const gradleSource = fs.readFileSync(GRADLE_FILE, 'utf8');
  const match = gradleSource.match(/applicationId\s*=\s*"([^"]+)"/);
  assert.ok(match, 'expected an applicationId assignment in android/app/build.gradle.kts');
  return match[1];
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a bridge server is running with a pairing token configured$/, async (ctx) => {
    ctx.target = mkTmp();
    ctx.publicDir = publicDirFor(ctx.target);
    fs.mkdirSync(ctx.publicDir, { recursive: true });
    // Planted OUTSIDE the public directory - if a traversal example in
    // scenario 03 ever managed to escape, its distinctive bytes would show
    // up in the response body (mirrors bl851SideloadApkPreauthSteps.js).
    ctx.escapeMarker = 'BL-788-host-secret-should-never-be-served';
    fs.writeFileSync(path.join(ctx.target, 'escape-marker.apk'), ctx.escapeMarker);
    ctx.handle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, {});
  });

  registry.define(/^the operator public directory contains "([^"]+)"$/, (ctx, name) => {
    fs.writeFileSync(path.join(ctx.publicDir, name), 'PK-fixture-apk-bytes');
  });

  // ── bubble-pairing-client-logs-adopt-01 / 02 (shared When) ──────────
  registry.define(/^an unauthenticated client requests the pairing page with a valid token$/, async (ctx) => {
    const res = await fetch(`http://127.0.0.1:${ctx.handle.port}/pair?token=${TOKEN}`);
    ctx.status = res.status;
    ctx.pageHtml = await res.text();
  });

  registry.define(/^the response succeeds$/, (ctx) => {
    assert.equal(ctx.status, 200);
  });

  // ── bubble-pairing-client-logs-adopt-01 ──────────────────────────────
  registry.define(/^the page contains an "intent:\/\/" pairing link$/, (ctx) => {
    assert.match(ctx.pageHtml, /<a href="intent:\/\//);
  });

  registry.define(/^that link names the package id the shipped build installs under$/, (ctx) => {
    const applicationId = shippedApplicationId();
    const hrefMatch = ctx.pageHtml.match(/<a href="([^"]*)">/);
    assert.ok(hrefMatch, 'expected a pairing <a href="..."> in the page');
    assert.match(hrefMatch[1], new RegExp(`package=${applicationId.replace(/\./g, '\\.')};end`));
  });

  registry.define(/^the page does not auto-navigate to a bare custom-scheme URL$/, (ctx) => {
    assert.doesNotMatch(ctx.pageHtml, /http-equiv="refresh"/);
    assert.doesNotMatch(ctx.pageHtml, /href="swarmforge-bubble:\/\//);
    ctx.handle.stop();
  });

  // ── bubble-pairing-client-logs-adopt-02 ──────────────────────────────
  registry.define(/^the page offers a copyable bridge URL$/, (ctx) => {
    assert.match(ctx.pageHtml, /<code>https:\/\/[^<]*<\/code>/);
  });

  registry.define(/^the page offers a copyable pairing token$/, (ctx) => {
    assert.match(ctx.pageHtml, new RegExp(`<code>${TOKEN}</code>`));
    ctx.handle.stop();
  });

  // ── bubble-pairing-client-logs-adopt-03 (Scenario Outline) / 04 ─────
  registry.define(/^an unauthenticated client requests the APK path "(.+)"$/, async (ctx, requested) => {
    const res = await rawRequest(ctx.handle.port, requested);
    ctx.status = res.status;
    ctx.headers = res.headers;
    ctx.body = res.body;
  });

  registry.define(/^the bridge responds with status (\d+)$/, (ctx, status) => {
    assert.equal(ctx.status, Number(status));
  });

  registry.define(/^no file outside the operator public directory is read$/, (ctx) => {
    assert.equal(ctx.body.includes(ctx.escapeMarker), false);
    ctx.handle.stop();
  });

  // ── bubble-pairing-client-logs-adopt-04 ──────────────────────────────
  registry.define(/^the content type is the Android package archive type$/, (ctx) => {
    assert.equal(ctx.headers['content-type'], 'application/vnd.android.package-archive');
  });

  registry.define(/^the response is not cached$/, (ctx) => {
    assert.equal(ctx.headers['cache-control'], 'no-store');
    ctx.handle.stop();
  });

  // ── bubble-pairing-client-logs-adopt-05 ──────────────────────────────
  registry.define(/^the resident-spy tunnel is serving a base URL over HTTPS$/, (ctx) => {
    ctx.tunnelBaseUrl = 'https://swarmforge-test-tunnel.trycloudflare.com';
    ctx.tunnelToken = 'aps-tunnel-pairing-token';
  });

  registry.define(/^the tunnel notification is composed$/, (ctx) => {
    ctx.urls = buildResidentSpyTunnelUrls(ctx.tunnelBaseUrl, ctx.tunnelToken);
  });

  registry.define(/^the notification carries a pairing URL on that HTTPS base$/, (ctx) => {
    assert.match(ctx.urls.pairingHttpsUrl, new RegExp(`^${ctx.tunnelBaseUrl.replace(/\./g, '\\.')}/pair\\?token=`));
  });

  registry.define(/^the pairing URL carries the pairing token$/, (ctx) => {
    assert.match(ctx.urls.pairingHttpsUrl, new RegExp(`token=${ctx.tunnelToken}$`));
    // Background starts a bridge for every scenario in this feature file,
    // even this one - it doesn't touch the bridge, but still owes it a
    // stop() or the listening server outlives the scenario and the process
    // never drains its event loop (node --test hangs forever waiting for a
    // natural exit).
    ctx.handle.stop();
  });
}

module.exports = { registerSteps };
