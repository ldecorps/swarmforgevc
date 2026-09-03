'use strict';

// BL-1333 (BL-848 stamp-off of landed hotfix f57795b6d2, with d5739d84cc as
// its pure-decision first half): the shared real-git fixture every scenario
// of the review feature drives.
//
// This is a REVIEW parcel. Nothing here reimplements the hotfix: the proof
// (`master-main-reconcile-redundant-paths!`), the single drop site
// (`master-main-reconcile-drop-redundant-dirty-paths!`) and the reconcile
// tick itself are the LANDED functions in swarmforge/scripts/handoffd.bb,
// reached either through the daemon's own one-shot `--reconcile-sweep-once`
// entry point or by calling the landed vars directly after loading the real
// script against a throwaway project root. A stamp-off that re-specified the
// behaviour would certify its own copy rather than what is in production.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SHORT_FIXTURE_BASE, mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const FIXTURE_PREFIX = 'bl1333-acceptance-';

// BL-971: a killed run traps nothing, so stale roots are swept by prefix
// BEFORE a run as well as removed in a finally. Age-guarded, because
// scenarios share this module and an unguarded prefix sweep would delete a
// sibling scenario's live root out from under it (the flake that reads as a
// missing file rather than as a sweep).
const STALE_AFTER_MS = 10 * 60 * 1000;

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(SHORT_FIXTURE_BASE)) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(SHORT_FIXTURE_BASE, entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // A root another scenario is removing right now is not this sweep's business.
    }
  }
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// BL-948: rooted under the shared short base (never os.tmpdir()) - this
// fixture's `root` writes a `.swarmforge/tmux-socket` pointer file, and a
// macOS os.tmpdir() root would overrun swarm_socket_lib.bb's 100-char guard.
function mkroot(suffix) {
  return mkSocketFixtureRoot(`${FIXTURE_PREFIX}${suffix}-`);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// A real bare origin, a real master-checkout project root, and a separate
// clone standing in for QA landing commits on origin/main - the same shape
// swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh
// stands up for the daemon-level proof, built here so an acceptance scenario
// can drive one deterministic tick without a background daemon.
function makeFixture() {
  sweepStaleFixtures();
  const remote = mkroot('remote');
  const root = mkroot('root');
  const clone = mkroot('clone');

  git(remote, 'init', '--quiet', '--bare', '.');
  git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');

  git(root, 'init', '--quiet', '-b', 'main', '.');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'seed.txt', 'first\n');
  // Both overlap paths start TRACKED, so a scenario can exercise the drop's
  // tracked-in-HEAD branch (`git checkout HEAD -- <path>` on an unstaged
  // modification) and not only the staged-new/untracked branch - the hotfix
  // has two, and qa_e2e_procedure (3) names the unstaged-M half by name.
  write(root, 'dup.txt', 'base\n');
  write(root, 'shared.txt', 'base\n');
  git(root, 'add', 'seed.txt', 'dup.txt', 'shared.txt');
  git(root, 'commit', '-q', '-m', 'seed commit');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-q', 'origin', 'main');

  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  for (const box of ['new', 'in_process', 'completed']) {
    fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', box), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`,
  );

  // Neutralize the unrelated briefing sweep, and gitignore the daemon's own
  // runtime scaffolding so the tree reads CLEAN until a scenario dirties it
  // on purpose - this sweep judges dirt by `git status --porcelain`.
  const dayKey = new Date().toISOString().slice(0, 10);
  write(root, path.join('docs', 'briefings', `${dayKey}.md`), 'Headline: unrelated\n');
  write(root, '.gitignore', '.swarmforge/\nbin/\nfake.sock\n');
  // BL-1248 ships the sweep off by default; this fixture opts back in exactly
  // as an operator would, so the reconcile mechanics under review can run.
  write(root, path.join('swarmforge', 'swarmforge.conf'), 'config master_main_reconcile_enabled true\n');
  git(root, 'add', '.gitignore', 'docs/briefings', 'swarmforge/swarmforge.conf');
  git(root, 'commit', '-q', '-m', 'fixture scaffold');
  git(root, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);

  git(clone, 'clone', '--quiet', '--branch', 'main', remote, '.');
  git(clone, 'config', 'user.email', 'qa@example.com');
  git(clone, 'config', 'user.name', 'QA');

  return { root, remote, clone, bin };
}

function removeFixture(fx) {
  if (!fx) return;
  for (const dir of [fx.root, fx.remote, fx.clone]) {
    fs.rmSync(dir, { recursive: true, force: true });
    releaseSocketFixtureRoot(dir);
  }
}

// origin/main moves ahead - the merge-changed half of the overlap.
function landOnOrigin(fx, files, message = 'QA lands work') {
  git(fx.clone, 'pull', '-q', 'origin', 'main');
  for (const [rel, content] of Object.entries(files)) {
    write(fx.clone, rel, content);
    git(fx.clone, 'add', '--', rel);
  }
  git(fx.clone, 'commit', '-q', '-m', message);
  git(fx.clone, 'push', '-q', 'origin', 'main');
  return git(fx.clone, 'rev-parse', 'HEAD').trim();
}

// The daemon's own tick fetches before it reads origin/main (BL-891's
// rev-count adapter); a scenario that calls the landed proof directly, with
// no tick before it, has to bring origin/main into the fixture the same way.
function fetchOrigin(root) {
  git(root, 'fetch', '-q', 'origin', 'main:refs/remotes/origin/main');
}

function status(root) {
  return git(root, 'status', '--porcelain');
}

function daemonEnv(fx) {
  const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, SWARMFORGE_ALLOW_TMP_DAEMON: '1' };
  // No live operator channel from a fixture: an escalation must stay a log
  // line and a marker, never a real Telegram/email send.
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_CHAT_ID;
  delete env.RESEND_API_KEY;
  return env;
}

// ONE real reconcile tick of the REAL daemon (BL-1256's own --reconcile-
// sweep-once one-shot posture): sweep!, its adapters, and - when the
// decision reaches :should-reconcile - the merge adapter that holds the
// hotfix's single drop site.
function runReconcileTick(fx) {
  const r = spawnSync('bb', [HANDOFFD, fx.root, '--reconcile-sweep-once'], {
    encoding: 'utf8',
    env: daemonEnv(fx),
    timeout: 180000,
  });
  const logPath = path.join(fx.root, '.swarmforge', 'daemon', 'handoffd.log');
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, log };
}

// Loads the REAL handoffd.bb against the fixture root under an argv whose
// -main branch is a harmless one-shot print, then evaluates `forms` in that
// loaded namespace - the way a scenario reaches a landed private var
// (the proof, the drop site) without standing a daemon up. Every value the
// forms print with `emit` comes back as parsed JSON, in order.
function callLandedFns(fx, forms) {
  const program = `
(require '[cheshire.core :as json])
(binding [*command-line-args* ["${fx.root}" "--print-preferred-rotate-target"]]
  (load-file "${HANDOFFD}"))
(defn emit [v] (println (str "BL1333|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', env: daemonEnv(fx), timeout: 180000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1333|'))
    .map((line) => JSON.parse(line.slice('BL1333|'.length)));
}

module.exports = {
  REPO_ROOT,
  SCRIPTS,
  HANDOFFD,
  makeFixture,
  removeFixture,
  landOnOrigin,
  fetchOrigin,
  runReconcileTick,
  callLandedFns,
  status,
  git,
  write,
  sweepStaleFixtures,
};
