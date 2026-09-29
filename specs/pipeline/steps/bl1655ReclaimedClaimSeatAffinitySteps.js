'use strict';

// BL-1655: step handlers for "A claim reclaimed at relaunch stays with the
// seat that held it until the cross-seat deadline". Drives the REAL
// production code over a fixture root, never a parallel reimplementation:
//   - the orphan-claim sweep: relaunch_resume_cli.bb sweep <root> "" (BL-648)
//   - the claim path: ready_for_next_task.bb, invoked directly with cwd
//     inside the fixture (BL-1004/BL-1615's own leaf-only convention -
//     never the real dispatcher, which would cd to the real scripts tree
//     and claim LIVE mailboxes, BL-998)
//   - the stall-alarm exemption: handoffd.bb --sweep-once's real
//     flow-watchdog-sweep!, the exact BL-679 invocation pattern, checked
//     via the real operator Telegram outbox file.
//
// "N minutes ago" advances the pinned fixture clock by BACK-DATING the
// parcel's own enqueued_at header at write time (the age source every
// decision here reads; file mtime is never consulted) - no real sleep, no
// wall-clock override.
//
// Fixture: one git-init'd root (BL-1004's own simple style - a single git
// repo, plain per-seat subdirectories; every git command here searches
// upward for .git from cwd, so no `git worktree add` is needed) with a
// two-seat coder stage (coder, coder@2), a one-seat documenter stage, and
// a master-resident specifier row - exactly the Background's own roster.
// A low flat flow_watchdog_warn_ms keeps scenario 06 non-vacuous: measured
// directly, the DEFAULT global pair (15m warn, both doubled by
// flow_watchdog_lib.bb's own calibrated-warn-slack-factor) never alarms a
// 20-minute-old parcel at all, with or without the deferral hold, so a
// fixture at the default would pass scenario 06 for the wrong reason.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1655 A claim reclaimed at relaunch stays with the seat that held it until the cross-seat deadline';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const RELAUNCH_RESUME_CLI = path.join(SCRIPTS_DIR, 'relaunch_resume_cli.bb');
const READY_FOR_NEXT_TASK = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');

const KNOWN_SEATS = new Set(['coder', 'coder@2', 'documenter', 'specifier']);
const KNOWN_TYPES = new Set(['note', 'git_handoff']);

function seatDirName(seat) {
  return seat.replace('@', '');
}

function seatDir(ctx, seat) {
  if (seat === 'specifier') return ctx.root;
  return path.join(ctx.root, seatDirName(seat));
}

function mailboxNewDir(ctx, seat) {
  return path.join(seatDir(ctx, seat), '.swarmforge', 'handoffs', 'inbox', 'new');
}

function mailboxInProcessDir(ctx, seat) {
  return path.join(seatDir(ctx, seat), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1655-reclaim-');
  ctx.root = root;
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed']);
  ctx.commit = git(root, ['rev-parse', '--short=10', 'HEAD']).trim();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  for (const seat of ['coder', 'coder@2', 'documenter']) {
    fs.mkdirSync(seatDir(ctx, seat), { recursive: true });
  }
  const rolesLines = [
    `coder\tcoder\t${seatDir(ctx, 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `coder@2\tcoder2\t${seatDir(ctx, 'coder@2')}\tswarmforge-coder2\tCoder2\tclaude\ttask`,
    `documenter\tdocumenter\t${seatDir(ctx, 'documenter')}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    `specifier\tmaster\t${seatDir(ctx, 'specifier')}\tswarmforge-master\tSpecifier\tclaude\ttask`,
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesLines.join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config flow_watchdog_warn_ms 300000\n');
  ctx.env = { ...process.env, HOME: process.env.HOME };
}

function appendConf(ctx, line) {
  fs.appendFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), `${line}\n`);
}

function setNoLiveTmuxSession(ctx) {
  const binDir = path.join(ctx.root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const tmuxStub = path.join(binDir, 'tmux');
  fs.writeFileSync(tmuxStub, '#!/usr/bin/env bash\nexit 1\n');
  fs.chmodSync(tmuxStub, 0o755);
  fs.writeFileSync(path.join(ctx.root, 'fake.sock'), '');
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'tmux-socket'), path.join(ctx.root, 'fake.sock'));
  ctx.env = { ...ctx.env, PATH: `${binDir}:${process.env.PATH}` };
}

