'use strict';

// BL-1136: stamp-off of Cursor hotfix fbf6f1a909. Confirms babysitterd
// pulse_heartbeat wiring and cursor-forge pack parse at that commit —
// never reimplements the hotfix; never writes Hotfix-Certification certified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  'BL-1136 stamp-off of Cursor hotfix fbf6f1a909';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = 'fbf6f1a909';
const BABYSITTERD = 'swarmforge/scripts/babysitterd.sh';
const PACK = 'swarmforge/packs/cursor-forge.conf';

function gitShow(rev, file) {
  return execFileSync('git', ['show', `${rev}:${file}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^bl1136BabysitterdCursorForgeStampOffSteps acceptance handler is registered$/, () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(
      idx.includes('bl1136BabysitterdCursorForgeStampOffSteps'),
      'expected bl1136BabysitterdCursorForgeStampOffSteps registered in index.js'
    );
  });

  // ── babysitterd-pulse-helper-01 ──────────────────────────────────────
  scoped(
    /^the source of swarmforge\/scripts\/babysitterd\.sh at commit fbf6f1a909$/,
    (ctx) => {
      const tipType = execFileSync('git', ['cat-file', '-t', HOTFIX], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
      assert.equal(tipType, 'commit', `hotfix ${HOTFIX} must be reachable`);
      ctx.babysitterdSrc = gitShow(HOTFIX, BABYSITTERD);
    }
  );

  scoped(/^the pulse helper is inspected$/, (ctx) => {
    assert.ok(typeof ctx.babysitterdSrc === 'string' && ctx.babysitterdSrc.length > 0);
  });

  scoped(
    /^it defines a pulse_heartbeat function that appends a heartbeat line to the daemon log$/,
    (ctx) => {
      assert.match(ctx.babysitterdSrc, /pulse_heartbeat\s*\(\)\s*\{/);
      assert.match(ctx.babysitterdSrc, /heartbeat\\n/);
      assert.match(ctx.babysitterdSrc, />>\s*"\$LOG"/);
    }
  );

  // ── babysitterd-start-and-tick-pulses-02 ─────────────────────────────
  scoped(/^the cold-start path and the tick function are inspected$/, (ctx) => {
    assert.ok(ctx.babysitterdSrc.includes('tick()'));
    ctx.tickBlock = ctx.babysitterdSrc.match(/tick\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(ctx.tickBlock.length > 0, 'expected tick() body');
  });

  scoped(/^pulse_heartbeat is invoked before the first tick loop iteration$/, (ctx) => {
    // Cold-start pulse sits after pidfile write and before `while true`.
    const cold = ctx.babysitterdSrc.match(
      /babysitterd start[\s\S]*?pulse_heartbeat[\s\S]*?while true/
    );
    assert.ok(cold, 'expected pulse_heartbeat between start log and while true');
  });

  scoped(/^pulse_heartbeat is invoked at the start of tick before babysitter_check$/, (ctx) => {
    assert.match(
      ctx.tickBlock,
      /pulse_heartbeat[\s\S]*babysitter_check\.sh/,
      'tick must pulse before babysitter_check'
    );
  });

  scoped(
    /^pulse_heartbeat is invoked at the end of tick after babysitter_check returns$/,
    (ctx) => {
      assert.match(
        ctx.tickBlock,
        /babysitter_check\.sh[\s\S]*pulse_heartbeat/,
        'tick must pulse after babysitter_check'
      );
    }
  );

  // ── cursor-forge-omits-rotation-standing-03 ──────────────────────────
  scoped(
    /^the source of swarmforge\/packs\/cursor-forge\.conf at commit fbf6f1a909$/,
    (ctx) => {
      ctx.packSrc = gitShow(HOTFIX, PACK);
    }
  );

  scoped(/^the pack config lines are inspected$/, (ctx) => {
    assert.ok(typeof ctx.packSrc === 'string' && ctx.packSrc.length > 0);
    ctx.packLines = ctx.packSrc
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('config '));
  });

  scoped(/^there is no config rotation standing line$/, (ctx) => {
    assert.ok(
      !ctx.packLines.some((l) => /^config\s+rotation\s+standing\b/.test(l)),
      'config rotation standing must be absent'
    );
  });

  scoped(
    /^the pack does not set config rotation to any value other than sequential or router$/,
    (ctx) => {
      const rotation = ctx.packLines.filter((l) => /^config\s+rotation\b/.test(l));
      for (const line of rotation) {
        assert.match(
          line,
          /^config\s+rotation\s+(sequential|router)\b/,
          `invalid rotation line: ${line}`
        );
      }
    }
  );
}

module.exports = { registerSteps };
