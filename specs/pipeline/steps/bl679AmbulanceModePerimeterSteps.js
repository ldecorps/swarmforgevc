'use strict';

// BL-679: step handlers for "Ambulance mode's perimeter — quiet, frozen, and
// self-releasing". Drives the REAL production code, never a parallel/
// simplified reimplementation:
//   - piece 1 (watchdog quiet): swarmforge/scripts/handoffd.bb's
//     flow-watchdog-sweep!, real subprocess, via the new --sweep-once flag.
//   - piece 2 (promotion freeze): the same --sweep-once pass's
//     open-slot-nudge-sweep!, checked by reading the coordinator's real
//     inbox/new.
//   - piece 3 (auto-exit): the same --sweep-once pass's
//     ambulance-auto-exit-sweep!, checked via the real ambulance_cli.bb
//     status and the real Telegram OPERATOR-topic outbox file.
//
// Fixture shape mirrors bl655AmbulanceModeHoldSteps.js's own mkFixtureRoot
// (real git repo + one worktree per role + roles.tsv) - duplicated rather
// than imported, same per-ticket-file-owns-its-fixture posture
// bl852ChaseSweepRespectsAmbulanceHoldSteps.js already established.
//
// Several of this feature's own step texts are byte-identical to BL-655's
// (same Background phrasing, same "the ambulance marker names X" GIVEN).
// The step registry resolves an UNSCOPED registration by first match in
// registration order, which would silently hand this feature BL-655's
// handlers - correct for the Background, but WRONG for "the ambulance is
// released" (this feature needs it to mean "trigger the real auto-exit
// sweep", not BL-655's plain CLI release with no announcement) and for "no
// ambulance is engaged" (this feature's scenario 09 uses it BOTH as a GIVEN
// and, after the sweep runs, as a THEN - BL-655's own dual-phase trick keys
// off a Telegram action this feature never performs, so its THEN branch
// would silently misfire as another release). Every step text this feature
// gives different or dual-phase meaning to is therefore registered via
// registry.defineScoped(..., FEATURE_NAME) - scoped to just this feature,
// per BL-425's own reason for existing - never touching BL-655's unscoped
// registrations for its own feature.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');
const AMBULANCE_CLI = path.join(SCRIPTS_DIR, 'ambulance_cli.bb');

const FEATURE_NAME = "Ambulance mode's perimeter — quiet, frozen, and self-releasing";
const AMBULANCE_TICKET = 'BL-654';

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

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl679-ambulance-perimeter-'));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const commit = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
  mkdirp(path.join(root, '.swarmforge'));
  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, 'backlog', 'paused'));
  mkdirp(path.join(root, 'backlog', 'hold'));
  mkdirp(path.join(root, 'backlog', 'done'));
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
  return { root, commit, worktreeDirs };
}

function roleDir(ctx, role) {
  const dir = ctx.worktreeDirs[role];
  if (!dir) {
    throw new Error(`unknown role "${role}" in this fixture`);
  }
  return dir;
}

function isMaster(role) {
  return role === 'coordinator' || role === 'specifier';
}

function mailboxBase(ctx, role) {
  const dir = roleDir(ctx, role);
  return isMaster(role) ? path.join(dir, '.swarmforge', 'handoffs', role) : path.join(dir, '.swarmforge', 'handoffs');
}

function outboxDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'outbox');
}
function inboxNewDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'new');
}

