'use strict';

// BL-1346 (BL-848 stamp-off of landed hotfix 195de28861): the fixture the
// review feature drives.
//
// REVIEW parcel - nothing here reimplements the hotfix. Each scenario runs
// the REAL swarm_ensure.bb against a throwaway project root shaped like the
// hotfix's own RC-7b fixture in test_swarm_ensure.sh: real roles.tsv, real
// launch scripts, a fake tmux that RECORDS respawns instead of performing
// them, and the same `sh -c` cmdline hook the RC check uses to observe what
// a pane is running.
//
// The cmdline fake is invoked as `<script> "$1" "$2"` deliberately: the RC
// check runs the configured command through `sh -c "$CMD" sh <socket>
// <session>`, so a bare script path receives NO arguments and answers "no
// process" for every session - a fixture that passes vacuously. (The
// operator's filing records that older RC fixtures still have that shape;
// this one does not, and per the ticket's constraints the older ones are not
// this parcel's to change.)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ENSURE = path.join(SCRIPTS, 'swarm_ensure.bb');
const FIXTURE_PREFIX = 'bl1346-acceptance-';
const STALE_AFTER_MS = 10 * 60 * 1000;

// BL-971: sweep stale roots by prefix before a run too - a killed run traps
// nothing. Age-guarded so a sibling scenario's live root survives.
function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // A root another scenario is removing right now is not this sweep's business.
    }
  }
}

function write(root, rel, content, mode) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  if (mode) fs.chmodSync(full, mode);
  return full;
}

const ROLES = ['specifier', 'coder', 'coordinator'];
const RC_NAME = { specifier: 'SwarmForge-Specifier', coder: 'SwarmForge-Coder', coordinator: 'SwarmForge-Coordinator' };

// `staffing` maps a role to what its pane is observed to be running:
//   'own'      - its own role's --remote-control flag (correctly staffed)
//   'degraded' - a claude with no --remote-control flag at all (repairable)
// `rotation` is the swarm-identity rotation line: '' for a standing pack,
// 'router' for a rotation-router pack.
function makeFixture({ staffing = {}, marker = 'coordinator', rotation = '' } = {}) {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  for (const dir of ['daemon', 'operator', 'launch', 'babysitterd']) {
    fs.mkdirSync(path.join(root, '.swarmforge', dir), { recursive: true });
  }
  fs.mkdirSync(path.join(root, '.worktrees', 'coder'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${path.join(root, 'fake.sock')}\n`);

  // specifier first, exactly as full-forge orders it: the row the pre-hotfix
  // rc-launch-role classified as the mono-router "resident".
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${path.join(root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`,
  );
  write(root, path.join('.swarmforge', 'swarm-identity'), `rotation\t${rotation}\nlaunch_pack\tfull-forge\n`);
  for (const role of ROLES) {
    write(root, path.join('.swarmforge', 'launch', `${role}.sh`), `exec claude --remote-control ${RC_NAME[role]}\n`, 0o755);
  }
  if (marker) write(root, path.join('.swarmforge', 'mono-router-active-role'), `${marker}\n`);

  const bin = path.join(root, 'bin');
  const respawns = path.join(root, 'respawns.log');
  fs.writeFileSync(respawns, '');
  write(
    root,
    path.join('bin', 'tmux'),
    `#!/usr/bin/env bash
sock_cmd="$3"
if [[ "$sock_cmd" == "has-session" ]]; then
  case "$5" in
    swarmforge-specifier|swarmforge-coder|swarmforge-coordinator) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "$sock_cmd" == "list-panes" ]]; then echo "0"; exit 0; fi
if [[ "$sock_cmd" == "respawn-pane" ]]; then echo "RESPAWN $@" >> ${JSON.stringify(respawns)}; exit 0; fi
exit 0
`,
    0o755,
  );

  const cases = ROLES.map((role) => {
    const mode = staffing[role] || 'own';
    const cmdline = mode === 'degraded' ? 'claude' : `claude --remote-control ${RC_NAME[role]}`;
    return `  swarmforge-${role}) echo "${cmdline}" ;;`;
  }).join('\n');
  write(root, path.join('bin', 'rc_cmdline.sh'), `#!/usr/bin/env bash\ncase "$2" in\n${cases}\n  *) exit 1 ;;\nesac\n`, 0o755);

  write(root, path.join('bin', 'fake_ext_check.sh'), '#!/usr/bin/env bash\nexit 0\n', 0o755);
  write(root, path.join('bin', 'fake_ext_bounce.sh'), '#!/usr/bin/env bash\nexit 0\n', 0o755);
  write(root, path.join('bin', 'fake_daemon_start.sh'), '#!/usr/bin/env bash\nexit 0\n', 0o755);
  // A live pid stands in for a running daemon so ensure has no reason to
  // start anything real; this process is alive for the whole scenario.
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid'), `${process.pid}\n`);

  return { root, bin, respawns };
}

function removeFixture(fx) {
  if (fx) fs.rmSync(fx.root, { recursive: true, force: true });
}

// ONE real `swarm ensure` run against the fixture.
function runEnsure(fx) {
  const env = {
    ...process.env,
    PATH: `${fx.bin}:${process.env.PATH}`,
    SWARM_ENSURE_RC_CMDLINE_CMD: `${path.join(fx.bin, 'rc_cmdline.sh')} "$1" "$2"`,
    SWARM_ENSURE_EXTENSION_CHECK_CMD: path.join(fx.bin, 'fake_ext_check.sh'),
    SWARM_ENSURE_EXTENSION_BOUNCE_CMD: path.join(fx.bin, 'fake_ext_bounce.sh'),
    SWARM_ENSURE_SUPERVISOR_CMD: path.join(fx.bin, 'fake_daemon_start.sh'),
    SWARMFORGE_SKIP_OPERATOR: '1',
    SWARMFORGE_SKIP_FRONT_DESK: '1',
    SWARMFORGE_ALLOW_TMP_DAEMON: '1',
  };
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PRINCIPAL_USER_ID', 'CURSOR_BRIDGE_BOT_TOKEN']) {
    delete env[key];
  }
  const r = spawnSync('bb', [ENSURE, fx.root], { encoding: 'utf8', env, timeout: 180000 });
  return {
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    respawns: fs.readFileSync(fx.respawns, 'utf8'),
  };
}

// The ONE shared BL-1020 decision the repaired rc-launch-role delegates to,
// called directly in the REAL mono_router_lib.bb (which loads with no -main
// of its own).
function callSharedDecision(forms) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${path.join(SCRIPTS, 'mono_router_lib.bb')}")
(defn emit [v] (println (str "BL1346|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1346|'))
    .map((line) => JSON.parse(line.slice('BL1346|'.length)));
}

module.exports = { REPO_ROOT, SCRIPTS, ENSURE, ROLES, RC_NAME, makeFixture, removeFixture, runEnsure, callSharedDecision, sweepStaleFixtures };
