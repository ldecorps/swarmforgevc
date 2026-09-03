'use strict';

// BL-1342 (BL-848 stamp-off of landed hotfix 27d6ab8630): the fixtures the
// review feature drives.
//
// REVIEW parcel - nothing here reimplements the hotfix. The poll scenarios
// run the REAL handoffd.bb through its own `--poll-once` one-shot against a
// throwaway project root; the supervisor scenarios call the REAL
// evaluate-health in handoffd_supervisor.bb; the narrow-catch scenario calls
// the REAL read-envelope-if-present in handoff_lib.bb.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SHORT_FIXTURE_BASE, mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const HANDOFF_LIB = path.join(SCRIPTS, 'handoff_lib.bb');
const SUPERVISOR = path.join(SCRIPTS, 'handoffd_supervisor.bb');
const FIXTURE_PREFIX = 'bl1342-acceptance-';

// BL-971: a killed run traps nothing, so stale roots are swept by prefix
// before a run as well as removed after. Age-guarded so a concurrent
// scenario's live root is never swept out from under it.
const STALE_AFTER_MS = 10 * 60 * 1000;

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(SHORT_FIXTURE_BASE)) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(SHORT_FIXTURE_BASE, entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // A root another scenario is removing right now is not this sweep's business.
    }
  }
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

const OUTBOX = path.join('.worktrees', 'coder', '.swarmforge', 'handoffs', 'outbox');
const CLEANER_INBOX = path.join('.worktrees', 'cleaner', '.swarmforge', 'handoffs', 'inbox', 'new');

function parcel(id, body) {
  return `id: ${id}\nfrom: coder\nto: cleaner\npriority: 50\ntype: note\ncreated_at: 2026-09-02T00:00:0${id.slice(-1)}Z\n\n${body}\n`;
}

// A project root the real daemon will poll: two roles, a coder outbox, a
// cleaner inbox, and a fake tmux so no wake-up reaches a real session.
//
// The vanishing parcel vanishes the way the live one did: it is a perfectly
// ordinary *.handoff file when the poll LISTS the outbox, and it is deleted
// while that same poll is still working through the parcel ahead of it. The
// deletion is driven by the fixture's own fake `tmux`, which the daemon
// shells out to while delivering the first parcel - a real listing-then-gone
// race, deterministic, with no mode-000 file to simulate failure by
// permissions (engineering.prompt) and no root-user hole to skip on.
function makeFixture({ unreadable = false, readable = true } = {}) {
  sweepStaleFixtures();
  const root = mkSocketFixtureRoot(FIXTURE_PREFIX);
  fs.mkdirSync(path.join(root, OUTBOX), { recursive: true });
  fs.mkdirSync(path.join(root, CLEANER_INBOX), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });

  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${path.join(root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `cleaner\tcleaner\t${path.join(root, '.worktrees', 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`,
  );
  write(root, path.join('.swarmforge', 'operator', 'control-ambulance.json'), '{"active":false}\n');

  const names = {
    // Sorts FIRST, so its delivery (and the tmux wake it shells out to) runs
    // while the vanishing parcel behind it is still unread.
    readable: '50_20260902T000001Z_000001_from_coder_to_cleaner.handoff',
    vanishing: '50_20260902T000002Z_000002_from_coder_to_cleaner.handoff',
  };
  if (readable) write(root, path.join(OUTBOX, names.readable), parcel('n1', 'sibling parcel'));
  const vanishingPath = path.join(root, OUTBOX, names.vanishing);
  if (unreadable) write(root, path.join(OUTBOX, names.vanishing), parcel('n2', 'parcel the sender archives mid-poll'));

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'tmux'),
    unreadable
      ? `#!/usr/bin/env bash\n# The sending role archives its own outbox entry while this poll is\n# still working - the exact 2026-09-02 race, driven deterministically. A\n# rename, not a delete, so the parcel is still there to be inspected and\n# restored afterwards: what the guard must not do is act on it.\nmv -f ${JSON.stringify(vanishingPath)} ${JSON.stringify(`${vanishingPath}.archived-by-sender`)} 2>/dev/null || true\nexit 0\n`
      : '#!/usr/bin/env bash\nexit 0\n',
  );
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);

  return {
    root,
    bin,
    names,
    outbox: path.join(root, OUTBOX),
    inbox: path.join(root, CLEANER_INBOX),
    vanishingPath,
    archivedPath: `${vanishingPath}.archived-by-sender`,
  };
}

// The sender puts its parcel back (it was never delivered, so it is still
// the sender's to re-queue): the next poll must pick it up normally.
function restoreVanished(fx) {
  fs.renameSync(fx.archivedPath, fx.vanishingPath);
}

// After the race has fired once, the hook must not fire again - the next
// poll is meant to see an ordinary, readable parcel.
function neutralizeRaceHook(fx) {
  fs.writeFileSync(path.join(fx.bin, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(fx.bin, 'tmux'), 0o755);
}

function removeFixture(fx) {
  if (!fx) return;
  fs.rmSync(fx.root, { recursive: true, force: true });
  releaseSocketFixtureRoot(fx.root);
}

function daemonEnv(fx) {
  const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, SWARMFORGE_ALLOW_TMP_DAEMON: '1' };
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_CHAT_ID;
  delete env.RESEND_API_KEY;
  return env;
}

// ONE real poll of the real daemon: `--poll-once` runs poll-once! and exits,
// which is exactly the code path the vanished parcel used to kill.
function runPoll(fx) {
  const r = spawnSync('bb', [HANDOFFD, fx.root, '--poll-once'], { encoding: 'utf8', env: daemonEnv(fx), timeout: 180000 });
  const logPath = path.join(fx.root, '.swarmforge', 'daemon', 'handoffd.log');
  return {
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    log: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '',
  };
}

// Evaluates `forms` in a loaded landed script's own namespace. Every value
// printed with `emit` comes back as parsed JSON, in order.
function callLanded(script, forms, { args = [] } = {}) {
  const program = `
(require '[cheshire.core :as json])
(binding [*command-line-args* ${JSON.stringify(args).replace(/"/g, '"')}]
  (load-file "${script}"))
(defn emit [v] (println (str "BL1342|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1342|'))
    .map((line) => JSON.parse(line.slice('BL1342|'.length)));
}

// The supervisor's -main returns at once when a stop file already exists,
// so the script can be loaded just to reach evaluate-health.
function callSupervisor(forms) {
  const root = mkSocketFixtureRoot(`${FIXTURE_PREFIX}sup-`);
  try {
    fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
    fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'stop'), '');
    return callLanded(SUPERVISOR, forms, { args: [root] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    releaseSocketFixtureRoot(root);
  }
}

module.exports = {
  REPO_ROOT,
  SCRIPTS,
  HANDOFFD,
  HANDOFF_LIB,
  SUPERVISOR,
  makeFixture,
  removeFixture,
  runPoll,
  restoreVanished,
  neutralizeRaceHook,
  callLanded,
  callSupervisor,
  write,
  parcel,
  sweepStaleFixtures,
};