let fileSeq = 0;

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function writeClaimedNote(ctx, seat) {
  fileSeq += 1;
  const dir = mailboxInProcessDir(ctx, seat);
  fs.mkdirSync(dir, { recursive: true });
  const name = seatDirName(seat);
  const file = path.join(dir, `10_2026${String(fileSeq).padStart(6, '0')}_from_coordinator_to_${name}_for_${name}.handoff`);
  fs.writeFileSync(
    file,
    `id: bl1655-claimed-${fileSeq}\nfrom: coordinator\nto: ${seat}\nrecipient: ${seat}\npriority: 10\ntype: note\ncreated_at: 2026-01-01T00:00:00Z\n\nWork BL-9001\n`
  );
  ctx.claimedFile = file;
  ctx.claimedSeat = seat;
}

function writeReclaimedItem(ctx, seat, type, ageMinutes) {
  fileSeq += 1;
  const dir = mailboxNewDir(ctx, seat);
  fs.mkdirSync(dir, { recursive: true });
  const name = seatDirName(seat);
  const headers = [
    `id: bl1655-reclaim-${fileSeq}`,
    'from: coordinator',
    `to: ${seat}`,
    `recipient: ${seat}`,
    'priority: 10',
    `type: ${type}`,
  ];
  if (type === 'git_handoff') {
    headers.push('task: BL-9001-fixture');
    headers.push(`commit: ${ctx.commit}`);
  }
  headers.push(`held_by_seat: ${seat}`);
  headers.push('created_at: 2026-01-01T00:00:00Z');
  headers.push(`enqueued_at: ${isoMinutesAgo(ageMinutes)}`);
  const file = path.join(dir, `10_recl${String(fileSeq).padStart(6, '0')}_from_coordinator_to_${name}_for_${name}.handoff`);
  fs.writeFileSync(file, `${headers.join('\n')}\n\npayload\n`);
  ctx.reclaimedFile = file;
  return file;
}

function readHeader(file, field) {
  const content = fs.readFileSync(file, 'utf8');
  const prefix = `${field}: `;
  return content
    .split('\n\n')[0]
    .split('\n')
    .find((l) => l.startsWith(prefix))
    ?.slice(prefix.length);
}

function listHandoffs(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
}

function stageQueue(ctx, stage) {
  return listHandoffs(mailboxNewDir(ctx, stage));
}

function inProcess(ctx, seat) {
  return listHandoffs(mailboxInProcessDir(ctx, seat));
}

function runOrphanSweep(ctx) {
  ctx.sweepResult = spawnSync('bb', [RELAUNCH_RESUME_CLI, 'sweep', ctx.root, ''], {
    encoding: 'utf8',
    timeout: 60000,
    env: ctx.env,
  });
  assert.equal(ctx.sweepResult.status, 0, `orphan-claim sweep failed: ${ctx.sweepResult.stdout}${ctx.sweepResult.stderr}`);
}

function poll(ctx, seat) {
  return spawnSync('bb', [READY_FOR_NEXT_TASK], {
    cwd: seatDir(ctx, seat),
    encoding: 'utf8',
    timeout: 60000,
    env: { ...ctx.env, SWARMFORGE_ROLE: seat },
  });
}

function runFlowWatchdogSweepOnce(ctx) {
  const result = spawnSync('bb', [HANDOFFD, ctx.root, '--sweep-once'], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...ctx.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1', SWARMFORGE_MAILBOX_ONLY: '1' },
  });
  assert.equal(result.status, 0, `handoffd.bb --sweep-once failed: ${result.stdout}${result.stderr}`);
}

