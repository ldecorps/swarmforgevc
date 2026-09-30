'use strict';

// BL-1846: step handlers for "a deterministic coordinator promotes and
// routes the next ticket itself". Drives the REAL handoffd.bb open-slot
// sweep (`bb handoffd.bb <root> --sweep-once`) and, on a deterministic
// pack, the REAL promote_and_route_next.sh / route_backlog_to_coder.sh /
// swarm_handoff.sh chain it shells to - never a reimplementation of any of
// them. Fixture shape mirrors bl679AmbulanceModePerimeterSteps.js's own
// mkFixtureRoot (real git repo + one worktree per role + roles.tsv),
// duplicated rather than imported, same per-ticket-file-owns-its-fixture
// posture that file itself documents.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const AMBULANCE_CLI = path.join(SCRIPTS_DIR, 'ambulance_cli.bb');
const MULTI_TICK_SWEEP_CLI = path.join(__dirname, 'lib', 'bl1846MultiTickSweepCli.bb');

const FEATURE_NAME = 'BL-1846 a deterministic coordinator promotes and routes the next ticket itself';

const ROLES = [
  { role: 'coordinator', worktreeName: 'master', mode: 'task' },
  { role: 'specifier', worktreeName: 'master', mode: 'task' },
  { role: 'coder', worktreeName: 'coder', mode: 'task' },
  { role: 'cleaner', worktreeName: 'cleaner', mode: 'batch' },
  { role: 'architect', worktreeName: 'architect', mode: 'task' },
  { role: 'hardener', worktreeName: 'hardener', mode: 'batch' },
  { role: 'documenter', worktreeName: 'documenter', mode: 'task' },
  { role: 'QA', worktreeName: 'QA', mode: 'task' },
];

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isMaster(role) {
  return role === 'coordinator' || role === 'specifier';
}

function mailboxBase(ctx, role) {
  const dir = ctx.worktreeDirs[role];
  return isMaster(role) ? path.join(dir, '.swarmforge', 'handoffs', role) : path.join(dir, '.swarmforge', 'handoffs');
}

function inboxNewDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'new');
}

function listHandoffFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
}

function readHeader(content, field) {
  const prefix = `${field}: `;
  return content
    .split('\n\n')[0]
    .split('\n')
    .find((l) => l.startsWith(prefix))
    ?.slice(prefix.length);
}

function readHandoffContents(dir) {
  return listHandoffFiles(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

function operatorOutboxTexts(ctx) {
  const p = path.join(ctx.root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  if (!fs.existsSync(p)) {
    return [];
  }
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line).text;
      } catch (_e) {
        return undefined;
      }
    })
    .filter(Boolean);
}

function writeConf(ctx) {
  const lines = [`config active_backlog_max_depth ${ctx.depthCap}`];
  if (ctx.deterministicMode) {
    lines.push('config coordinator_mode deterministic');
  }
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), lines.join('\n') + '\n');
}

function ticketFilePath(ctx, subdir, id) {
  return path.join(ctx.root, 'backlog', subdir, `${id}-fixture.yaml`);
}

function writePausedTicket(ctx, id, humanApproval) {
  const lines = [`id: ${id}`, 'title: "fixture ticket"', 'type: feature', 'priority: 10'];
  if (humanApproval) {
    lines.push(`human_approval: ${humanApproval}`);
  }
  fs.writeFileSync(ticketFilePath(ctx, 'paused', id), lines.join('\n') + '\n');
  ctx.ticketId = id;
}

