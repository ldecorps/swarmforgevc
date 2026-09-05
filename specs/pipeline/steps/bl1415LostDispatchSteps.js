'use strict';

// BL-1415: step handlers for "the dropped-parcel clock starts when the
// recipient acts on a dispatch, and the router acts on the same verdict".
// Drives the REAL chase_sweep_lib.bb (decide-dropped-parcel?,
// dropped-parcel-items, ticket-dispatch-verdict-in) via a bb subprocess,
// and the REAL route_backlog_to_coder.sh / dispatch_trail_cli.bb via child
// processes, against a fresh fixture git repo per scenario - never a
// reimplementation of the clock or the verdict.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1415 The dropped-parcel clock starts when the recipient acts on a dispatch, and the router acts on the same verdict';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'chase_sweep_lib.bb');
const ROUTE_SH = path.join(SCRIPTS, 'route_backlog_to_coder.sh');
const DISPATCH_CLI = path.join(SCRIPTS, 'dispatch_trail_cli.bb');

// The reference instant every "<n> ago" in the feature is computed FROM.
// route_backlog_to_coder.sh and dispatch_trail_cli.bb read the REAL wall
// clock (they take no injected clock) - so this must be the real "now",
// not an arbitrary fixed instant, or every fixture timestamp would be
// stale relative to the actual CLI/router the acceptance calls out to.
// sweepDropped() threads this SAME value into the pure bb functions that
// DO accept an explicit now-ms, so both paths agree within one test run
// (margins here are minutes to hours - the seconds this run itself takes
// are immaterial).
const NOW = Date.now();
const KNOWN_EVENTS = new Set(['dequeued_at', 'completed_at']);

function isoAgo(ms) {
  return new Date(NOW - ms).toISOString().replace('Z', '000Z');
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[babashka.fs :as fs])\n(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(path.join(dir, filename), `${lines}\n\nbody\n`);
}

function mailboxDir(root, role, state) {
  const out = bb(`(require '[babashka.fs :as fs])
(load-file "${path.join(SCRIPTS, 'handoff_lib.bb')}")
(println (str (handoff-lib/mailbox-dir (handoff-lib/load-role-info "${role}" "${root}") :${state})))`);
  return out;
}

