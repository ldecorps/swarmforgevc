'use strict';

// BL-1344: the fixture the waive feature drives. Every scenario runs the REAL
// babysitter_check.bb --nudge against a throwaway project root holding a real
// git repo with real Article 4.2 findings (pipeline code on `main` that
// swarmforge-QA does not carry) - the live case the ticket was filed for -
// and a fake tmux that RECORDS the nudge instead of sending it.
//
// The QA-exclusive path list is stubbed through the sweep's own
// BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT seam (the same hermetic seam BL-962's
// and BL-1086's steps use); the ancestry predicate is the real one.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SHORT_FIXTURE_BASE, mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');
const WAIVE_CLI = path.join(SCRIPTS, 'babysitter_waive.bb');
const WAIVE_STORE = path.join('backlog', 'babysitter-waives.yaml');
const FIXTURE_PREFIX = 'bl1344-acceptance-';
const STALE_AFTER_MS = 10 * 60 * 1000;

// BL-971: sweep stale roots by prefix BEFORE a run as well - a killed run
// traps nothing. Age-guarded, so a sibling scenario's live root survives.
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

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root, rel, content, mode) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  if (mode) fs.chmodSync(full, mode);
  return full;
}

// Two commits on `main` that swarmforge-QA does not carry, each touching a
// QA-exclusive path: two Article 4.2 findings with distinct, stable keys -
// the shape that made this ticket (a key over permanent history never
// clears, so its nudge is rescheduled forever).
function makeFixture() {
  sweepStaleFixtures();
  const root = mkSocketFixtureRoot(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  write(root, path.join('extension', 'src', 'base.ts'), 'base\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'branch', 'swarmforge-QA');

  write(root, path.join('extension', 'src', 'first.ts'), 'first\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'landed first');
  const first = git(root, 'rev-parse', 'HEAD').trim();

  write(root, path.join('extension', 'src', 'second.ts'), 'second\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'landed second');
  const second = git(root, 'rev-parse', 'HEAD').trim();

  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${path.join(root, 'fake.sock')}\n`);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`,
  );

  const tmuxLog = path.join(root, 'tmux.log');
  fs.writeFileSync(tmuxLog, '');
  write(
    root,
    path.join('bin', 'paths.sh'),
    '#!/usr/bin/env bash\nif [[ "${1:-}" == "--list-paths" ]]; then printf \'%s\\n\' "extension/src/"; exit 0; fi\nexit 0\n',
    0o755,
  );
  write(
    root,
    path.join('bin', 'tmux'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(tmuxLog)}\ncase "$3" in\n  capture-pane) echo "idle" ;;\n  list-panes) echo "0" ;;\nesac\nexit 0\n`,
    0o755,
  );

  return {
    root,
    bin: path.join(root, 'bin'),
    tmuxLog,
    storePath: path.join(root, WAIVE_STORE),
    keys: { first: `pipeline-code-on-main-${first}`, second: `pipeline-code-on-main-${second}` },
    shas: { first, second },
  };
}

function removeFixture(fx) {
  if (!fx) return;
  fs.rmSync(fx.root, { recursive: true, force: true });
  releaseSocketFixtureRoot(fx.root);
}

function env(fx) {
  const e = {
    ...process.env,
    PATH: `${fx.bin}:${process.env.PATH}`,
    BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: path.join(fx.bin, 'paths.sh'),
  };
  // No live operator channel from a fixture: an escalation stays a local
  // enqueue, never a real Telegram/email send.
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'RESEND_API_KEY']) delete e[key];
  return e;
}

// ONE real sweep, with nudging on - the decision path the waive sits in.
function runSweep(fx) {
  const before = fs.existsSync(fx.tmuxLog) ? fs.readFileSync(fx.tmuxLog, 'utf8') : '';
  const r = spawnSync('bb', [BABYSITTER_CHECK, fx.root, '--nudge'], { encoding: 'utf8', env: env(fx), timeout: 180000 });
  const after = fs.existsSync(fx.tmuxLog) ? fs.readFileSync(fx.tmuxLog, 'utf8') : '';
  return {
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    // What this sweep alone sent into the coordinator's pane.
    nudgeText: after.slice(before.length),
  };
}

// The recorded-decision path: the CLI a human/coordinator runs by hand. The
// sweep never calls it.
function recordWaive(fx, key, by, reason) {
  const r = spawnSync('bb', [WAIVE_CLI, fx.root, '--record', key, by, reason], { encoding: 'utf8', env: env(fx) });
  if (r.status !== 0) throw new Error(`recording a waive failed: ${r.stdout}${r.stderr}`);
  return `${r.stdout}`;
}

function listWaives(fx) {
  const r = spawnSync('bb', [WAIVE_CLI, fx.root, '--list'], { encoding: 'utf8', env: env(fx) });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// The dedup file is a SEPARATE mechanism this ticket does not change: it
// spaces a nudge out on a rolling 30-minute window. A scenario that wants to
// observe the next nudge backdates it rather than touching the cooldown
// itself.
function elapseCooldown(fx) {
  const dedup = path.join(fx.root, '.swarmforge', 'babysitterd', 'nudge-dedup.json');
  if (!fs.existsSync(dedup)) return;
  const state = JSON.parse(fs.readFileSync(dedup, 'utf8'));
  const longAgo = Date.now() - 24 * 60 * 60 * 1000;
  fs.writeFileSync(dedup, JSON.stringify(Object.fromEntries(Object.keys(state).map((k) => [k, longAgo]))));
}

// Reads the store as a scenario sees it. A store that exists but cannot be
// read (scenario 06 puts a directory there) answers with a marker rather than
// throwing: this helper is how a scenario SNAPSHOTS the store, and a snapshot
// that throws would hide the very state under test.
function readStore(fx) {
  if (!fs.existsSync(fx.storePath)) return null;
  try {
    return fs.readFileSync(fx.storePath, 'utf8');
  } catch (err) {
    return `<unreadable: ${err.code}>`;
  }
}

module.exports = {
  REPO_ROOT,
  SCRIPTS,
  WAIVE_CLI,
  WAIVE_STORE,
  makeFixture,
  removeFixture,
  runSweep,
  recordWaive,
  listWaives,
  readStore,
  elapseCooldown,
  write,
  sweepStaleFixtures,
};
