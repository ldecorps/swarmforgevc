'use strict';

// BL-1513: step handlers for "The router's Work note names the ticket id
// and its path and is never cut". Drives the REAL route_backlog_to_coder.sh
// and dispatch_trail_cli.bb via child processes against a fresh fixture git
// repo per scenario - the same fixture shape bl1415LostDispatchSteps.js
// already uses (mkSocketFixtureRoot, SWARMFORGE_SKIP_DAEMON=1), since the
// defect lives in the router's own message composition, not in anything a
// reimplementation could stand in for.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1513 The router's Work note names the ticket id and its path and is never cut";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROUTE_SH = path.join(SCRIPTS, 'route_backlog_to_coder.sh');
const DISPATCH_CLI = path.join(SCRIPTS, 'dispatch_trail_cli.bb');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

// BL-1390: a fixture root must be proven isolated from the live checkout
// BEFORE any mutating git call - `git -C ""` is the current directory, and
// a linked worktree shares the live repo's own `.git/config`, so a fixture
// that is accidentally either of those would commit real changes into the
// live repository instead of its own throwaway tree. `git-common-dir`
// resolving INSIDE the fixture root proves this is a genuinely fresh
// `git init`, not an ambient or shared checkout.
function proveFixtureIsolated(root) {
  const commonDir = git(root, 'rev-parse', '--git-common-dir');
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function mailboxDir(root, role, state) {
  return bb(`(require '[babashka.fs :as fs])
(load-file "${path.join(SCRIPTS, 'handoff_lib.bb')}")
(println (str (handoff-lib/mailbox-dir (handoff-lib/load-role-info "${role}" "${root}") :${state})))`);
}

function initFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main', '.');
  proveFixtureIsolated(root);
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'].join('\t'),
      ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t'),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  // handoff_inject_lib.bb's deliver-parcel! writes the target file into the
  // recipient's inbox/new BEFORE attempting the tmux wake notification, so
  // a fake socket - any file at .swarmforge/tmux-socket - is enough for the
  // real delivery this ticket's own scenario 01 needs to observe; no real
  // tmux session required. The socket FILE's own content need not resolve
  // to a live socket - only the wake half (harmless to fail here) touches it.
  const sockPath = path.join(root, 'fake.sock');
  fs.writeFileSync(sockPath, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sockPath);
}

function writeTicket(root, filename, id) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', filename),
    `id: ${id}\ntitle: "fixture"\nstatus: todo\nassigned_to: coder\n`
  );
}

function makeSlug(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  while (out.length < length) out += alphabet;
  return out.slice(0, length);
}