function renderHeaders(headers) {
  return Object.entries(headers)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

let fileSeq = 0;
function writeHandoff(dir, { from = 'specifier', to, priority = '50', type = 'git_handoff', task, commit, message, createdAt, enqueuedAt, id, body }) {
  mkdirp(dir);
  fileSeq += 1;
  const filename = `${priority}_${String(fileSeq).padStart(4, '0')}_from_${from}_to_${to}.handoff`;
  const headers = {
    id,
    from,
    to,
    priority,
    type,
    task,
    commit,
    message,
    created_at: createdAt || `2026-08-12T00:00:${String(fileSeq).padStart(2, '0')}Z`,
    enqueued_at: enqueuedAt,
  };
  const content = `${renderHeaders(headers)}\n\n${body || 'payload'}\n`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  return { file, content };
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

function markerPath(ctx) {
  return path.join(ctx.root, '.swarmforge', 'operator', 'control-ambulance.json');
}

function writeTicketYaml(ctx, id, subdir) {
  const dir = path.join(ctx.root, 'backlog', subdir || 'active');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\nstatus: ${subdir || 'active'}\n`);
}

function writePausedTicket(ctx, { id, type, severity, priority, humanApproval }) {
  const dir = path.join(ctx.root, 'backlog', 'paused');
  mkdirp(dir);
  const lines = [`id: ${id}`, 'title: "fixture ticket"'];
  if (type) lines.push(`type: ${type}`);
  if (severity) lines.push(`severity: ${severity}`);
  lines.push(`priority: ${priority ?? 50}`);
  if (humanApproval) lines.push(`human_approval: ${humanApproval}`);
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), lines.join('\n') + '\n');
}

function runAmbulanceCli(ctx, args) {
  const result = spawnSync('bb', [AMBULANCE_CLI, ctx.root, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function ambulanceStatus(ctx) {
  const { stdout, status, stderr } = runAmbulanceCli(ctx, ['status']);
  if (status !== 0) {
    throw new Error(`ambulance_cli.bb status failed: ${stderr}`);
  }
  return JSON.parse(stdout);
}

function runSweepOnce(ctx) {
  const result = spawnSync('bb', [HANDOFFD, ctx.root, '--sweep-once'], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1', SWARMFORGE_MAILBOX_ONLY: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`handoffd.bb --sweep-once failed: ${result.stderr}`);
  }
  ctx.sweepHasRun = true;
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

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function moveTicketFile(ctx, id, targetSubdir) {
  const found = ['active', 'paused', 'hold', 'done']
    .map((sub) => path.join(ctx.root, 'backlog', sub, `${id}-fixture.yaml`))
    .find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`no tracked ticket file for ${id} anywhere under backlog/`);
  }
  if (targetSubdir === null) {
    fs.unlinkSync(found);
    return;
  }
  const destDir = path.join(ctx.root, 'backlog', targetSubdir);
  mkdirp(destDir);
  fs.renameSync(found, path.join(destDir, `${id}-fixture.yaml`));
}

function registerSteps(registry) {
  // ── Background (scoped: this feature needs its own fixture instance) ────
  registry.defineScoped(
    /^a running mono-router swarm with a mailbox for every role$/,
    (ctx) => {
      const { root, commit, worktreeDirs } = mkFixtureRoot();
      ctx.root = root;
      ctx.commit = commit;
      ctx.worktreeDirs = worktreeDirs;
      ctx.sweepHasRun = false;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the ambulance marker names (BL-\d+)$/,
    (ctx, ticket) => {
      writeTicketYaml(ctx, ticket, 'active');
      const { status, stderr } = runAmbulanceCli(ctx, ['engage', ticket]);
      if (status !== 0) {
        throw new Error(`ambulance_cli.bb engage ${ticket} failed: ${stderr}`);
      }
      ctx.ambulanceTicket = ticket;
    },
    FEATURE_NAME,
  );

  // ── Given ─────────────────────────────────────────────────────────────
  registry.define(/^a parcel for (BL-\d+) held past the escalate threshold$/, (ctx, ticket) => {
    writeHandoff(inboxNewDir(ctx, 'cleaner'), {
      to: 'cleaner',
      id: `parcel-${ticket}`,
      task: ticket,
      commit: ctx.commit,
      enqueuedAt: isoMinutesAgo(125),
    });
  });

  registry.define(/^a parcel for (BL-\d+) aged past the escalate threshold$/, (ctx, ticket) => {
    writeHandoff(inboxNewDir(ctx, 'cleaner'), {
      to: 'cleaner',
      id: `parcel-${ticket}`,
      task: ticket,
      commit: ctx.commit,
      enqueuedAt: isoMinutesAgo(125),
    });
  });

  registry.define(/^the active backlog is under its cap and paused work is eligible$/, (ctx) => {
    writePausedTicket(ctx, { id: 'BL-700', type: 'feature', priority: 10, humanApproval: 'approved' });
  });

  registry.define(/^a critical defect (BL-\d+) is filed while the mode is engaged$/, (ctx, ticket) => {
    writePausedTicket(ctx, { id: ticket, type: 'defect', severity: 'critical', priority: 10, humanApproval: 'approved' });
    ctx.expeditedDefect = ticket;
  });

  registry.define(/^the (BL-\d+) ticket file is (in backlog\/done|in backlog\/hold|in backlog\/active|absent from backlog)$/, (ctx, ticket, location) => {
    const map = {
      'in backlog/done': 'done',
      'in backlog/hold': 'hold',
      'in backlog/active': 'active',
      'absent from backlog': null,
    };
    moveTicketFile(ctx, ticket, map[location]);
  });

  registry.define(/^a bounce note naming (BL-\d+) has been sent back to the coder$/, (ctx, ticket) => {
    const { file, content } = writeHandoff(outboxDir(ctx, 'hardener'), {
      from: 'hardener',
      to: 'coder',
      priority: '00',
      type: 'note',
      message: `bounce touching ${ticket}`,
      body: 'see message',
    });
    ctx.bounceNote = { file, content };
  });

  // No ambulance engaged / cleared - scoped since scenario 09 uses this
  // exact text BOTH before and after the sweep runs (dual GIVEN/THEN).
  registry.defineScoped(
    /^no ambulance is engaged$/,
    (ctx) => {
      if (ctx.sweepHasRun) {
        const state = ambulanceStatus(ctx);
        if (state.active) {
          throw new Error(`expected no ambulance engaged after the sweep, got: ${JSON.stringify(state)}`);
        }
        return;
      }
      const { status, stderr } = runAmbulanceCli(ctx, ['release']);
      if (status !== 0) {
        throw new Error(`ambulance_cli.bb release failed: ${stderr}`);
      }
    },
    FEATURE_NAME,
  );

  registry.define(/^a critical defect is in flight and every parcel in the swarm is stalled$/, (ctx) => {
    writeTicketYaml(ctx, 'BL-701', 'active');
    for (const role of ['cleaner', 'architect', 'hardener']) {
      writeHandoff(inboxNewDir(ctx, role), {
        to: role,
        id: `stalled-${role}`,
        task: 'BL-701',
        commit: ctx.commit,
        enqueuedAt: isoMinutesAgo(125),
      });
    }
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the flow watchdog sweep runs$/, (ctx) => {
    runSweepOnce(ctx);
  });

  registry.define(/^the handoff daemon runs one sweep$/, (ctx) => {
    runSweepOnce(ctx);
  });

  // Scoped: this feature's "release" must exercise the real AUTO-EXIT sweep
  // (and capture its announcement), not BL-655's plain CLI release with no
  // announcement at all - the ticket delivers by reaching backlog/done/,
  // then the sweep runs and observes it.
  registry.defineScoped(
    /^the ambulance is released$/,
    (ctx) => {
      moveTicketFile(ctx, ctx.ambulanceTicket, 'done');
      const before = operatorOutboxTexts(ctx).length;
      runSweepOnce(ctx);
      ctx.releaseAnnouncementTexts = operatorOutboxTexts(ctx).slice(before);
    },
    FEATURE_NAME,
  );

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^no alarm is emitted for (BL-\d+)$/, (ctx, ticket) => {
    const texts = operatorOutboxTexts(ctx);
    const hit = texts.find((t) => t.includes(`parcel-${ticket}`));
    if (hit) {
      throw new Error(`expected no alarm for the held ${ticket} parcel; found: ${hit}`);
    }
  });

  registry.define(/^an escalate alarm is emitted for (BL-\d+)$/, (ctx, ticket) => {
    const texts = operatorOutboxTexts(ctx);
    const hit = texts.find((t) => t.includes(`parcel-${ticket}`));
    if (!hit) {
      throw new Error(`expected an alarm naming parcel-${ticket}; outbox: ${JSON.stringify(texts)}`);
    }
    if (!hit.includes('ESCALATE')) {
      throw new Error(`expected the alarm for ${ticket} at ESCALATE tier, got: ${hit}`);
    }
  });

  registry.define(/^the tier decision's allowed input keys are inspected$/, (ctx) => {
    const result = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${path.join(SCRIPTS_DIR, 'flow_watchdog_lib.bb')}") (println (clojure.string/join "," (sort (map name flow-watchdog-lib/tier-decision-input-keys))))`,
      ],
      { encoding: 'utf8' },
    ).trim();
    ctx.tierDecisionInputKeys = result.split(',');
  });

  registry.define(/^they are exactly the five keys it recognised before this slice$/, (ctx) => {
    const expected = ['age-ms', 'escalate-ms', 'highest-tier-alarmed', 'snoozed?', 'warn-ms'].sort();
    const actual = [...ctx.tierDecisionInputKeys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`expected tier-decision-input-keys ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  });

  registry.define(/^no promote-and-route nudge is sent to the coordinator$/, (ctx) => {
    const files = listHandoffFiles(inboxNewDir(ctx, 'coordinator'));
    const hit = files
      .map((f) => fs.readFileSync(path.join(inboxNewDir(ctx, 'coordinator'), f), 'utf8'))
      .find((content) => (readHeader(content, 'message') || '').includes('open slot + paused work - promote+route'));
    if (hit) {
      throw new Error(`expected no open-slot promote+route nudge while ambulance is engaged; found: ${hit}`);
    }
  });

  registry.define(/^(BL-\d+) has not been promoted$/, (ctx, ticket) => {
    const activeFile = path.join(ctx.root, 'backlog', 'active', `${ticket}-fixture.yaml`);
    if (fs.existsSync(activeFile)) {
      throw new Error(`expected ${ticket} to remain unpromoted (still in paused/), found it in backlog/active/`);
    }
    const pausedFile = path.join(ctx.root, 'backlog', 'paused', `${ticket}-fixture.yaml`);
    if (!fs.existsSync(pausedFile)) {
      throw new Error(`expected ${ticket} still queued in backlog/paused/`);
    }
  });

  registry.define(/^the release announcement names (BL-\d+) before anything else it was holding$/, (ctx, ticket) => {
    const texts = ctx.releaseAnnouncementTexts || [];
    const hit = texts.find((t) => t.includes(ticket));
    if (!hit) {
      throw new Error(`expected the release announcement to name ${ticket}; announcement texts: ${JSON.stringify(texts)}`);
    }
    if (hit.indexOf(ticket) > hit.indexOf('Ambulance auto-released')) {
      throw new Error(`expected ${ticket} named BEFORE the release line, got: ${hit}`);
    }
  });

  registry.define(/^the announcement reports the (delivered|abandoned) case$/, (ctx, kase) => {
    const texts = ctx.releaseAnnouncementTexts && ctx.releaseAnnouncementTexts.length ? ctx.releaseAnnouncementTexts : operatorOutboxTexts(ctx);
    const hit = texts.find((t) => t.includes('Ambulance auto-released'));
    if (!hit) {
      throw new Error(`expected an auto-release announcement; outbox: ${JSON.stringify(texts)}`);
    }
    if (kase === 'delivered' && !hit.includes('reached backlog/done/')) {
      throw new Error(`expected the delivered case wording, got: ${hit}`);
    }
    if (kase === 'abandoned' && !hit.includes('ESCALATE')) {
      throw new Error(`expected the abandoned case at ESCALATE, got: ${hit}`);
    }
  });

  registry.define(/^the announcement is emitted at the escalate level$/, (ctx) => {
    const texts = operatorOutboxTexts(ctx);
    const hit = texts.find((t) => t.includes('Ambulance auto-released'));
    if (!hit || !hit.includes('ESCALATE')) {
      throw new Error(`expected an ESCALATE-level auto-release announcement; outbox: ${JSON.stringify(texts)}`);
    }
  });

  registry.define(/^the ambulance marker still names (BL-\d+)$/, (ctx, ticket) => {
    const state = ambulanceStatus(ctx);
    if (!(state.active && state.ticket === ticket)) {
      throw new Error(`expected the ambulance marker to still name ${ticket}, got: ${JSON.stringify(state)}`);
    }
  });

  registry.define(/^the bounce note is delivered to the coder$/, (ctx) => {
    const files = listHandoffFiles(inboxNewDir(ctx, 'coder'));
    const match = files.some(
      (f) => readHeader(fs.readFileSync(path.join(inboxNewDir(ctx, 'coder'), f), 'utf8'), 'message') === readHeader(ctx.bounceNote.content, 'message'),
    );
    if (!match) {
      throw new Error(`expected the bounce note delivered into coder's inbox/new/; found: ${JSON.stringify(files)}`);
    }
    if (fs.existsSync(ctx.bounceNote.file)) {
      throw new Error('expected the bounce note to have left the hardener outbox');
    }
  });
}

module.exports = { registerSteps };