function runRoute(root, ticketId, force) {
  // cwd MUST be the fixture root: swarm_handoff.sh (which this script
  // shells to) resolves its OWN target via git-common-dir from the
  // process's cwd, not from the $ROOT positional arg - passing only the
  // arg while leaving cwd at this process's real checkout queued a real
  // handoff into the LIVE repo's .swarmforge/ the first time this was
  // written (caught and fixed before landing; BL-1390's own hazard).
  try {
    const out = execFileSync(ROUTE_SH, [...(force ? ['--force'] : []), ticketId, root], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, SWARMFORGE_SKIP_SYNC_INJECT: '1', SWARMFORGE_ROLE: 'coordinator' },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function runDispatchTrailCli(root, ticketId) {
  return execFileSync('bb', [DISPATCH_CLI, root, 'dispatched', ticketId], { encoding: 'utf8' }).trim();
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'),
    [
      ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'].join('\t'),
      ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t'),
      ['cleaner', 'cleaner', root, 'swarmforge-cleaner', 'Cleaner', 'claude', 'task'].join('\t'),
    ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-demo.yaml'),
    'id: BL-9001\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n');
}

function scanDirs(ctx) {
  const dirs = {};
  for (const role of ['coordinator', 'coder', 'cleaner']) {
    for (const state of ['new', 'in_process', 'completed', 'sent', 'outbox']) {
      dirs[`${role}:${state}`] = mailboxDir(ctx.root, role, state);
    }
  }
  return dirs;
}

function allScanDirsAndLiveDirs(ctx) {
  const d = scanDirs(ctx);
  const all = Object.values(d);
  const live = ['coordinator:new', 'coordinator:in_process', 'coder:new', 'coder:in_process', 'cleaner:new', 'cleaner:in_process']
    .map((k) => d[k]);
  return { all, live };
}

function sweepDropped(ctx) {
  const { all, live } = allScanDirsAndLiveDirs(ctx);
  const allFile = path.join(ctx.root, '.all-scan-dirs.json');
  const liveFile = path.join(ctx.root, '.live-mail-dirs.json');
  fs.writeFileSync(allFile, JSON.stringify(all));
  fs.writeFileSync(liveFile, JSON.stringify(live));
  const out = bb(libExpr(
    `(let [all-dirs (json/parse-string (slurp "${allFile}"))
      live-dirs (json/parse-string (slurp "${liveFile}"))
      items (chase-sweep-lib/dropped-parcel-items "${path.join(ctx.root, 'backlog', 'active')}" all-dirs live-dirs ${NOW} (* 45 60 1000))]
  (println (json/generate-string (mapv :id items))))`
  ));
  return JSON.parse(out).includes('BL-9001');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture mailbox tree for coordinator and coder with an active ticket BL-9001 and a fixture clock$/, (ctx) => {
    ctx.root = mkTmpDir('bl1415-fixture-');
    initFixture(ctx.root);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the coordinator's Work note for BL-9001 sits in the coder's new mailbox, created 2 hours ago$/, (ctx) => {
    writeHandoff(mailboxDir(ctx.root, 'coder', 'new'), '00_a.handoff', {
      from: 'coordinator', to: 'coder', type: 'note', message: 'Work BL-9001-demo: read file in backlog/active',
      created_at: isoAgo(2 * 60 * 60 * 1000),
    });
  });

  // ── Scenario 02 (Outline) ─────────────────────────────────────────────
  scoped(/^the coordinator's Work note for BL-9001 was created 2 hours ago and the coder's copy carries (.+) 30 seconds ago$/, (ctx, event) => {
    if (!KNOWN_EVENTS.has(event)) {
      throw new Error(`unknown <event>: ${event}`);
    }
    writeHandoff(mailboxDir(ctx.root, 'coder', 'completed'), '00_a.handoff', {
      from: 'coordinator', to: 'coder', type: 'note', message: 'Work BL-9001-demo: read file in backlog/active',
      created_at: isoAgo(2 * 60 * 60 * 1000),
      [event]: isoAgo(30 * 1000),
    });
  });

  scoped(/^no parcel for BL-9001 is in flight anywhere$/, () => {
    // Documented by construction: nothing was written to any :new/:in_process
    // dir in this scenario's own steps.
  });

  // ── Scenario 03 & 05 (shared Given) ────────────────────────────────────
  scoped(/^the coder completed the Work note for BL-9001 50 minutes ago$/, (ctx) => {
    writeHandoff(mailboxDir(ctx.root, 'coder', 'completed'), '00_a.handoff', {
      from: 'coordinator', to: 'coder', type: 'note', message: 'Work BL-9001-demo: read file in backlog/active',
      created_at: isoAgo(51 * 60 * 1000),
      completed_at: isoAgo(50 * 60 * 1000),
    });
  });

  scoped(/^no handoff for BL-9001 sits in any mailbox state after it and no role branch carries a BL-9001 commit$/, () => {
    // Documented by construction: the fixture writes nothing further after
    // the completed Work note above, and this fixture repo carries no
    // per-role branches at all (the git-branch check is explicitly optional
    // per the ticket's own "How", and this feature drives the mailbox-only
    // half).
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the coder completed the Work note for BL-9001 2 hours ago and a git_handoff for BL-9001 sits in the cleaner's completed mailbox$/, (ctx) => {
    writeHandoff(mailboxDir(ctx.root, 'coder', 'completed'), '00_a.handoff', {
      from: 'coordinator', to: 'coder', type: 'note', message: 'Work BL-9001-demo: read file in backlog/active',
      created_at: isoAgo(2 * 60 * 60 * 1000 + 60 * 1000),
      completed_at: isoAgo(2 * 60 * 60 * 1000),
    });
    // Worked, recently: the git_handoff moving BL-9001 on is itself a fresh
    // trail event, well within the stall threshold.
    writeHandoff(mailboxDir(ctx.root, 'cleaner', 'completed'), '00_b.handoff', {
      from: 'coder', to: 'cleaner', type: 'git_handoff', task: 'BL-9001-demo',
      completed_at: isoAgo(10 * 1000),
    });
  });

  // ── When / Then ───────────────────────────────────────────────────────
  scoped(/^the sweep decides whether BL-9001 is dropped$/, (ctx) => {
    ctx.dropped = sweepDropped(ctx);
  });

  scoped(/^it is not dropped$/, (ctx) => {
    assert.equal(ctx.dropped, false, 'expected the sweep NOT to report BL-9001 as dropped');
  });

  scoped(/^it is dropped and the sweep nudges the coordinator$/, (ctx) => {
    assert.equal(ctx.dropped, true, 'expected the sweep to report BL-9001 as dropped (a nudge candidate)');
  });

  scoped(/^route_backlog_to_coder\.sh refuses BL-9001 without --force$/, (ctx) => {
    const { out } = runRoute(ctx.root, 'BL-9001', false);
    assert.ok(out.includes('already has a dispatch trail'),
      `expected the router to refuse BL-9001 as DISPATCHED, got: ${out}`);
  });

  scoped(/^route_backlog_to_coder\.sh routes BL-9001 without --force, warning that the earlier dispatch was completed with no parcel and naming it$/, (ctx) => {
    const { out } = runRoute(ctx.root, 'BL-9001', false);
    assert.ok(!out.includes('already has a dispatch trail'),
      `expected the router NOT to refuse a DROPPED ticket, got: ${out}`);
    assert.ok(out.includes('BL-9001') && out.includes('no parcel in flight - possible drop'),
      `expected the router's warning to name the ticket and the completed dispatch, got: ${out}`);
  });

  scoped(/^dispatch_trail_cli\.bb is asked about BL-9001$/, (ctx) => {
    ctx.cliOut = runDispatchTrailCli(ctx.root, 'BL-9001');
  });

  scoped(/^it prints DROPPED with the same reason the sweep's nudge carried$/, (ctx) => {
    assert.ok(ctx.cliOut.startsWith('DROPPED '), `expected DROPPED from the CLI, got: ${ctx.cliOut}`);
    assert.ok(ctx.cliOut.includes('no parcel in flight - possible drop'),
      `expected the CLI's reason to be the sweep's own nudge text, got: ${ctx.cliOut}`);
  });
}

module.exports = { registerSteps };
