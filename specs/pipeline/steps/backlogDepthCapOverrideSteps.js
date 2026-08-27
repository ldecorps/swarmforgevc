'use strict';

// BL-313: step handlers for "The real backlog-depth cap enforcement
// respects whichever pack/config actually launched the swarm". Drives the
// REAL swarm_handoff.bb (the WARNING) and backlog_depth_lib.bb's own
// under-depth-cap? (the AUTO-PROMOTE computation, same posture as
// backlogDepthSteps.js's own readMaxDepth/under-depth-cap? drive - see
// that file's header for why ready_for_next.bb's own call site is
// unreachable and not invoked end-to-end here) against a fixture whose
// .swarmforge/swarm-identity persists an effective config path, exactly
// as swarmforge.sh's write_swarm_identity_file now does at launch time -
// never a real swarmforge.sh invocation (that would need a real tmux
// socket/session; test_backlog_depth_pack_override.sh already covers the
// bash-side identity-persistence + banner wiring directly).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_DIR = path.join(REPO_ROOT, 'swarmforge');
const SWARMFORGE_SCRIPTS = path.join(SWARMFORGE_DIR, 'scripts');
const SWARMFORGE_SH = path.join(SWARMFORGE_SCRIPTS, 'swarmforge.sh');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const BACKLOG_DEPTH_LIB = path.join(SWARMFORGE_SCRIPTS, 'backlog_depth_lib.bb');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function mkTargetPath() {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backlog-depth-override-'));
  git(targetPath, ['init', '-q']);
  git(targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return targetPath;
}

function writeDefaultConf(targetPath, cap) {
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function writeRolesTsv(targetPath) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${targetPath}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
}

// The exact persistence shape write_swarm_identity_file writes (BL-313):
// active_backlog_max_depth + active_backlog_max_depth_conf_path alongside
// the pre-existing swarm_name/swarm_mode/swarm_mode_primary lines.
function writeIdentityWithOverride(targetPath, cap, confPath) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'swarm-identity'),
    `swarm_name\tprimary\nswarm_mode\tautonomous\nactive_backlog_max_depth\t${cap}\nactive_backlog_max_depth_conf_path\t${confPath}\n`
  );
}

function writeActiveItems(targetPath, n) {
  const dir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(dir, `BL-${i}-demo.yaml`), `id: BL-${i}\ntitle: "demo"\nstatus: active\n`);
  }
}

function runSwarmHandoffWarning(targetPath) {
  writeRolesTsv(targetPath);
  const draft = path.join(targetPath, 'draft.txt');
  fs.writeFileSync(draft, 'type: awake\nto: coordinator\npriority: 50\n');
  const env = { ...process.env, SWARMFORGE_ROLE: 'coordinator', SWARMFORGE_SKIP_SYNC_INJECT: '1' };
  const result = spawnSync('bb', [SWARM_HANDOFF, draft], { cwd: targetPath, encoding: 'utf8', env });
  return (result.stdout || '') + (result.stderr || '');
}

function readMaxDepth(targetPath) {
  return execFileSync('bb', ['-e', `(load-file "${BACKLOG_DEPTH_LIB}") (println (backlog-depth-lib/read-max-depth "${targetPath}"))`], {
    encoding: 'utf8',
  }).trim();
}

function underDepthCap(targetPath, activeCount) {
  return execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${BACKLOG_DEPTH_LIB}") (let [d (backlog-depth-lib/read-max-depth "${targetPath}")] (println (backlog-depth-lib/under-depth-cap? ${activeCount} d)))`,
    ],
    { encoding: 'utf8' }
  ).trim();
}

// Ground truth for the tracked repo's own conf files at the time this
// ticket's fix landed - "no pack's declared cap value is changed" (scope
// item 4/5) asserted against the REAL tracked files, not a copy.
const TRACKED_CAPS = {
  'swarmforge/swarmforge.conf': -1,
  'swarmforge/packs/resilience-min.conf': 1,
  'swarmforge/packs/two-pack.conf': 1,
  'swarmforge/packs/two-pack-mistral.conf': 1,
};

