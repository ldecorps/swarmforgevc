'use strict';

// BL-1912: step handlers for "A land-step replay commit runs under the
// land's own bound, not the generic 60s subprocess wait". Reuses BL-1872's
// shared fixture (a bare origin plus a project repo, the REAL lander_lib.bb
// tick! swept until the queue empties, running the REAL
// land_main_publish.sh --land in the fixture's own lander worktree) - never
// a reimplementation. Forces the land-step path (never BL-1901's merge
// path) since this ticket is about the land step's own replay commit.
// Adds the one piece BL-1872's fixture does not need: a real git commit
// hook, installed under .git/hooks (shared by every worktree of the same
// repository, including the replay's own scratch branch).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./bl1872LanderDaemonSteps');

const FEATURE = "BL-1912 A land-step replay commit runs under the land's own bound, not the generic 60 second subprocess wait";

// A commit-msg hook (never pre-commit): it receives $1, the path to the
// commit message file, so it can act ONLY on the land step's own replay
// commit (land_step_lib.bb's own message carries "tip-pure replay") -
// never the fixture's own setup commits (the seed, the ticket's own-line
// commit), which share this same repository's .git/hooks and would
// otherwise be refused or slowed by a hook scoped to every commit.
function installCommitHook(fx, { delaySeconds = 0, refuseWith = null } = {}) {
  const hooksDir = path.join(fx.root, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const action = refuseWith ? `echo ${JSON.stringify(refuseWith)} >&2\nexit 1` : `sleep ${delaySeconds}\nexit 0`;
  const body = [
    '#!/usr/bin/env bash',
    'msg_file="$1"',
    'grep -q "tip-pure replay" "$msg_file" 2>/dev/null || exit 0',
    action,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(hooksDir, 'commit-msg'), body, { mode: 0o755 });
}

function ensure(ctx) {
  if (!ctx.bl1912) {
    const fx = fixture.makeFixture();
    fx.landPath = 'land-step';
    ctx.bl1912 = fx;
  }
  return ctx.bl1912;
}

function landerLog(fx, ticket) {
  const all = fixture.entries(fx);
  const e = all.find((x) => x.task === ticket);
  assert.ok(e, `no queue entry for ${ticket}: ${JSON.stringify(all)}`);
  const m = e.text.match(/:log "([^"]+)"/);
  assert.ok(m, `queue entry for ${ticket} names no :log: ${e.text}`);
  return fs.existsSync(m[1]) ? fs.readFileSync(m[1], 'utf8') : '';
}

function originCarriesTicket(fx, ticket) {
  try {
    return fixture.git(fx.origin, 'show', `main:${ticket}.txt`).trim() === ticket;
  } catch (e) {
    return false;
  }
}

// BL-1872's own ownLine() (a commit on ticket's own line, off origin/main,
// one file of its own) is not exported - only makeFixture/git/queue/
// runSweep/entries/approvals are. Same shape, inlined rather than forking
// bl1872's module to export one more function for a single sibling.
function ownLine(fx, ticket) {
  fixture.git(fx.line, 'fetch', '-q', 'origin');
  fixture.git(fx.line, 'checkout', '-q', '--detach', 'origin/main');
  fs.writeFileSync(path.join(fx.line, `${ticket}.txt`), `${ticket}\n`);
  fixture.git(fx.line, 'add', `${ticket}.txt`);
  fixture.git(fx.line, 'commit', '-q', '-m', `${ticket}: own line`);
  return fixture.git(fx.line, 'rev-parse', 'HEAD');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture project with a bare origin, a lander queue and a commit hook that takes 3 seconds$/,
    (ctx) => {
      const fx = ensure(ctx);
      installCommitHook(fx, { delaySeconds: 3 });
    }
  );

  scoped(/^the generic subprocess wait bound is 1 second$/, () => {
    process.env.SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS = '1000';
  });

  // ── a-slow-hook-replay-lands-01 ──────────────────────────────────────
  scoped(
    /^the lander queue holds an entry for (BL-\d+) whose line the land step must rebuild$/,
    (ctx, ticket) => {
      const fx = ensure(ctx);
      fixture.queue(fx, ticket, ownLine(fx, ticket));
    }
  );

  scoped(/^the lander sweep runs until the queue is empty$/, (ctx) => {
    fixture.runSweep(ensure(ctx));
  });

  scoped(/^(BL-\d+)'s work is on origin\/main$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    assert.ok(originCarriesTicket(fx, ticket), `origin/main does not carry ${ticket}'s work:\n${fx.sweepOut}`);
  });

  scoped(/^the lander log for (BL-\d+) has no LAND_ESCALATE line$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const log = landerLog(fx, ticket);
    assert.doesNotMatch(log, /LAND_ESCALATE/, log);
  });

  // ── a-hook-refusal-still-stops-the-land-02 ──────────────────────────────
  scoped(/^the commit hook refuses every commit with "([^"]+)"$/, (ctx, message) => {
    const fx = ensure(ctx);
    installCommitHook(fx, { refuseWith: message });
  });

  scoped(/^origin\/main does not carry (BL-\d+)'s work$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    assert.ok(!originCarriesTicket(fx, ticket), `origin/main unexpectedly carries ${ticket}'s work:\n${fx.sweepOut}`);
  });

  scoped(/^the lander log for (BL-\d+) contains "([^"]+)"$/, (ctx, ticket, needle) => {
    const fx = ensure(ctx);
    const log = landerLog(fx, ticket);
    assert.ok(log.includes(needle), `expected "${needle}" in log:\n${log}`);
  });

  // ── a-replay-past-the-land-bound-is-a-timeout-03 ────────────────────────
  scoped(/^the land step's commit bound is (\d+) seconds?$/, (ctx, seconds) => {
    process.env.SWARMFORGE_LAND_REPLAY_COMMIT_BOUND_MS = String(Number(seconds) * 1000);
  });

  scoped(/^the lander log for (BL-\d+) says the replay commit timed out after (\d+) seconds?$/, (ctx, ticket, seconds) => {
    const fx = ensure(ctx);
    const log = landerLog(fx, ticket);
    assert.ok(log.includes(`timed out after ${seconds} second`), `expected a timeout naming ${seconds} second(s) in log:\n${log}`);
  });

  scoped(/^the lander log for (BL-\d+) does not ask for specifier adjudication$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const log = landerLog(fx, ticket);
    assert.doesNotMatch(log, /specifier adjudication/, log);
  });
}

module.exports = { registerSteps };
