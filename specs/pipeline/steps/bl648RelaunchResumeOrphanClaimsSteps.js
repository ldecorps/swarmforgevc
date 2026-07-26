'use strict';

// BL-648: step handlers for "Relaunch resumes the recorded role and reclaims
// orphaned claims". Drives the REAL relaunch_resume_cli.bb (resolve-boot-role
// + sweep subcommands, which in turn wire mono_router_lib.bb/resolve-boot-role
// and orphan_claim_sweep_lib.bb/sweep!) against a plain fixture project root -
// no live tmux and no real swarm needed, since neither subcommand calls git
// or reads any CWD-derived path (relaunch_resume_cli.bb is deliberately
// root-explicit throughout).
//
// The Background's "injected session-liveness ... seam" is a fake `tmux`
// executable placed first on PATH: handoff_lib.bb's session-exists? shells
// out to `tmux -S <socket> has-session -t <session>`, and the fake accepts
// or refuses based on a plain alive-sessions file the steps below control -
// so "owning session is dead/alive" is a real subprocess exit code the CLI
// observes, not a stubbed-out function.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS_DIR, 'relaunch_resume_cli.bb');

const HOME_ROLE = 'coder';
const PIPELINE_ROLES = ['coder', 'specifier', 'cleaner', 'architect', 'QA', 'coordinator'];

function sessionNameFor(role) {
  return `swarmforge-${role}`;
}