function registerSteps(registry) {
  // ── depth-cap-override-01 ───────────────────────────────────────────────
  registry.define(/^the swarm was launched with a pack declaring active_backlog_max_depth 1$/, (ctx) => {
    ctx.targetPath = mkTargetPath();
    // The default file deliberately declares -1 (unlimited) so a warning
    // firing at all proves the PACK's cap (1) won, not the default's.
    writeDefaultConf(ctx.targetPath, -1);
    const packConfPath = path.join(ctx.targetPath, 'altpack.conf');
    fs.writeFileSync(packConfPath, 'config active_backlog_max_depth 1\n');
    writeIdentityWithOverride(ctx.targetPath, 1, packConfPath);
  });

  registry.define(/^the backlog has more active items than that pack's declared cap$/, (ctx) => {
    writeActiveItems(ctx.targetPath, 2); // 2 > the pack's declared cap of 1
  });

  // ── depth-cap-override-01/02 shared When ────────────────────────────────
  registry.define(/^the depth WARNING and AUTO-PROMOTE gates evaluate$/, (ctx) => {
    ctx.warningOutput = runSwarmHandoffWarning(ctx.targetPath);
    const activeCount = fs.readdirSync(path.join(ctx.targetPath, 'backlog', 'active')).length;
    ctx.underCap = underDepthCap(ctx.targetPath, activeCount);
    ctx.effectiveMaxDepth = readMaxDepth(ctx.targetPath);
  });

  registry.define(/^they enforce the pack's declared cap, not the default config's$/, (ctx) => {
    if (ctx.effectiveMaxDepth !== '1') {
      throw new Error(`expected the enforced cap to be the pack's 1, not the default's -1; got: ${ctx.effectiveMaxDepth}`);
    }
    if (!/Active backlog depth exceeded \(active=2, max=1\)/i.test(ctx.warningOutput)) {
      throw new Error(`expected the WARNING to fire with the pack's cap (max=1), got: ${ctx.warningOutput}`);
    }
    if (ctx.underCap !== 'false') {
      throw new Error(`expected the AUTO-PROMOTE gate to be closed under the pack's cap of 1 with 2 active, got: ${ctx.underCap}`);
    }
  });

  // ── depth-cap-override-02 ───────────────────────────────────────────────
  registry.define(/^the swarm was launched with no pack or config override$/, (ctx) => {
    ctx.targetPath = mkTargetPath();
    writeDefaultConf(ctx.targetPath, 3);
    // Deliberately no .swarmforge/swarm-identity at all - a bare launch.
    writeActiveItems(ctx.targetPath, 5); // 5 > the default's declared cap of 3
  });

  registry.define(/^they enforce the default swarmforge\.conf's own declared cap$/, (ctx) => {
    if (ctx.effectiveMaxDepth !== '3') {
      throw new Error(`expected the enforced cap to be the default file's own 3, got: ${ctx.effectiveMaxDepth}`);
    }
    if (!/Active backlog depth exceeded \(active=5, max=3\)/i.test(ctx.warningOutput)) {
      throw new Error(`expected the WARNING to fire with the default's cap (max=3), got: ${ctx.warningOutput}`);
    }
    if (ctx.underCap !== 'false') {
      throw new Error(`expected the AUTO-PROMOTE gate to be closed under the default's cap of 3 with 5 active, got: ${ctx.underCap}`);
    }
  });

  // ── depth-cap-override-03: structural - the banner's wiring is locked in
  //    swarmforge.sh's own source (the value itself is proven correct by
  //    the two scenarios above + test_backlog_depth_cli.sh/
  //    test_backlog_depth_pack_override.sh) ───────────────────────────────
  registry.define(/^the swarm has just launched$/, () => {
    // Nothing to set up - the Then step reads swarmforge.sh's own source.
  });

  registry.define(/^the launch banner is shown$/, (ctx) => {
    ctx.swarmforgeShSource = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  });

  registry.define(/^it states the effective active_backlog_max_depth and which config file supplied it$/, (ctx) => {
    if (!ctx.swarmforgeShSource.includes('active_backlog_max_depth: ${EFFECTIVE_MAX_DEPTH} (from ${CONFIG_FILE})')) {
      throw new Error('expected the launch banner to print the effective active_backlog_max_depth and its source config');
    }
  });

  // ── depth-cap-override-04 ───────────────────────────────────────────────
  registry.define(/^each pack's own conf file declared a cap before this fix$/, (ctx) => {
    ctx.trackedCaps = TRACKED_CAPS;
  });

  registry.define(/^this fix is applied$/, (ctx) => {
    ctx.trackedCapsNow = {};
    for (const relPath of Object.keys(ctx.trackedCaps)) {
      const text = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      const match = text.match(/config active_backlog_max_depth\s+(-?\d+)/);
      ctx.trackedCapsNow[relPath] = match ? Number(match[1]) : null;
    }
  });

  registry.define(/^each pack's conf file still declares the same cap value as before$/, (ctx) => {
    for (const [relPath, expected] of Object.entries(ctx.trackedCaps)) {
      const actual = ctx.trackedCapsNow[relPath];
      if (actual !== expected) {
        throw new Error(`expected ${relPath} to still declare active_backlog_max_depth ${expected}, got: ${actual}`);
      }
    }
  });
}

module.exports = { registerSteps };
