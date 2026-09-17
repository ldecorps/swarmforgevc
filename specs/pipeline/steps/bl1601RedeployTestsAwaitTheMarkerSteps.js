'use strict';

// BL-1601: step handlers for "The redeploy tests wait for their detached
// script and the tmpDir sweep survives a racing writer". Drives the REAL
// waitForFileSync/sweepPendingTmpDirs helpers (extension/test/helpers/) - a
// real detached bash spawn for scenario 01 (the actual race this ticket
// fixes), the real sweep with an injected rmFn for scenario 02 (a
// deterministic route to "removal fails", per the ticket's own direction),
// and the real committed test file's own source for scenario 03 (the census
// pin, BL-1445).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { mkTmpDir, sweepPendingTmpDirs } = require('../../../extension/test/helpers/tmpDir');
const { waitForFileSync } = require('../../../extension/test/helpers/waitForFileSync');

const FEATURE = 'BL-1601 The redeploy tests wait for their detached script and the tmpDir sweep survives a racing writer';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TARGET_FILE_REL = 'extension/test/telegramCursorOperatorExec.test.js';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the real race, end to end ───────────────────────────────
  scoped(
    /^a fixture root and a stub script that sleeps 300 ms and then writes a marker into that root$/,
    (ctx) => {
      ctx.root = mkTmpDir('bl1601-repro-');
      ctx.marker = path.join(ctx.root, 'marker');
      ctx.script = path.join(ctx.root, 'stub.sh');
      fs.writeFileSync(ctx.script, `#!/usr/bin/env bash\nsleep 0.3\necho ok > "${ctx.marker}"\nexit 0\n`, 'utf8');
      fs.chmodSync(ctx.script, 0o755);
    }
  );

  scoped(
    /^the script is spawned detached the way the redeploy modules spawn it and the test waits for the marker with a 2000 ms bound$/,
    (ctx) => {
      // Same shape telegramCursorBridgeFrontDeskRedeploy.ts/...AllRedeploy.ts
      // use: detached: true + unref() - the script outlives this process by
      // design, so the marker write is never awaited by any promise here.
      const child = spawn('bash', [ctx.script], { detached: true, stdio: 'ignore' });
      child.unref();
      ctx.waited = waitForFileSync(ctx.marker, { timeoutMs: 2000 });
    }
  );

  scoped(/^the marker exists before the wait returns$/, (ctx) => {
    assert.ok(ctx.waited.ok, `expected the marker to appear within the bound, got: ${JSON.stringify(ctx.waited)}`);
    assert.equal(fs.existsSync(ctx.marker), true);
  });

  scoped(/^the pending tmpDir sweep removes the root without error$/, (ctx) => {
    assert.doesNotThrow(() => sweepPendingTmpDirs());
    assert.equal(fs.existsSync(ctx.root), false);
  });

  // ── Scenario 02: the retry, with an injected deterministic failure mode ──
  scoped(/^a pending tmpDir root whose removal (.+)$/, (ctx, behaviour) => {
    ctx.root = mkTmpDir('bl1601-retry-steps-');
    let calls = 0;
    if (behaviour === 'fails ENOTEMPTY twice and then succeeds') {
      ctx.rmFn = (p, opts) => {
        calls += 1;
        if (calls <= 2) {
          const err = new Error('ENOTEMPTY: directory not empty');
          err.code = 'ENOTEMPTY';
          throw err;
        }
        fs.rmSync(p, opts);
      };
    } else if (behaviour === 'fails ENOTEMPTY on every attempt') {
      ctx.rmFn = () => {
        calls += 1;
        const err = new Error('ENOTEMPTY: directory not empty');
        err.code = 'ENOTEMPTY';
        throw err;
      };
    } else if (behaviour === 'succeeds on the first attempt') {
      ctx.rmFn = (p, opts) => {
        calls += 1;
        fs.rmSync(p, opts);
      };
    } else {
      throw new Error(`unrecognized removal behaviour: ${behaviour}`);
    }
    ctx.getCalls = () => calls;
  });

  scoped(/^the pending tmpDir sweep runs$/, (ctx) => {
    try {
      ctx.result = sweepPendingTmpDirs({ rmFn: ctx.rmFn, sleep: () => {} });
      ctx.threw = null;
    } catch (err) {
      ctx.threw = err;
    }
  });

  scoped(/^the sweep returns the root removed, after (\d+) attempts?$/, (ctx, attempts) => {
    assert.equal(ctx.threw, null, `expected no throw, got: ${ctx.threw && ctx.threw.message}`);
    assert.deepEqual(ctx.result, [ctx.root]);
    assert.equal(ctx.getCalls(), Number(attempts), 'expected exactly the named number of removal attempts');
    assert.equal(fs.existsSync(ctx.root), false);
  });

  scoped(/^the sweep rethrows ENOTEMPTY after its bounded attempts$/, (ctx) => {
    try {
      assert.ok(ctx.threw, 'expected the sweep to throw rather than swallow the error');
      assert.equal(ctx.threw.code, 'ENOTEMPTY');
      assert.equal(ctx.getCalls(), 5, 'expected exactly the bounded number of attempts, never more');
    } finally {
      // The stub never actually removed it - the real fs still owns it.
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  // ── Scenario 03: the census pin over the real committed test file ───────
  scoped(/^the source of extension\/test\/telegramCursorOperatorExec\.test\.js is read$/, (ctx) => {
    ctx.source = fs.readFileSync(path.join(REPO_ROOT, TARGET_FILE_REL), 'utf8');
  });

  scoped(/^exactly (\d+) tests? in it spawns? a redeploy script through executeOperatorVerb$/, (ctx, count) => {
    // Every top-level test in this file starts a line with the literal
    // `test(` - splitting there isolates one test's own body per chunk,
    // no brace-counting needed for this file's own convention.
    const blocks = ctx.source.split(/\n(?=test\()/).filter((b) => b.trimStart().startsWith('test('));
    ctx.spawningBlocks = blocks.filter((b) =>
      /executeOperatorVerb\(root,\s*['"]\/redeploy['"],\s*['"](frontdesk|all)['"]\)/.test(b)
    );
    assert.equal(
      ctx.spawningBlocks.length,
      Number(count),
      `expected ${count} spawning test(s), found ${ctx.spawningBlocks.length}`
    );
  });

  scoped(/^each of those \d+ tests waits for its marker and asserts it exists before the test returns$/, (ctx) => {
    for (const block of ctx.spawningBlocks) {
      assert.match(block, /waitForFileSync\(/, 'expected a waitForFileSync call in this spawning test');
      assert.match(block, /assert\.ok\(waited\.ok/, 'expected an assertion on the wait result in this spawning test');
    }
  });
}

module.exports = { registerSteps };
