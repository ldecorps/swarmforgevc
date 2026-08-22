const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  listCompanionPackages,
  readCompanionPackage,
  isCompanionManifestPath,
  isCompanionPackagePath,
  parseCompanionPackageRequest,
} = require('../out/bridge/companionManifest');

function mkTmp() {
  return mkTmpDir('sfvc-companion-manifest-');
}

function writeVisionDoc(target, relativePath, content) {
  const filePath = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function mkTargetWithDocs() {
  const target = mkTmp();
  writeVisionDoc(target, 'docs/reference/Specification.MD', '# Spec content');
  return target;
}

// ── manifest lists available packages ──────────────────────────────────

test('listCompanionPackages: lists backlog and docs when both are readable', () => {
  const target = mkTargetWithDocs();
  const names = listCompanionPackages(target).map((p) => p.name);
  assert.deepEqual(names.sort(), ['backlog', 'docs']);
});

test('listCompanionPackages: each entry carries a generation and a format version', () => {
  const target = mkTargetWithDocs();
  for (const entry of listCompanionPackages(target)) {
    assert.equal(typeof entry.generation, 'string');
    assert.ok(entry.generation.length > 0);
    assert.equal(typeof entry.formatVersion, 'number');
    assert.equal(entry.format, 'json');
  }
});

// ── manifest never advertises what it cannot serve ─────────────────────

test('listCompanionPackages: docs is absent when its source cannot be read, backlog still listed', () => {
  const target = mkTmp(); // no docs/ tree written at all
  const names = listCompanionPackages(target).map((p) => p.name);
  assert.deepEqual(names, ['backlog']);
});

// ── package body matches the manifest-advertised generation ────────────

test('readCompanionPackage: the served body carries the same generation the manifest advertised', () => {
  const target = mkTargetWithDocs();
  const manifestEntry = listCompanionPackages(target).find((p) => p.name === 'backlog');
  const served = readCompanionPackage(target, 'backlog', null);
  assert.equal(served.status, 'ok');
  assert.equal(served.generation, manifestEntry.generation);
});

// ── unchanged-generation is not resent ──────────────────────────────────

test('readCompanionPackage: naming the current generation returns unchanged with no data', () => {
  const target = mkTargetWithDocs();
  const first = readCompanionPackage(target, 'backlog', null);
  const second = readCompanionPackage(target, 'backlog', first.generation);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.generation, first.generation);
  assert.equal('data' in second, false);
});

// ── a stale generation gets the new body ────────────────────────────────

test('readCompanionPackage: naming a stale generation sends the current body at the current generation', () => {
  const target = mkTargetWithDocs();
  const first = readCompanionPackage(target, 'backlog', null);

  // Change the backlog content on disk so the generation moves.
  fs.mkdirSync(path.join(target, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'backlog', 'active', 'BL-1.yaml'),
    'id: BL-1\ntitle: "test"\nstatus: todo\n'
  );

  const second = readCompanionPackage(target, 'backlog', first.generation);
  assert.equal(second.status, 'ok');
  assert.notEqual(second.generation, first.generation);
});

// ── unreadable-after-advertised is refused, not served empty ───────────

test('readCompanionPackage: docs refused with a reason once its source becomes unreadable, never served empty', () => {
  const target = mkTargetWithDocs();
  const advertised = readCompanionPackage(target, 'docs', null);
  assert.equal(advertised.status, 'ok');

  // The docs source becomes unreadable (removed).
  fs.rmSync(path.join(target, 'docs'), { recursive: true, force: true });

  const after = readCompanionPackage(target, 'docs', null);
  assert.equal(after.status, 'unreadable');
  assert.equal(typeof after.reason, 'string');
  assert.ok(after.reason.length > 0);
  assert.equal('data' in after, false);
});

// ── unknown package name is refused clearly ─────────────────────────────

test('readCompanionPackage: an unknown package name is refused with a reason naming it', () => {
  const target = mkTargetWithDocs();
  const result = readCompanionPackage(target, 'does-not-exist', null);
  assert.equal(result.status, 'unknown');
  assert.match(result.reason, /does-not-exist/);
});

// ── URL parsing helpers ──────────────────────────────────────────────────

test('isCompanionManifestPath: matches /companion-manifest with or without a query string', () => {
  assert.equal(isCompanionManifestPath('/companion-manifest'), true);
  assert.equal(isCompanionManifestPath('/companion-manifest?bearer=x'), true);
  assert.equal(isCompanionManifestPath('/companion-manifest-extra'), false);
  assert.equal(isCompanionManifestPath('/companion-package/backlog'), false);
});

test('isCompanionPackagePath: matches /companion-package/<name>', () => {
  assert.equal(isCompanionPackagePath('/companion-package/backlog'), true);
  assert.equal(isCompanionPackagePath('/companion-package/backlog?generation=abc'), true);
  assert.equal(isCompanionPackagePath('/companion-manifest'), false);
});

test('parseCompanionPackageRequest: extracts the package name and the requested generation', () => {
  assert.deepEqual(parseCompanionPackageRequest('/companion-package/backlog?generation=abc123'), {
    name: 'backlog',
    generation: 'abc123',
  });
  assert.deepEqual(parseCompanionPackageRequest('/companion-package/docs'), {
    name: 'docs',
    generation: null,
  });
});