const SWEEP_ENV = { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1', SWARMFORGE_MAILBOX_ONLY: '1' };

// promote_and_route_next.sh's own `git mv` requires every path it touches
// to already be tracked - commit whatever the Given steps wrote (conf,
// ticket files) right before exercising the sweep, once per scenario.
function commitFixture(ctx) {
  git(ctx.root, ['add', '-A']);
  const status = execFileSync('git', ['-C', ctx.root, 'status', '--porcelain'], { encoding: 'utf8' });
  if (status.trim()) {
    git(ctx.root, ['commit', '-q', '-m', 'fixture: state before sweep']);
  }
}

// One real, synchronous `--sweep-once` pass: poll-once! (delivery),
// open-slot-nudge-sweep! (the function under test), flow-watchdog-sweep!
// and ambulance-auto-exit-sweep! - the SAME set the real daemon loop's
// one-shot flag runs, never a narrower reimplementation. A deterministic
// promotion's own routing note is queued mid-sweep, AFTER this sweep's one
// poll-once! already ran - on the real daemon's main loop poll-once! runs
// again on the very next cycle, so one more delivery-only pass observes
// that same outcome without waiting out a second full sweep tick.
function runSweepOnce(ctx) {
  commitFixture(ctx);
  const result = spawnSync('bb', [HANDOFFD, ctx.root, '--sweep-once'], { encoding: 'utf8', env: SWEEP_ENV });
  ctx.sweepResult = result;
  if (result.status !== 0) {
    throw new Error(`handoffd.bb --sweep-once failed (exit ${result.status}): ${result.stderr}`);
  }
  const poll = spawnSync('bb', [HANDOFFD, ctx.root, '--poll-once'], { encoding: 'utf8', env: SWEEP_ENV });
  if (poll.status !== 0) {
    throw new Error(`handoffd.bb --poll-once (delivery pass) failed (exit ${poll.status}): ${poll.stderr}`);
  }
}

// The escalation counter (open-slot-escalation-state) lives in handoffd.bb's
// own process memory - N separate `--sweep-once` process invocations would
// each start it over at nil, so it could never reach a >1 threshold.
// bl1846MultiTickSweepCli.bb load-files handoffd.bb once (its own (-main)
// is BL-1395-guarded, so this never starts the daemon loop) and calls the
// real open-slot-nudge-sweep! N times in that ONE process, clearing the
// cooldown file (a real wall-clock timestamp a fast test never waits out)
// between ticks itself.
function runSweepTicks(ctx, n) {
  commitFixture(ctx);
  const result = spawnSync('bb', [MULTI_TICK_SWEEP_CLI, ctx.root, String(n)], { encoding: 'utf8', env: SWEEP_ENV });
  ctx.sweepResult = result;
  if (result.status !== 0) {
    throw new Error(`bl1846MultiTickSweepCli.bb failed (exit ${result.status}): ${result.stderr}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a scratch project with one open active slot under the depth cap$/, (ctx) => {
    const root = mkSocketFixtureRoot('aps-bl1846-deterministic-coordinator-');
    git(root, ['init', '-q']);
    // Persistent (not per-commit -c) identity: commit_integrity_cli.bb's own
    // internal `git commit` calls, run BY promote_and_route_next.sh itself,
    // need a real identity too, not just this fixture's own setup commits.
    git(root, ['config', 'user.email', 't@t']);
    git(root, ['config', 'user.name', 't']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirp(path.join(root, '.swarmforge'));
    for (const sub of ['active', 'paused', 'hold', 'done']) {
      mkdirp(path.join(root, 'backlog', sub));
    }
    mkdirp(path.join(root, 'swarmforge'));

    const worktreeDirs = {};
    const rolesLines = [];
    for (const { role, worktreeName, mode } of ROLES) {
      const wt = worktreeName === 'master' ? root : path.join(root, '.worktrees', worktreeName);
      if (worktreeName !== 'master') {
        git(root, ['worktree', 'add', '-q', '-b', `wt-${worktreeName}`, wt]);
      }
      worktreeDirs[role] = wt;
      rolesLines.push(`${role}\t${worktreeName}\t${wt}\tswarmforge-${worktreeName}\t${role}\tclaude\t${mode}`);
    }
    fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesLines.join('\n') + '\n');

    const sock = path.join(root, 'fake.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);

    ctx.root = root;
    ctx.worktreeDirs = worktreeDirs;
    // active/ empty, cap 1: exactly one open slot under the cap.
    ctx.depthCap = 1;
    ctx.deterministicMode = false;
    writeConf(ctx);
  });

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(/^the pack declares the deterministic coordinator mode$/, (ctx) => {
    ctx.deterministicMode = true;
    writeConf(ctx);
  });

  scoped(/^the pack declares no coordinator mode$/, (ctx) => {
    ctx.deterministicMode = false;
    writeConf(ctx);
  });

  scoped(/^an approved paused ticket the promotion gates allow$/, (ctx) => {
    writePausedTicket(ctx, 'BL-9101', 'approved');
  });

  scoped(/^the only paused ticket awaits human approval$/, (ctx) => {
    writePausedTicket(ctx, 'BL-9102', 'pending');
  });

  scoped(/^ambulance mode is engaged$/, (ctx) => {
    // The ambulance ticket occupies its own active/ slot; raise the cap by
    // one so the OTHER candidate's slot stays open - the mode's own freeze
    // is what must block it, not depth alone.
    ctx.depthCap += 1;
    writeConf(ctx);
    fs.writeFileSync(ticketFilePath(ctx, 'active', 'BL-9100'), 'id: BL-9100\ntitle: "ambulance ticket"\nstatus: active\n');
    const result = spawnSync('bb', [AMBULANCE_CLI, ctx.root, 'engage', 'BL-9100'], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`ambulance_cli.bb engage failed: ${result.stderr}`);
    }
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^handoffd runs its open-slot sweep once$/, (ctx) => {
    runSweepOnce(ctx);
  });

  scoped(/^handoffd runs its open-slot sweep on as many ticks as the escalation threshold$/, (ctx) => {
    // chase_sweep_lib.bb's own open-slot-escalation-default-threshold (3),
    // unconfigured by this fixture's conf.
    runSweepTicks(ctx, 3);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  scoped(/^that ticket is in the active backlog$/, (ctx) => {
    if (!fs.existsSync(ticketFilePath(ctx, 'active', ctx.ticketId))) {
      throw new Error(
        `expected ${ctx.ticketId} promoted into backlog/active/; sweep output: ${JSON.stringify(ctx.sweepResult && ctx.sweepResult.stderr)}`
      );
    }
  });

  scoped(/^that ticket is still in the paused backlog$/, (ctx) => {
    if (!fs.existsSync(ticketFilePath(ctx, 'paused', ctx.ticketId))) {
      throw new Error(`expected ${ctx.ticketId} to remain in backlog/paused/`);
    }
  });

  scoped(/^the coder's mailbox holds a work parcel for that ticket$/, (ctx) => {
    const contents = readHandoffContents(inboxNewDir(ctx, 'coder'));
    const hit = contents.find((c) => (readHeader(c, 'message') || '').startsWith(`Work ${ctx.ticketId}:`));
    if (!hit) {
      throw new Error(`expected a Work parcel for ${ctx.ticketId} in coder's inbox/new; found: ${JSON.stringify(contents)}`);
    }
  });

  scoped(/^the coordinator's mailbox holds no open-slot note$/, (ctx) => {
    const contents = readHandoffContents(inboxNewDir(ctx, 'coordinator'));
    const hit = contents.find((c) => (readHeader(c, 'message') || '').includes('open slot + paused work - promote+route'));
    if (hit) {
      throw new Error(`expected no open-slot note on a deterministic pack; found: ${hit}`);
    }
  });

  scoped(/^the coordinator's mailbox holds an open-slot note naming that ticket$/, (ctx) => {
    const contents = readHandoffContents(inboxNewDir(ctx, 'coordinator'));
    const hit = contents.find((c) => {
      const msg = readHeader(c, 'message') || '';
      return msg.includes('open slot + paused work - promote+route') && msg.includes(ctx.ticketId);
    });
    if (!hit) {
      throw new Error(`expected an open-slot note naming ${ctx.ticketId}; found: ${JSON.stringify(contents)}`);
    }
  });

  scoped(/^one operator alert names that ticket and the gate that refused it$/, (ctx) => {
    const texts = operatorOutboxTexts(ctx);
    const hit = texts.find((t) => t.includes(ctx.ticketId));
    if (!hit) {
      throw new Error(`expected an operator alert naming ${ctx.ticketId}; outbox: ${JSON.stringify(texts)}`);
    }
    // The real promote_and_route_next.sh's own no-candidate-eligible wording
    // (parse-promotion-refusal-reason's fallback shape) - asserted verbatim
    // so this proves the alert carries the SCRIPT's real refusal, not a
    // placeholder.
    if (!hit.includes('no eligible paused ticket')) {
      throw new Error(`expected the alert to name the refusing gate; got: ${hit}`);
    }
  });
}

module.exports = { registerSteps };
