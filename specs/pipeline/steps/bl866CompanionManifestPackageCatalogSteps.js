'use strict';

// BL-866: step handlers for "the bridge advertises versioned JSON packages
// a phone can cache and refresh cheaply"
// (specs/features/BL-866-companion-manifest-package-catalog.feature).
// Drives the REAL compiled bridge server (out/bridge/bridgeServer.js) over
// real HTTP, mirroring bl851SideloadApkPreauthSteps.js's / replyRelayAt-
// LeastOnceSteps.js's own startBridge pattern - every scenario stores its
// live bridge on ctx.handle and stops it in its own final Then step.
// Containment against the wider generation-agreement and never-advertise-
// what-it-cannot-serve invariants is a property test
// (extension/test/companionManifest.property.test.js, BL-654) - these
// scenarios sample a handful of concrete request shapes, they do not
// discharge those invariants themselves.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));

const TOKEN = 'aps-companion-manifest-token';

// This ticket's own "the request is <outcome>" Scenario Outline substitutes
// to the literal text "the request is refused" for its unauthorized rows -
// a real collision hit while building this file: gatesListSteps.js already
// owns that exact text, unscoped, for completely unrelated gate-list
// behavior (stepRegistry.js's resolve() matches by literal text across the
// WHOLE suite, regardless of origin file). Scoped via defineScoped, pinned
// to this exact Feature: title, so it is only ever preferred when THIS
// feature is running - gatesListSteps.js's own scenarios are unaffected.
const FEATURE_NAME = 'the bridge advertises versioned JSON packages a phone can cache and refresh cheaply';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-companion-manifest-'));
}

function writeVisionDoc(target) {
  const filePath = path.join(target, 'docs', 'reference', 'Specification.MD');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '# Spec content');
}

function removeDocsSource(target) {
  fs.rmSync(path.join(target, 'docs'), { recursive: true, force: true });
}

