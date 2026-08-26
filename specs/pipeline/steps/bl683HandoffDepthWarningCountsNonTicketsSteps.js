'use strict';

// BL-683: depth warning counts tickets, not directory entries.
// Product already landed as BL-808 (count-active-tickets); this tip arms
// the original ticket's APS against the REAL shared counters.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'the handoff depth warning counts tickets, not directory entries';
const SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS, 'swarm_handoff.bb');
const BACKLOG_DEPTH_LIB = path.join(SCRIPTS, 'backlog_depth_lib.bb');
const CHASE_SWEEP_LIB = path.join(SCRIPTS, 'chase_sweep_lib.bb');

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureFixture(ctx) {
  if (ctx.bl683) {
    return ctx.bl683;
  }
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl683-depth-'));
  git(targetPath, ['init', '-q']);
  git(targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${targetPath}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
  const activeDir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  // Cap 0 so any ticket count > 0 prints the warning with the active=N figure.
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 0\n');
  ctx.bl683 = { targetPath, activeDir };
  return ctx.bl683;
}

function setTickets(ctx, n) {
  const st = ensureFixture(ctx);
  for (const name of fs.readdirSync(st.activeDir)) {
    if (name.endsWith('.yaml')) {
      fs.unlinkSync(path.join(st.activeDir, name));
    }
  }
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(st.activeDir, `BL-${i}-demo.yaml`), `id: BL-${i}\ntitle: "demo"\nstatus: active\n`);
  }
  st.ticketCount = n;
}

function bbCount(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function countActiveTickets(activeDir) {
  return Number(
    bbCount(
      `(load-file "${BACKLOG_DEPTH_LIB}") (println (backlog-depth-lib/count-active-tickets "${activeDir}"))`
    )
  );
}

function countBacklogYaml(activeDir) {
  return Number(
    bbCount(
      `(load-file "${CHASE_SWEEP_LIB}") (println (chase-sweep-lib/count-backlog-yaml "${activeDir}"))`
    )
  );
}

function countStatusSnapshotYaml(activeDir) {
  return Number(
    bbCount(
      `(require '[babashka.fs :as fs]) (require '[clojure.string :as str]) (println (count (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".yaml")) (fs/list-dir "${activeDir}"))))`
    )
  );
}

function runDepthCheck(ctx) {
  const { targetPath } = ensureFixture(ctx);
  const draft = path.join(targetPath, 'draft.txt');
  fs.writeFileSync(draft, 'type: awake\nto: coordinator\npriority: 50\n');
  const result = spawnSync('bb', [SWARM_HANDOFF, draft], {
    cwd: targetPath,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'coordinator', SWARMFORGE_SKIP_SYNC_INJECT: '1' },
  });
  ctx.bl683.handoffOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.bl683.handoffOutput;
}

function reportedActiveFromWarning(output) {
  const m = /Active backlog depth exceeded \(active=(\d+), max=/.exec(output || '');
  return m ? Number(m[1]) : null;
}

function registerSteps(registry) {
  scoped(registry, /^an active backlog directory containing a \.gitkeep file$/, (ctx) => {
    const st = ensureFixture(ctx);
    fs.writeFileSync(path.join(st.activeDir, '.gitkeep'), '');
  });

  scoped(registry, /^the directory holds four ticket files$/, (ctx) => {
    setTickets(ctx, 4);
  });

  scoped(registry, /^the directory holds no ticket files$/, (ctx) => {
    setTickets(ctx, 0);
  });

  scoped(registry, /^the handoff depth check runs$/, (ctx) => {
    runDepthCheck(ctx);
  });

  scoped(registry, /^the reported active count is four$/, (ctx) => {
    assert.equal(reportedActiveFromWarning(ctx.bl683.handoffOutput), 4);
  });

  scoped(registry, /^the reported active count is zero$/, (ctx) => {
    // Cap 0 + zero tickets: depth-exceeded? is false (0 > 0 is false), so no
    // warning. Prove the shared counter itself is 0 (and handoff stayed silent).
    const { activeDir, handoffOutput } = ensureFixture(ctx);
    assert.equal(countActiveTickets(activeDir), 0);
    assert.equal(reportedActiveFromWarning(handoffOutput), null);
    assert.doesNotMatch(handoffOutput || '', /Active backlog depth exceeded/i);
  });

  scoped(
    registry,
    /^the handoff depth check, the open-slot gate and the status snapshot report the same count$/,
    (ctx) => {
      const { activeDir } = ensureFixture(ctx);
      setTickets(ctx, 4);
      fs.writeFileSync(path.join(activeDir, '.gitkeep'), '');
      runDepthCheck(ctx);
      const warningCount = reportedActiveFromWarning(ctx.bl683.handoffOutput);
      const libCount = countActiveTickets(activeDir);
      const openSlotCount = countBacklogYaml(activeDir);
      // Status snapshot uses the same yaml-only filter (handoffd count-yaml-files).
      const statusCount = countStatusSnapshotYaml(activeDir);
      assert.equal(warningCount, 4);
      assert.equal(libCount, 4);
      assert.equal(openSlotCount, 4);
      assert.equal(statusCount, 4);
      assert.equal(warningCount, libCount);
      assert.equal(warningCount, openSlotCount);
      assert.equal(warningCount, statusCount);
    }
  );
}

module.exports = { registerSteps };
