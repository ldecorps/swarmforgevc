'use strict';

// BL-1766: step handlers for "the register CLI's 'no date reads today'
// property compares against the CLI's own local day" - runs the REAL
// property file's one test under vitest's own runner with a `-t` filter,
// under a real TZ override, never a reimplementation of the property or
// the CLI.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1766 the register CLI's \"no date reads today\" property compares against the CLI's own local day";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the process time zone is "([^"]+)"$/, (ctx, zone) => {
    ctx.zone = zone;
  });

  scoped(
    /^the property "([^"]+)" in "([^"]+)" runs alone$/,
    (ctx, testName, file) => {
      // Hardening gap closed (BL-113 mutation on the Examples cell): an
      // invalid TZ string (a case/typo mutation of "Etc/GMT-14" or
      // "Etc/GMT+12") is never rejected by Node - it silently falls back
      // to UTC offset 0, verified live: `TZ=etc/GMT-14 node -e
      // 'console.log(new Date().getTimezoneOffset())'` prints 0, same as
      // the mutated "Etc/GMTx12". Both real zones are always nonzero
      // (-840 / 720). Silently running under UTC would make even the
      // PRE-FIX property pass (its bug only manifests when the local day
      // differs from the UTC day, which UTC itself can never do) -
      // exactly the case this scenario exists to rule out, so a typo'd
      // zone that quietly became UTC must fail loudly here, before the
      // property itself is ever spawned.
      const offsetCheck = spawnSync('node', ['-e', 'console.log(new Date().getTimezoneOffset())'], {
        encoding: 'utf8',
        env: { ...process.env, TZ: ctx.zone },
      });
      assert.notEqual(
        Number(offsetCheck.stdout.trim()),
        0,
        `expected TZ "${ctx.zone}" to apply a nonzero UTC offset, got 0 (an invalid/typo zone string silently falls back to UTC)`
      );
      const relativeToExtension = file.replace(/^extension\//, '');
      const result = spawnSync(
        'npx',
        ['vitest', 'run', '--config', 'vitest.properties.config.mjs', '-t', testName, relativeToExtension],
        { cwd: path.join(REPO_ROOT, 'extension'), encoding: 'utf8', env: { ...process.env, TZ: ctx.zone } }
      );
      ctx.result = result;
    }
  );

  scoped(/^it passes$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected the filtered run to pass, got:\n${ctx.result.stdout}\n${ctx.result.stderr}`);
  });

  scoped(/^exactly (\d+) test ran$/, (ctx, count) => {
    // BL-1445: a `-t` filter that matches nothing still exits 0 with zero
    // tests run - a renamed test must never silently pass as "0 tests".
    const match = ctx.result.stdout.match(/Tests\s+(\d+) passed/);
    assert.ok(match, `expected a "Tests N passed" summary line, got:\n${ctx.result.stdout}`);
    assert.equal(Number(match[1]), Number(count), `expected exactly ${count} test to run, got:\n${ctx.result.stdout}`);
  });
}

module.exports = { registerSteps };