function writeBacklogTicket(target, id) {
  const dir = path.join(target, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "t"\nstatus: todo\n`);
}

function authHeaders(ctx) {
  return ctx.useAuth === false ? {} : { authorization: `Bearer ${TOKEN}` };
}

async function fetchManifest(ctx) {
  const res = await fetch(`http://127.0.0.1:${ctx.handle.port}/companion-manifest`, { headers: authHeaders(ctx) });
  ctx.status = res.status;
  ctx.manifestBody = res.status === 200 ? await res.json() : undefined;
}

async function fetchPackage(ctx, name, generation) {
  const url = generation
    ? `http://127.0.0.1:${ctx.handle.port}/companion-package/${name}?generation=${encodeURIComponent(generation)}`
    : `http://127.0.0.1:${ctx.handle.port}/companion-package/${name}`;
  const res = await fetch(url, { headers: authHeaders(ctx) });
  ctx.status = res.status;
  ctx.packageBody = undefined;
  ctx.responseBytesLength = undefined;
  if (res.status === 304) {
    ctx.responseBytesLength = (await res.arrayBuffer()).byteLength;
  } else {
    ctx.packageBody = await res.json();
  }
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^a bridge serving an authorized client$/, async (ctx) => {
    ctx.target = mkTmp();
    ctx.handle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN);
    ctx.useAuth = true;
  });

  // ── manifest-lists-packages-and-generations-01 ──────────────────────
  registry.define(/^the backlog and docs packages are available$/, (ctx) => {
    writeBacklogTicket(ctx.target, 'BL-1');
    writeVisionDoc(ctx.target);
  });

  registry.define(/^the companion manifest is requested$/, async (ctx) => {
    await fetchManifest(ctx);
  });

  registry.define(/^each available package is listed$/, (ctx) => {
    const names = ctx.manifestBody.packages.map((p) => p.name).sort();
    assert.deepEqual(names, ['backlog', 'docs']);
  });

  registry.define(/^each listed package carries a generation$/, (ctx) => {
    for (const pkg of ctx.manifestBody.packages) {
      assert.equal(typeof pkg.generation, 'string');
      assert.ok(pkg.generation.length > 0);
    }
  });

  registry.define(/^each listed package carries a format version$/, (ctx) => {
    for (const pkg of ctx.manifestBody.packages) {
      assert.equal(typeof pkg.formatVersion, 'number');
    }
    ctx.handle.stop();
  });

  // ── package-body-matches-its-advertised-generation-02 ───────────────
  registry.define(/^the manifest advertises the backlog package at a generation$/, async (ctx) => {
    await fetchManifest(ctx);
    ctx.packageName = 'backlog';
    ctx.advertisedGeneration = ctx.manifestBody.packages.find((p) => p.name === 'backlog').generation;
  });

  registry.define(/^that package is requested$/, async (ctx) => {
    await fetchPackage(ctx, ctx.packageName);
  });

  registry.define(/^the served body carries that same generation$/, (ctx) => {
    assert.equal(ctx.packageBody.generation, ctx.advertisedGeneration);
    ctx.handle.stop();
  });

  // ── unchanged-generation-is-not-resent-03 ───────────────────────────
  registry.define(/^a client holds the backlog package at its current generation$/, async (ctx) => {
    await fetchPackage(ctx, 'backlog');
    ctx.packageName = 'backlog';
    ctx.heldGeneration = ctx.packageBody.generation;
  });

  registry.define(/^that client requests the package naming the generation it holds$/, async (ctx) => {
    await fetchPackage(ctx, ctx.packageName, ctx.heldGeneration);
  });

  registry.define(/^it is told the package is unchanged$/, (ctx) => {
    assert.equal(ctx.status, 304);
  });

  registry.define(/^no package body is sent$/, (ctx) => {
    assert.equal(ctx.responseBytesLength, 0);
    ctx.handle.stop();
  });

  // ── changed-generation-is-sent-04 ────────────────────────────────────
  registry.define(/^a client holds the backlog package at an older generation$/, async (ctx) => {
    await fetchPackage(ctx, 'backlog');
    ctx.packageName = 'backlog';
    ctx.heldGeneration = ctx.packageBody.generation;
    writeBacklogTicket(ctx.target, 'BL-2'); // moves the generation forward
  });

  registry.define(/^the current body is sent$/, (ctx) => {
    assert.equal(ctx.status, 200);
    assert.ok(ctx.packageBody && 'data' in ctx.packageBody);
  });

  registry.define(/^the body carries the current generation$/, (ctx) => {
    assert.notEqual(ctx.packageBody.generation, ctx.heldGeneration);
    ctx.handle.stop();
  });

  // ── manifest-never-advertises-what-it-cannot-serve-05 ───────────────
  registry.define(/^the docs package source cannot be read$/, (ctx) => {
    // ctx.target starts with no docs/ tree at all - docs is already
    // unreadable. Give backlog real content so "still listed" means
    // something more than the folder's own empty-is-valid default.
    writeBacklogTicket(ctx.target, 'BL-1');
  });

  registry.define(/^the docs package is not listed$/, (ctx) => {
    const names = ctx.manifestBody.packages.map((p) => p.name);
    assert.equal(names.includes('docs'), false);
  });

  registry.define(/^the backlog package is still listed$/, (ctx) => {
    const names = ctx.manifestBody.packages.map((p) => p.name);
    assert.equal(names.includes('backlog'), true);
    ctx.handle.stop();
  });

  // ── unreadable-package-is-refused-not-served-empty-06 ───────────────
  registry.define(/^the manifest advertised the docs package$/, async (ctx) => {
    writeVisionDoc(ctx.target);
    await fetchManifest(ctx);
    assert.ok(
      ctx.manifestBody.packages.some((p) => p.name === 'docs'),
      'expected docs to be advertised before it becomes unreadable'
    );
    ctx.packageName = 'docs';
  });

  registry.define(/^the docs package source then became unreadable$/, (ctx) => {
    removeDocsSource(ctx.target);
  });

  registry.define(/^the request is refused with a reason$/, (ctx) => {
    assert.ok(ctx.status >= 400, `expected a refusal status, got ${ctx.status}`);
    assert.equal(typeof ctx.packageBody.reason, 'string');
    assert.ok(ctx.packageBody.reason.length > 0);
  });

  registry.define(/^nothing is served in place of the unreadable package$/, (ctx) => {
    assert.equal('data' in ctx.packageBody, false);
    ctx.handle.stop();
  });

  // ── unknown-package-is-refused-07 ────────────────────────────────────
  registry.define(/^a package that does not exist is requested$/, async (ctx) => {
    await fetchPackage(ctx, 'does-not-exist');
  });

  registry.define(/^the request is refused with a reason naming the unknown package$/, (ctx) => {
    assert.equal(ctx.status, 404);
    assert.match(ctx.packageBody.reason, /does-not-exist/);
    ctx.handle.stop();
  });

  // ── catalog-requires-authorization-08 (Scenario Outline) ────────────
  registry.define(/^a client that is (authorized|unauthorized)$/, (ctx, authorization) => {
    ctx.useAuth = authorization === 'authorized';
  });

  registry.define(/^the backlog package is requested$/, async (ctx) => {
    await fetchPackage(ctx, 'backlog');
  });

  registry.define(/^the request is served$/, (ctx) => {
    assert.equal(ctx.status, 200);
    ctx.handle.stop();
  });

  registry.defineScoped(
    /^the request is refused$/,
    (ctx) => {
      assert.equal(ctx.status, 401);
      ctx.handle.stop();
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