function runRoute(root, itemArg, force) {
  try {
    // SWARMFORGE_SKIP_DAEMON=0 (never left to the router's own "default to
    // 1 when unset" - a bare unset still hits that default): this ticket's
    // own scenario 01 reads the DELIVERED note's exact text/length, which
    // needs the real mailbox move (swarm_handoff.bb's deliver-sync!) to
    // actually run, not the "queued in outbox, never delivered" shape
    // SWARMFORGE_SKIP_DAEMON=1 (or SWARMFORGE_SKIP_SYNC_INJECT) produces.
    // The tmux-inject half of that move has no real socket here and fails
    // non-fatally ("HANDOFF SYNC INJECT FAILED: tmux socket file missing")
    // exactly as it does for every other fixture in this suite that never
    // sets up a fake tmux socket - the mailbox move itself is unaffected.
    const out = execFileSync(ROUTE_SH, [...(force ? ['--force'] : []), itemArg, root], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, SWARMFORGE_SKIP_DAEMON: '0', SWARMFORGE_ROLE: 'coordinator' },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function runDispatchTrailCli(root, ticketId) {
  return execFileSync('bb', [DISPATCH_CLI, root, 'dispatched', ticketId], { encoding: 'utf8' }).trim();
}

function readNewMessages(root, role) {
  const dir = mailboxDir(root, role, 'new');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.handoff'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .map((text) => text.match(/^message: (.*)$/m))
    .filter(Boolean)
    .map((m) => m[1]);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a fixture repo with coordinator and coder mailbox trees and no dispatch trail$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl1513-router-note-');
    initFixture(ctx.root);
  });

  // ── Scenario Outline 01 ───────────────────────────────────────────────
  scoped(/^an active ticket BL-9001 whose file name is BL-9001- followed by a slug of (\d+) characters$/, (ctx, slugLength) => {
    const slug = makeSlug(Number(slugLength));
    writeTicket(ctx.root, `BL-9001-${slug}.yaml`, 'BL-9001');
    ctx.ticketArg = 'BL-9001';
    ctx.ticketId = 'BL-9001';
  });

  scoped(/^route_backlog_to_coder\.sh routes the ticket$/, (ctx) => {
    ctx.result = runRoute(ctx.root, ctx.ticketArg, false);
  });

  scoped(/^the note in the coder's new mailbox begins with "Work BL-9001"$/, (ctx) => {
    const messages = readNewMessages(ctx.root, 'coder');
    assert.equal(messages.length, 1, `expected exactly one routed note, got: ${JSON.stringify(messages)}`);
    ctx.routedMessage = messages[0];
    assert.ok(ctx.routedMessage.startsWith('Work BL-9001'), `expected the note to begin with "Work BL-9001", got: ${ctx.routedMessage}`);
  });

  scoped(/^that note's message names "backlog\/active"$/, (ctx) => {
    assert.ok(ctx.routedMessage.includes('backlog/active'), `expected the note to name backlog/active, got: ${ctx.routedMessage}`);
  });

  scoped(/^that note's message is no longer than 80 characters$/, (ctx) => {
    assert.ok(ctx.routedMessage.length <= 80, `expected <= 80 characters, got ${ctx.routedMessage.length}: ${ctx.routedMessage}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the dispatch trail answers DISPATCHED for BL-9001$/, (ctx) => {
    const trail = runDispatchTrailCli(ctx.root, 'BL-9001');
    assert.ok(trail.startsWith('DISPATCHED'), `expected DISPATCHED, got: ${trail}`);
  });

  scoped(/^a second route of the ticket without --force is refused$/, (ctx) => {
    const second = runRoute(ctx.root, ctx.ticketArg, false);
    assert.notEqual(second.code, 0, `expected the second route to be refused, got exit 0: ${second.out}`);
    assert.ok(second.out.includes('already has a dispatch trail'), `expected the DISPATCHED refusal, got: ${second.out}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^an active ticket whose id is BL- followed by 70 digits$/, (ctx) => {
    const id = `BL-${'1'.repeat(70)}`;
    writeTicket(ctx.root, `${id}-fixture.yaml`, id);
    ctx.ticketArg = id;
    ctx.ticketId = id;
    ctx.expectedComposedLength = `Work ${id}: read backlog/active/${id}-*.yaml`.length;
  });

  scoped(/^it exits non-zero naming the 80-character limit and the length it composed$/, (ctx) => {
    assert.notEqual(ctx.result.code, 0, `expected a non-zero exit, got 0: ${ctx.result.out}`);
    assert.ok(ctx.result.out.includes('80'), `expected the refusal to name the 80-character limit, got: ${ctx.result.out}`);
    assert.ok(
      ctx.result.out.includes(String(ctx.expectedComposedLength)),
      `expected the refusal to name the composed length ${ctx.expectedComposedLength}, got: ${ctx.result.out}`
    );
  });

  scoped(/^the coder's new mailbox holds no note$/, (ctx) => {
    const messages = readNewMessages(ctx.root, 'coder');
    assert.equal(messages.length, 0, `expected no routed note, got: ${JSON.stringify(messages)}`);
  });
}

module.exports = { registerSteps };
