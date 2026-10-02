'use strict';

// BL-1849: step handlers for "A property scan of the test directory skips a
// fixture that vanished". Drives the REAL findProductionTunnelBindings in
// extension/test/helpers/fixtureTunnelName.js - the scan bl1061's invariant 2
// runs over extension/test - never a parallel reimplementation of it. The
// scratch directory lives under a tracked mkdtemp root (BL-1636); the
// "removed after the listing" step deletes the fixture from a spy on
// readdirSync, never by timing (BL-1443's handler shape, BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const {
  PRODUCTION_TUNNEL_NAMES,
  findProductionTunnelBindings,
} = require('../../../extension/test/helpers/fixtureTunnelName');

const FEATURE = 'BL-1849 A property scan of the test directory skips a fixture that vanished';

const KNOWN_ERRORS = new Set(['EACCES']);
const BL868_FIXTURE_NAME = /^bl868-fixture-\d+-[a-z0-9]+-\d+\.property\.test\.js$/;
const BINDING_FILE = 'binds-production-tunnel.test.js';
const UNREADABLE_FILE = 'unreadable.test.js';

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bindingSource(name) {
  return `const env = { SWARMFORGE_NAMED_TUNNEL: '${name}' };\nmodule.exports = env;\n`;
}

function newScratchDir(ctx) {
  ctx.dir = trackedTmpRoot('sfvc-bl1849-');
  ctx.fsImpl = fs;
}

function registerSteps(registry) {
  // ── scenario 01 Given ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a scratch test directory holding "([^"]+)" and a file that binds the tunnel name "([^"]+)"$/,
    (ctx, fixtureName, tunnelName) => {
      assert.match(fixtureName, BL868_FIXTURE_NAME, `not a bl868 lane fixture name: ${fixtureName}`);
      assert.ok(PRODUCTION_TUNNEL_NAMES.includes(tunnelName), `not a production tunnel name: ${tunnelName}`);
      newScratchDir(ctx);
      ctx.fixtureFile = path.join(ctx.dir, fixtureName);
      fs.writeFileSync(ctx.fixtureFile, "'use strict';\n");
      fs.writeFileSync(path.join(ctx.dir, BINDING_FILE), bindingSource(tunnelName));
      ctx.tunnelName = tunnelName;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture is removed after the scan has listed the directory and before it is read$/,
    (ctx) => {
      ctx.fsImpl = {
        readdirSync: (...args) => {
          const result = fs.readdirSync(...args);
          // The fixture's owner removes it for real right after the listing,
          // so the scan's read of it genuinely ENOENTs.
          fs.rmSync(ctx.fixtureFile, { force: true });
          return result;
        },
        readFileSync: (...args) => fs.readFileSync(...args),
      };
    },
    FEATURE
  );

  // ── scenario 02 Given ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^a scratch test directory holding a file whose read fails with (\S+) through the scan's fs seam$/,
    (ctx, error) => {
      assert.ok(KNOWN_ERRORS.has(error), `unknown error example value: ${error}`);
      newScratchDir(ctx);
      ctx.failFile = path.join(ctx.dir, UNREADABLE_FILE);
      fs.writeFileSync(ctx.failFile, "'use strict';\n");
      ctx.fsImpl = {
        readdirSync: (...args) => fs.readdirSync(...args),
        readFileSync: (p, enc) => {
          if (p === ctx.failFile) {
            // Node's own fs error shape, never a chmod (engineering rule).
            const err = new Error(`${error}: permission denied, open '${p}'`);
            err.code = error;
            err.path = p;
            throw err;
          }
          return fs.readFileSync(p, enc);
        },
      };
    },
    FEATURE
  );

  // ── When ────────────────────────────────────────────────────────────────
  registry.defineScoped(/^the tunnel-binding scan runs over the scratch directory$/, (ctx) => {
    try {
      ctx.offenders = findProductionTunnelBindings(ctx.dir, { fsImpl: ctx.fsImpl });
      ctx.scanError = null;
    } catch (err) {
      ctx.offenders = null;
      ctx.scanError = err;
    }
  }, FEATURE);

  // ── scenario 01 Then ──────────────────────────────────────────────────────
  registry.defineScoped(/^the scan completes$/, (ctx) => {
    assert.equal(ctx.scanError, null, `expected the scan to complete, got: ${ctx.scanError && ctx.scanError.message}`);
    assert.equal(fs.existsSync(ctx.fixtureFile), false, 'the fixture was never removed, so the race was not exercised');
  }, FEATURE);

  registry.defineScoped(/^it reports exactly the file that binds "([^"]+)"$/, (ctx, tunnelName) => {
    assert.equal(tunnelName, ctx.tunnelName, `the Then names ${tunnelName}, the Given bound ${ctx.tunnelName}`);
    assert.deepEqual(ctx.offenders, [`${BINDING_FILE}: binds ${tunnelName}`]);
  }, FEATURE);

  // ── scenario 02 Then ──────────────────────────────────────────────────────
  registry.defineScoped(/^the scan fails naming that file and (\S+)$/, (ctx, error) => {
    assert.ok(KNOWN_ERRORS.has(error), `unknown error example value: ${error}`);
    assert.ok(ctx.scanError, 'expected the scan to fail, but it completed');
    assert.equal(ctx.scanError.code, error, `expected the scan to fail with ${error}, got: ${ctx.scanError.code}`);
    assert.match(
      ctx.scanError.message,
      new RegExp(escapeForRegExp(ctx.failFile)),
      `expected the failure to name ${ctx.failFile}, got: ${ctx.scanError.message}`
    );
  }, FEATURE);
}

module.exports = { registerSteps };