function operatorOutboxTexts(ctx) {
  const p = path.join(ctx.root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  if (!fs.existsSync(p)) return [];
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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a fixture project root under a temporary directory with a roles\.tsv carrying a two-seat coder stage, a documenter seat and a master-resident specifier seat$/,
    (ctx) => {
      mkFixture(ctx);
    }
  );

  scoped(/^a cross-seat claim deadline of (\d+) minutes$/, (ctx, minutes) => {
    appendConf(ctx, `config cross_seat_claim_deadline_ms ${Number(minutes) * 60000}`);
  });

  scoped(/^no live tmux session for any seat$/, (ctx) => {
    setNoLiveTmuxSession(ctx);
  });

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(/^the (coder|documenter|specifier) seat holds a claimed note in its in_process$/, (ctx, seat) => {
    assert.ok(KNOWN_SEATS.has(seat), `unknown seat "${seat}"`);
    writeClaimedNote(ctx, seat);
  });

  scoped(/^the coder stage queue holds a (\S+) reclaimed from the coder seat (\d+) minutes ago$/, (ctx, type, age) => {
    assert.ok(KNOWN_TYPES.has(type), `unknown parcel type "${type}" - the handlers know ${[...KNOWN_TYPES]}`);
    writeReclaimedItem(ctx, 'coder', type, Number(age));
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the orphan-claim sweep runs$/, (ctx) => {
    runOrphanSweep(ctx);
  });

  scoped(/^the (coder|coder@2|documenter|specifier) seat asks for its next task$/, (ctx, seat) => {
    assert.ok(KNOWN_SEATS.has(seat), `unknown asking seat "${seat}"`);
    ctx.askingSeat = seat;
    ctx.poll = poll(ctx, seat);
  });

  scoped(/^the flow watchdog scans the coder stage queue$/, (ctx) => {
    runFlowWatchdogSweepOnce(ctx);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the note sits in the coder stage queue under its original basename$/, (ctx) => {
    const basename = path.basename(ctx.claimedFile);
    assert.ok(
      stageQueue(ctx, 'coder').includes(basename),
      `expected ${basename} in the coder stage queue, found: ${JSON.stringify(stageQueue(ctx, 'coder'))}`
    );
  });

  scoped(/^the reclaimed file records the coder seat as the seat that held it$/, (ctx) => {
    const basename = path.basename(ctx.claimedFile);
    const target = path.join(mailboxNewDir(ctx, 'coder'), basename);
    assert.equal(readHeader(target, 'held_by_seat'), 'coder', `expected held_by_seat: coder on ${target}`);
  });

  scoped(/^the reclaim line names the coder seat$/, (ctx) => {
    const out = `${ctx.sweepResult.stdout}${ctx.sweepResult.stderr}`;
    assert.match(out, /role=coder(?!@)/, `expected the reclaim line to name the coder seat:\n${out}`);
  });

  scoped(/^it claims nothing$/, (ctx) => {
    assert.deepEqual(inProcess(ctx, ctx.askingSeat), [], `expected ${ctx.askingSeat} to claim nothing`);
  });

  scoped(/^it prints a deferral line that names no seat$/, (ctx) => {
    const out = `${ctx.poll.stdout}\n${ctx.poll.stderr}`;
    assert.match(out, /DEFERRED reclaimed-claim/, `expected a reclaim deferral line:\n${out}`);
    assert.ok(!out.includes('coder@2'), `no seat id may appear in the claim output:\n${out}`);
  });

  scoped(/^the item is still in the coder stage queue$/, (ctx) => {
    const basename = path.basename(ctx.reclaimedFile);
    assert.ok(
      stageQueue(ctx, 'coder').includes(basename),
      `expected ${basename} still in the coder stage queue, found: ${JSON.stringify(stageQueue(ctx, 'coder'))}`
    );
  });

  scoped(/^it claims the item into its own in_process$/, (ctx) => {
    assert.equal(
      inProcess(ctx, ctx.askingSeat).length,
      1,
      `expected ${ctx.askingSeat} to hold exactly one claim:\n${ctx.poll.stdout}${ctx.poll.stderr}`
    );
  });

  scoped(/^it prints a cross-seat claim line$/, (ctx) => {
    const out = `${ctx.poll.stdout}\n${ctx.poll.stderr}`;
    assert.match(out, /CROSS_SEAT_CLAIM/, `expected a cross-seat claim line:\n${out}`);
  });

  scoped(/^it prints no deferral line$/, (ctx) => {
    const out = `${ctx.poll.stdout}\n${ctx.poll.stderr}`;
    assert.ok(!/DEFERRED/.test(out), `expected no deferral line:\n${out}`);
  });

  scoped(/^it raises no stuck-parcel finding for the item$/, (ctx) => {
    const id = readHeader(ctx.reclaimedFile, 'id');
    const texts = operatorOutboxTexts(ctx);
    const hit = texts.find((t) => t.includes(id));
    assert.ok(!hit, `expected no stuck-parcel alarm for ${id}; outbox: ${JSON.stringify(texts)}`);
  });
}

module.exports = { registerSteps };