function writeFakeTmux(fixtureDir) {
  const fakeBinDir = path.join(fixtureDir, '.fake-bin');
  fs.mkdirSync(fakeBinDir, { recursive: true });
  const aliveFile = path.join(fixtureDir, '.fake-tmux-alive');
  fs.writeFileSync(aliveFile, '');
  const tmuxPath = path.join(fakeBinDir, 'tmux');
  // has-session exits 0 (alive) only for a session name listed (one per
  // line) in the alive file; every other tmux subcommand this suite never
  // calls is left unimplemented on purpose - a scenario that starts relying
  // on one should fail loudly, not silently succeed.
  fs.writeFileSync(
    tmuxPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nif [[ "\${*}" == *"has-session"* ]]; then\n  session="\${@: -1}"\n  grep -qxF "$session" "${aliveFile}" && exit 0 || exit 1\nfi\nexit 1\n`
  );
  fs.chmodSync(tmuxPath, 0o755);
  return { fakeBinDir, aliveFile };
}

function mkRouterFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl648-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });

  const worktrees = {};
  const rolesTsvLines = [];
  for (const role of PIPELINE_ROLES) {
    const isMaster = role === 'specifier' || role === 'coordinator';
    const worktreePath = isMaster ? root : path.join(root, `${role}-worktree`);
    if (!isMaster) fs.mkdirSync(worktreePath, { recursive: true });
    worktrees[role] = { worktreePath, isMaster };
    rolesTsvLines.push(
      [role, isMaster ? 'master' : role, worktreePath, sessionNameFor(role), role, 'claude', 'task'].join('\t')
    );
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsvLines.join('\n') + '\n');

  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'rotation\trouter\n');

  const { fakeBinDir, aliveFile } = writeFakeTmux(root);
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), 'fake-socket');

  return { root, worktrees, fakeBinDir, aliveFile };
}

function mailboxDirFor(ctx, role, state) {
  const { worktreePath, isMaster } = ctx.worktrees[role];
  const base = isMaster ? path.join(worktreePath, '.swarmforge', 'handoffs', role) : path.join(worktreePath, '.swarmforge', 'handoffs');
  return path.join(base, 'inbox', state);
}

function writeClaim(ctx, role, basename) {
  const dir = mailboxDirFor(ctx, role, 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, basename);
  fs.writeFileSync(
    p,
    `id: t\nfrom: a\nto: ${role}\nrecipient: ${role}\npriority: 00\ntype: git_handoff\ntask: demo\ncommit: 1234567890\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n`
  );
  ctx.claims = ctx.claims || {};
  ctx.claims[role] = { basename };
  return p;
}

function bbEnv(ctx) {
  return { ...process.env, PATH: `${ctx.fakeBinDir}:${process.env.PATH}` };
}

function runSweep(ctx, resumedRole) {
  const args = [CLI, 'sweep', ctx.root];
  if (resumedRole) args.push(resumedRole);
  return execFileSync('bb', args, { encoding: 'utf8', env: bbEnv(ctx) });
}

function relaunch(ctx) {
  // resolve-boot-role's own stderr carries the loud fallback line
  // (BL-648-03); node's execFileSync does not separate stdout/stderr for a
  // SUCCESSFUL run unless explicitly captured both ways, so run it twice
  // through the small helper above rather than fight execFileSync's API.
  const combined = spawnCaptureBoth(ctx);
  ctx.bootRole = combined.stdout.trim();
  ctx.resolveStderr = combined.stderr;
  ctx.sweepStdout = runSweep(ctx, ctx.bootRole);
}

function spawnCaptureBoth(ctx) {
  const result = spawnSync('bb', [CLI, 'resolve-boot-role', ctx.root], { encoding: 'utf8', env: bbEnv(ctx) });
  if (result.error) throw result.error;
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function registerSteps(registry) {
  registry.define(/^a rotation-router pack launched with injected session-liveness, role-file, and inbox seams$/, (ctx) => {
    Object.assign(ctx, mkRouterFixture());
  });

  // ── relaunch-resume-orphan-claims-01 ─────────────────────────────────────
  registry.define(/^"mono-router-active-role" records "([^"]+)" and QA's in_process holds a claimed parcel$/, (ctx, roleName) => {
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'mono-router-active-role'), `${roleName}\n`);
    writeClaim(ctx, 'QA', '00_x_from_documenter_to_QA_for_QA.handoff');
  });

  registry.define(/^the swarm relaunches$/, (ctx) => {
    relaunch(ctx);
  });

  registry.define(/^the resident comes up as "([^"]+)"$/, (ctx, roleName) => {
    if (ctx.bootRole !== roleName) {
      throw new Error(`expected the resident to boot as "${roleName}", got "${ctx.bootRole}"`);
    }
  });

  registry.define(/^the claimed parcel is still in QA's in_process and is resumed without re-delivery$/, (ctx) => {
    const { basename } = ctx.claims.QA;
    const inProcess = path.join(mailboxDirFor(ctx, 'QA', 'in_process'), basename);
    const delivered = path.join(mailboxDirFor(ctx, 'QA', 'new'), basename);
    if (!fs.existsSync(inProcess)) {
      throw new Error(`expected QA's claimed parcel to remain in in_process, but it is gone: ${inProcess}`);
    }
    if (fs.existsSync(delivered)) {
      throw new Error(`expected no duplicate delivery to QA's inbox/new, but found one: ${delivered}`);
    }
  });

  // ── relaunch-resume-orphan-claims-02 ─────────────────────────────────────
  registry.define(/^"mono-router-active-role" is (missing|blank)$/, (ctx, state) => {
    const markerPath = path.join(ctx.root, '.swarmforge', 'mono-router-active-role');
    if (state === 'blank') {
      fs.writeFileSync(markerPath, '   \n');
    }
    // "missing": simply never create the file.
  });

  registry.define(/^the resident comes up as the home role$/, (ctx) => {
    if (ctx.bootRole !== HOME_ROLE) {
      throw new Error(`expected the resident to boot at home ("${HOME_ROLE}"), got "${ctx.bootRole}"`);
    }
  });

  // ── relaunch-resume-orphan-claims-03 ─────────────────────────────────────
  registry.define(/^"mono-router-active-role" records "([^"]+)"$/, (ctx, roleName) => {
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'mono-router-active-role'), `${roleName}\n`);
  });

  registry.define(/^the launch log carries a loud line naming the unreadable role record$/, (ctx) => {
    if (!/not-a-role/.test(ctx.resolveStderr)) {
      throw new Error(`expected the launch log (stderr) to name the unreadable role record, got: ${ctx.resolveStderr}`);
    }
  });

  // ── relaunch-resume-orphan-claims-04 / 06 ────────────────────────────────
  registry.define(/^role "([^"]+)" holds a claimed parcel in in_process and its owning session is "(dead|alive)"$/, (ctx, roleName, liveness) => {
    const basename = `00_x_from_a_to_${roleName}_for_${roleName}.handoff`;
    writeClaim(ctx, roleName, basename);
    if (liveness === 'alive') {
      fs.appendFileSync(ctx.aliveFile, `${sessionNameFor(roleName)}\n`);
    }
    // "dead": the alive file simply never lists this role's session.
  });

  registry.define(/^the parcel is back in role "([^"]+)" inbox new with its original priority$/, (ctx, roleName) => {
    const { basename } = ctx.claims[roleName];
    const delivered = path.join(mailboxDirFor(ctx, roleName, 'new'), basename);
    const stillClaimed = path.join(mailboxDirFor(ctx, roleName, 'in_process'), basename);
    if (!fs.existsSync(delivered)) {
      throw new Error(`expected the reclaimed parcel in role "${roleName}"'s inbox/new (same basename, so the same priority prefix), but it is missing: ${delivered}`);
    }
    if (fs.existsSync(stillClaimed)) {
      throw new Error(`expected the parcel to have left in_process, but it is still there: ${stillClaimed}`);
    }
  });

  registry.define(/^the launch or daemon log carries a loud reclaim line naming the parcel$/, (ctx) => {
    if (!/RECLAIM/.test(ctx.sweepStdout)) {
      throw new Error(`expected a loud RECLAIM line in the sweep log, got: ${ctx.sweepStdout}`);
    }
  });

  // ── relaunch-resume-orphan-claims-05 ─────────────────────────────────────
  registry.define(/^the orphan sweep runs$/, (ctx) => {
    ctx.sweepStdout = runSweep(ctx, '');
  });

  registry.define(/^the parcel remains claimed in role "([^"]+)" in_process and no copy exists in inbox new$/, (ctx, roleName) => {
    const { basename } = ctx.claims[roleName];
    const stillClaimed = path.join(mailboxDirFor(ctx, roleName, 'in_process'), basename);
    const delivered = path.join(mailboxDirFor(ctx, roleName, 'new'), basename);
    if (!fs.existsSync(stillClaimed)) {
      throw new Error(`expected the live-owner claim to remain in in_process, but it is gone: ${stillClaimed}`);
    }
    if (fs.existsSync(delivered)) {
      throw new Error(`expected no copy in inbox/new for a live-owner claim, but found one: ${delivered}`);
    }
  });

  // ── relaunch-resume-orphan-claims-06 ─────────────────────────────────────
  registry.define(/^a non-rotation pack where "mono-router-active-role" records "([^"]+)"$/, (ctx, roleName) => {
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'swarm-identity'), '');
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'mono-router-active-role'), `${roleName}\n`);
  });

  registry.define(/^role sessions boot exactly as today ignoring the role record$/, (ctx) => {
    if (ctx.bootRole !== HOME_ROLE) {
      throw new Error(`expected a non-rotation pack to boot at home regardless of the role record, got "${ctx.bootRole}"`);
    }
  });
}

module.exports = { registerSteps };
