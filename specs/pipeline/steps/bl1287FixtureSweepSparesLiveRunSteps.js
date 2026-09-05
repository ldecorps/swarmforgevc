'use strict';

// BL-1287: step handlers driving the REAL leakedFixtureTunnelPids
// (extension/test/helpers/fixtureTunnelName.js) against REAL processes -
// never a fabricated process table.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { leakedFixtureTunnelPids } = require(
  path.join(EXTENSION_DIR, 'test', 'helpers', 'fixtureTunnelName.js')
);
const { killPid, spawnFakeCloudflared, nameWithCreator, deadPid } = require(
  path.join(EXTENSION_DIR, 'test', 'helpers', 'bl1287FixtureSweepFixture.js')
);

const FEATURE = 'A fixture-tunnel sweep never signals a fixture a live run still owns';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the leaked-fixture sweep the tunnel property suites share$/, (ctx) => {
    ctx.bl1287 = { cleanups: [] };
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^a fixture cloudflared under the OS temp directory bound to its own unique tunnel name$/, (ctx) => {
    ctx.bl1287.pendingFixture = true;
  });

  scoped(/^the run that created that fixture is (.+)$/, (ctx, creator) => {
    let creatorPid;
    if (creator === 'still alive') {
      creatorPid = process.pid;
    } else if (creator === 'gone') {
      creatorPid = deadPid();
    } else {
      throw new Error(`unknown <creator>: ${creator}`);
    }
    const name = nameWithCreator(creatorPid);
    const pid = spawnFakeCloudflared(name);
    ctx.bl1287.cleanups.push(() => killPid(pid));
    ctx.bl1287.subjectPid = pid;
  });

  scoped(/^the sweep selects the fixture pids it will signal$/, (ctx) => {
    ctx.bl1287.selected = leakedFixtureTunnelPids(execFileSync);
  });

  scoped(/^that fixture pid is (absent from|present in) the selection$/, (ctx, disposition) => {
    const isSelected = ctx.bl1287.selected.includes(ctx.bl1287.subjectPid);
    const expectSelected = disposition === 'present in';
    assert.equal(
      isSelected,
      expectSelected,
      `expected pid ${ctx.bl1287.subjectPid} to be ${disposition} the selection, got selected=${isSelected}: ${JSON.stringify(ctx.bl1287.selected)}`
    );
    ctx.bl1287.cleanups.forEach((fn) => fn());
    ctx.bl1287.cleanups = [];
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a cloudflared running from an installed path outside the OS temp directory$/, (ctx) => {
    ctx.bl1287.installedDir = fs.mkdtempSync(path.join(os.homedir(), '.bl1287-installed-'));
  });

  scoped(/^it serves the same tunnel name a fixture is using$/, (ctx) => {
    // A DEAD creator pid, deliberately - if the temp-path boundary were the
    // only thing removed, the creator-liveness check would otherwise WAVE
    // this straight through (a dead creator normally qualifies for
    // sweeping), so this isolates the temp-path filter as the one thing
    // standing between the installed process and being selected. A real
    // temp-path fixture shares the exact same name, proving it IS the
    // "same tunnel name a fixture is using" the scenario names, and that
    // the sweep still tells the two apart correctly (own-directory
    // fixture selected, installed-path one never).
    const creatorPid = deadPid();
    const name = nameWithCreator(creatorPid);
    ctx.bl1287.matchingFixturePid = spawnFakeCloudflared(name);
    const pid = spawnFakeCloudflared(name, ctx.bl1287.installedDir);
    ctx.bl1287.cleanups.push(() => killPid(pid));
    ctx.bl1287.cleanups.push(() => killPid(ctx.bl1287.matchingFixturePid));
    ctx.bl1287.cleanups.push(() => fs.rmSync(ctx.bl1287.installedDir, { recursive: true, force: true }));
    ctx.bl1287.subjectPid = pid;
  });

  scoped(/^that installed process is absent from the selection$/, (ctx) => {
    assert.ok(
      !ctx.bl1287.selected.includes(ctx.bl1287.subjectPid),
      `expected the installed-path process (pid ${ctx.bl1287.subjectPid}) to never be selected, got: ${JSON.stringify(ctx.bl1287.selected)}`
    );
    // Non-vacuity: the matching temp-path fixture (same name, same dead
    // creator) IS selected - proving the creator check alone would have
    // waved the installed one through too, so the temp-path filter is the
    // thing actually doing the protecting here.
    assert.ok(
      ctx.bl1287.selected.includes(ctx.bl1287.matchingFixturePid),
      `expected the matching temp-path fixture (pid ${ctx.bl1287.matchingFixturePid}) to be selected, got: ${JSON.stringify(ctx.bl1287.selected)}`
    );
    ctx.bl1287.cleanups.forEach((fn) => fn());
    ctx.bl1287.cleanups = [];
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^two property suites running concurrently in the same fork pool$/, (ctx) => {
    // Modelled as two DIFFERENT creator pids - both genuinely alive
    // processes on this host (this step handler's own pid, and a
    // freshly-spawned long-lived helper standing in for the "other" fork).
    const other = spawnSync('bash', ['-c', 'sleep 300 >/dev/null 2>&1 & echo $!']);
    ctx.bl1287.otherCreatorPid = Number(other.stdout.toString().trim());
    ctx.bl1287.cleanups.push(() => killPid(ctx.bl1287.otherCreatorPid));
  });

  scoped(/^each has spawned its own live fixture cloudflared$/, (ctx) => {
    ctx.bl1287.ownFixturePid = spawnFakeCloudflared(nameWithCreator(process.pid));
    ctx.bl1287.otherFixturePid = spawnFakeCloudflared(nameWithCreator(ctx.bl1287.otherCreatorPid));
    ctx.bl1287.cleanups.push(() => killPid(ctx.bl1287.ownFixturePid));
    ctx.bl1287.cleanups.push(() => killPid(ctx.bl1287.otherFixturePid));
  });

  scoped(/^one of those suites runs its leaked-fixture sweep$/, (ctx) => {
    ctx.bl1287.selected = leakedFixtureTunnelPids(execFileSync);
  });

  scoped(/^the other suite's fixture is still alive$/, (ctx) => {
    assert.ok(
      !ctx.bl1287.selected.includes(ctx.bl1287.otherFixturePid),
      `expected the other suite's fixture (pid ${ctx.bl1287.otherFixturePid}) to survive the sweep, got: ${JSON.stringify(ctx.bl1287.selected)}`
    );
    let stillAlive = true;
    try {
      process.kill(ctx.bl1287.otherFixturePid, 0);
    } catch {
      stillAlive = false;
    }
    assert.ok(stillAlive, `expected the other suite's fixture (pid ${ctx.bl1287.otherFixturePid}) to actually still be running`);
    ctx.bl1287.cleanups.forEach((fn) => fn());
    ctx.bl1287.cleanups = [];
  });
}

module.exports = { registerSteps };
