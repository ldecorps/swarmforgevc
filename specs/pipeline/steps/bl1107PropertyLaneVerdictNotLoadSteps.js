'use strict';

// BL-1107: property-lane verdict must not depend on host load. Drives the
// REAL bl796 property file on the property lane (vitest.properties.config.mjs)
// and inspects spawn/coverage artifacts that file writes under BL1107_* env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const PROPERTY_FILE = 'test/bl796NvmNodePathFollowUpAdoptInvariants.property.test.js';
const LANE_CONFIG = path.join(EXTENSION_DIR, 'vitest.properties.config.mjs');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_path_lib.sh');

const FEATURE = 'A property lane verdict turns on the code, not on host load';

const KNOWN_PROPERTIES = {
  '2': { points: 4, name: 'invariant 2' },
  '3': { points: 6, name: 'invariant 3' },
};

const ALL_PAIRS = ['bb:back', 'bb:front', 'bb:middle', 'node:back', 'node:front', 'node:middle'];

function runPropertyLane(extraEnv = {}, testNameFilter) {
  const vitest = path.join(EXTENSION_DIR, 'node_modules', '.bin', 'vitest');
  const args = ['run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE];
  if (testNameFilter) {
    args.push('-t', testNameFilter);
  }
  return spawnSync(vitest, args, {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, ...extraEnv },
  });
}

