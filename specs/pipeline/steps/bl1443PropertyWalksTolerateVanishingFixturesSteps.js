'use strict';

// BL-1443: step handlers for "A property test's tree walk skips a file that
// vanished between listing and read". Drives the REAL
// extension/test/helpers/tolerantTreeWalk.js - never a parallel
// reimplementation of its decision logic. Fixture trees live under
// fs.mkdtempSync and are removed in a `finally`-equivalent process-exit
// hook (BL-459's acceptance sibling); the "removed after listing" step
// deletes the file from a spy on readdirSync, never by timing (BL-1390:
// the fixture is its own tree under mkdtemp, never the live repo).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { walkFilesTolerant } = require('../../../extension/test/helpers/tolerantTreeWalk');

const FEATURE = "BL-1443 A property test's tree walk skips a file that vanished between listing and read";

const KNOWN_ERRORS = new Set(['EACCES', 'EISDIR']);

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registerSteps(registry) {
  // ── shared Given: the four-file scratch tree ─────────────────────────────
  registry.defineScoped(/^a scratch tree of four \.js files under a mkdtemp root$/, (ctx) => {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1443-'));
    fixtureRoots.push(ctx.root);
    ctx.files = [];
    for (let i = 0; i < 4; i++) {
      const p = path.join(ctx.root, `file${i}.js`);
      fs.writeFileSync(p, `// file ${i}\n`);
      ctx.files.push(p);
    }
  }, FEATURE);

  // ── scenario 01 Given ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^one of them is removed after the walk has listed its directory and before it is read$/,
    (ctx) => {
      ctx.removedFile = ctx.files[1];
      ctx.fsImpl = {
        readdirSync: (...args) => {
          const result = fs.readdirSync(...args);
          // A spy on readdirSync, not timing (BL-1443's own How): the file
          // is removed for real, right after the ONE listing call this
          // fixture ever makes, so every subsequent read genuinely ENOENTs.
          if (fs.existsSync(ctx.removedFile)) {
            fs.rmSync(ctx.removedFile);
          }
          return result;
        },
        readFileSync: (...args) => fs.readFileSync(...args),
      };
    },
    FEATURE
  );

  // ── scenario 02 Given ─────────────────────────────────────────────────────
  registry.defineScoped(/^reading one of them fails with (\S+) through the helper's fs seam$/, (ctx, error) => {
    assert.ok(KNOWN_ERRORS.has(error), `unknown error example value: ${error}`);
    ctx.failFile = ctx.files[2];
    ctx.failCode = error;
    ctx.fsImpl = {
      readdirSync: (...args) => fs.readdirSync(...args),
      readFileSync: (p, enc) => {
        if (p === ctx.failFile) {
          // Realistic Node fs error shape (.path set), never a chmod-based
          // simulation (engineering rule: never chmod for failure sim).
          const err = new Error(`${error}: simulated failure, open '${p}'`);
          err.code = error;
          err.path = p;
          throw err;
        }
        return fs.readFileSync(p, enc);
      },
    };
  }, FEATURE);

  // ── When ────────────────────────────────────────────────────────────────
  registry.defineScoped(/^the tree is walked through the property-lane helper$/, (ctx) => {
    ctx.listingBefore = fs.readdirSync(ctx.root).sort();
    try {
      ctx.walkResults = walkFilesTolerant(ctx.root, { extension: '.js', withContent: true, fsImpl: ctx.fsImpl || fs });
      ctx.walkError = null;
    } catch (err) {
      ctx.walkResults = null;
      ctx.walkError = err;
    }
    ctx.listingAfter = fs.readdirSync(ctx.root).sort();
  }, FEATURE);

  // ── scenario 01 Then ──────────────────────────────────────────────────────
  registry.defineScoped(/^the walk completes and reports the three files that still exist$/, (ctx) => {
    assert.equal(ctx.walkError, null, `expected the walk to complete, got: ${ctx.walkError && ctx.walkError.message}`);
    const resultPaths = ctx.walkResults.map((r) => r.path).sort();
    const expected = ctx.files.filter((f) => f !== ctx.removedFile).sort();
    assert.deepEqual(resultPaths, expected, `expected exactly the three surviving files, got: ${resultPaths}`);
  }, FEATURE);

  registry.defineScoped(/^nothing was written, moved or deleted by the helper itself$/, (ctx) => {
    // The seam's own fsImpl exposes ONLY readdirSync/readFileSync - no
    // write-shaped method exists for the helper to call even by accident,
    // and the walk above already completed successfully through exactly
    // those two. The on-disk listing after the walk is exactly the three
    // surviving files: nothing new appeared, nothing beyond the seam's own
    // (test-setup) removal vanished.
    const fsImplKeys = Object.keys(ctx.fsImpl).sort();
    assert.deepEqual(fsImplKeys, ['readFileSync', 'readdirSync'], 'the helper was given write-shaped methods to call - it should need none');
    const expectedListing = ctx.files.filter((f) => f !== ctx.removedFile).map((f) => path.basename(f)).sort();
    assert.deepEqual(ctx.listingAfter, expectedListing, `the directory changed beyond the seam's own removal: before=${ctx.listingBefore} after=${ctx.listingAfter}`);
  }, FEATURE);

  // ── scenario 02 Then ──────────────────────────────────────────────────────
  registry.defineScoped(/^the walk fails naming that file and (\S+)$/, (ctx, error) => {
    assert.ok(KNOWN_ERRORS.has(error), `unknown error example value: ${error}`);
    assert.ok(ctx.walkError, 'expected the walk to fail, but it completed');
    assert.equal(ctx.walkError.code, error, `expected the walk to fail with ${error}, got: ${ctx.walkError.code}`);
    assert.match(
      ctx.walkError.message + (ctx.walkError.path || ''),
      new RegExp(escapeForRegExp(ctx.failFile)),
      `expected the failure to name ${ctx.failFile}, got: ${ctx.walkError.message}`
    );
  }, FEATURE);

  // ── scenario 03 ────────────────────────────────────────────────────────────
  registry.defineScoped(/^the property test files under extension\/test$/, (ctx) => {
    const dir = path.join(__dirname, '..', '..', '..', 'extension', 'test');
    ctx.propertyTestFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.property.test.js'));
    ctx.propertyTestDir = dir;
  }, FEATURE);

  registry.defineScoped(/^each file is scanned for an inline recursive directory walk$/, (ctx) => {
    ctx.definesOwnWalk = [];
    ctx.usesHelper = [];
    for (const f of ctx.propertyTestFiles) {
      const text = fs.readFileSync(path.join(ctx.propertyTestDir, f), 'utf8');
      if (/function\s+walk\s*\(/.test(text)) {
        ctx.definesOwnWalk.push(f);
      }
      if (/\bwalkFilesTolerant\s*\(/.test(text)) {
        ctx.usesHelper.push(f);
      }
    }
  }, FEATURE);

  registry.defineScoped(/^no property test defines its own walk$/, (ctx) => {
    assert.deepEqual(ctx.definesOwnWalk, [], `these property tests still define their own walk: ${ctx.definesOwnWalk.join(', ')}`);
  }, FEATURE);

  registry.defineScoped(/^every property test that walks a tree calls the helper$/, (ctx) => {
    // Derived, not a hand list (BL-1408/BL-1398 posture): the ONE fixed
    // anchor this ticket names (required_wiring) must show up among the
    // files that now reference the helper.
    assert.ok(
      ctx.usesHelper.includes('bl874PortableTimeInvariants.property.test.js'),
      `expected the wiring-anchor file to call walkFilesTolerant, got: ${ctx.usesHelper.join(', ')}`
    );
  }, FEATURE);
}

module.exports = { registerSteps };