function writeBrokenLib(dest) {
  const original = fs.readFileSync(LIB, 'utf8');
  // Deliberately reverse search order so curated/nvm fallback wins over the
  // caller's PATH — the exact shadowing invariant 3 forbids.
  const broken = original.replace(
    '_search_path="${PATH:-/usr/bin:/bin}:${_fallback_dirs}"',
    '_search_path="${_fallback_dirs}:${PATH:-/usr/bin:/bin}"'
  );
  assert.notEqual(broken, original, 'expected to locate the search-path line to break');
  fs.writeFileSync(dest, broken);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the property lane's per-test budget is 20 seconds$/, () => {
    const src = fs.readFileSync(LANE_CONFIG, 'utf8');
    assert.match(src, /testTimeout:\s*20000/, 'lane default testTimeout must still be 20000');
  });

  scoped(/^the host is under the load of a normal shift$/, () => {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, '.swarmforge', 'swarm-identity')) ||
        fs.existsSync(path.join(REPO_ROOT, '..', '..', '.swarmforge', 'swarm-identity')),
      'no .swarmforge/swarm-identity — scenario must run on the live swarm host'
    );
  });

  scoped(/^the property lane runs the bl796 file$/, (ctx) => {
    const result = runPropertyLane();
    ctx.bl1107 = {
      ...(ctx.bl1107 || {}),
      fullRun: {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
      },
    };
  });

  scoped(/^every property in it passes$/, (ctx) => {
    const { status, output } = ctx.bl1107.fullRun;
    assert.equal(status, 0, `bl796 property file exited ${status}:\n${output.slice(-3000)}`);
    assert.match(output, /Tests\s+\d+ passed/, `expected passed summary:\n${output.slice(-2000)}`);
  });

  scoped(/^none of them ends by exceeding the per-test budget$/, (ctx) => {
    const { output } = ctx.bl1107.fullRun;
    assert.ok(!/Test timed out in \d+ms/.test(output), `a test exceeded its budget:\n${output.slice(-2000)}`);
  });

  scoped(/^property "([^"]+)" whose input space holds (\d+) points$/, (ctx, prop, pointsStr) => {
    if (!(prop in KNOWN_PROPERTIES)) {
      throw new Error(`BL-1107: unrecognized property "${prop}" — not in KNOWN_VALUES`);
    }
    const points = Number(pointsStr);
    assert.equal(points, KNOWN_PROPERTIES[prop].points, `KNOWN_VALUES points mismatch for property ${prop}`);
    ctx.bl1107 = { ...(ctx.bl1107 || {}), property: prop, points };
  });

  scoped(/^the property lane runs it$/, (ctx) => {
    const spawnLog = path.join(os.tmpdir(), `bl1107-spawns-${process.pid}.log`);
    try {
      fs.unlinkSync(spawnLog);
    } catch {
      /* absent */
    }
    const filter = KNOWN_PROPERTIES[ctx.bl1107.property].name;
    const extra = { BL1107_SPAWN_LOG: spawnLog };
    if (ctx.bl1107.brokenLib) {
      extra.BL1107_LIB_OVERRIDE = ctx.bl1107.brokenLib;
    }
    const result = runPropertyLane(extra, filter);
    ctx.bl1107.lastRun = {
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`,
      spawnLog,
    };
  });

  scoped(/^it spawns at most (\d+) subprocesses$/, (ctx, maxStr) => {
    const max = Number(maxStr);
    assert.equal(max, ctx.bl1107.points);
    const { status, output, spawnLog } = ctx.bl1107.lastRun;
    assert.equal(status, 0, `property ${ctx.bl1107.property} failed:\n${output.slice(-2000)}`);
    const lines = fs.readFileSync(spawnLog, 'utf8').trim().split('\n').filter(Boolean);
    const mine = lines.filter((l) => l.startsWith(`${ctx.bl1107.property} `));
    assert.ok(mine.length >= 1, `no spawn log line for property ${ctx.bl1107.property}: ${lines.join('|')}`);
    const count = Number(mine[mine.length - 1].split(/\s+/)[1]);
    assert.ok(count <= max, `property ${ctx.bl1107.property} spawned ${count}, max ${max}`);
  });

  scoped(/^property 3 whose space is every binary paired with every position$/, (ctx) => {
    ctx.bl1107 = { ...(ctx.bl1107 || {}), property: '3', points: 6, coverageRuns: [] };
  });

  scoped(/^the property lane runs it repeatedly$/, (ctx) => {
    const coverages = [];
    for (let i = 0; i < 2; i += 1) {
      const coverageLog = path.join(os.tmpdir(), `bl1107-cov-${process.pid}-${i}.log`);
      const result = runPropertyLane({ BL1107_COVERAGE_LOG: coverageLog }, 'invariant 3');
      assert.equal(result.status, 0, `coverage run ${i} failed:\n${(result.stdout || '') + (result.stderr || '')}`.slice(-2000));
      coverages.push(fs.readFileSync(coverageLog, 'utf8').trim());
    }
    ctx.bl1107.coverageRuns = coverages;
  });

  scoped(/^every pair is exercised on every run$/, (ctx) => {
    for (const [i, text] of ctx.bl1107.coverageRuns.entries()) {
      const got = text.split('\n').filter(Boolean).sort();
      assert.deepEqual(got, ALL_PAIRS, `run ${i} missed pairs: got ${got.join(',')}`);
    }
  });

  scoped(/^which pairs were exercised does not differ between runs$/, (ctx) => {
    const [a, b] = ctx.bl1107.coverageRuns;
    assert.equal(a, b, `coverage differed across runs:\n---\n${a}\n---\n${b}`);
  });

  scoped(/^property 3 and a caller binary shadowed by a discovered installation$/, (ctx) => {
    const broken = path.join(os.tmpdir(), `bl1107-broken-lib-${process.pid}.sh`);
    writeBrokenLib(broken);
    ctx.bl1107 = { ...(ctx.bl1107 || {}), property: '3', points: 6, brokenLib: broken };
  });

  scoped(/^it fails because the caller's binary did not win$/, (ctx) => {
    const { status, output } = ctx.bl1107.lastRun;
    assert.notEqual(status, 0, `expected property 3 to fail under a shadowing lib, got green:\n${output.slice(-1500)}`);
    assert.match(
      output,
      /expected the caller's own|to win at position/,
      `failure must name the caller's-binary assertion, got:\n${output.slice(-2500)}`
    );
  });

  scoped(/^it does not fail by exceeding the per-test budget$/, (ctx) => {
    const { output } = ctx.bl1107.lastRun;
    assert.ok(!/Test timed out in \d+ms/.test(output), `failed by timeout, not by assertion:\n${output.slice(-2000)}`);
  });
}

module.exports = { registerSteps };
