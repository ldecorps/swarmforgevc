'use strict';

// BL-1967: a closing ceremony run records the window it folded - from the
// previous run's window end to the real instant it ran - and the night path
// hands it that real instant, never a synthetic midnight.
//
// Scenario 1 drives the REAL compiled runClosingCeremony directly (the
// pure/testable store computation). Scenario 2 drives the REAL compiled
// night-closing-ceremony-run.js CLI end to end, mirroring
// bl1528UndeliverableLeanPacketIsLoudSteps.js's own mkFixtureRepo/
// markBriefingAlreadySent idiom so the lean-packet step is reached on the
// very first tick, with no live tmux session required.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const NIGHT_RUN_CLI = path.join(EXT_DIR, 'out', 'tools', 'night-closing-ceremony-run.js');

const { mkTmpDir } = require(`${EXT_DIR}/test/helpers/tmpDir`);
const { readCeremonyRun, writeCeremonyRun } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyStore'));
const { appendLeanLedgerEventIfNew } = require(path.join(EXT_DIR, 'out', 'metrics', 'leanLedgerStore'));
const { runClosingCeremony } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyRun'));

const FEATURE = 'BL-1967 A ceremony run records the window it folded, ending at the real instant it ran';

// ── fixture helpers (mirrors bl1528UndeliverableLeanPacketIsLoudSteps.js) ──

function localDayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function writeRolesTsv(target) {
  const rows = [['coordinator', 'master', target, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task']];
  fs.writeFileSync(path.join(target, '.swarmforge', 'roles.tsv'), `${rows.map((r) => r.join('\t')).join('\n')}\n`);
}

function mkFixtureRepo() {
  const target = fs.realpathSync(mkTmpDir('aps-bl1967-'));
  execFileSync('git', ['init', '-q'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: target });
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  writeRolesTsv(target);
  fs.mkdirSync(path.join(target, 'swarmforge'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'), path.join(target, 'swarmforge', 'scripts'), 'dir');
  fs.writeFileSync(path.join(target, 'swarmforge', 'swarmforge.conf'), 'closure_stop_local 06:00\n');
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: target });
  return target;
}

// Marks today's briefing already sent, so the FIRST sweep from a fresh
// (idle/absent) night state takes nightClosingCeremonyLive.ts's
// `briefingAlreadySent` branch: exactly one `lean-packet` action plus
// `night-stop`, never rotate-documenter or instruct-briefing.
function markBriefingAlreadySent(target, dayKey) {
  const dir = path.join(target, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.sent.json'), JSON.stringify({ sent: [`${dayKey}.md`] }));
}

function runNightCli(target, nowMs) {
  const res = spawnSync(
    process.execPath,
    [
      NIGHT_RUN_CLI,
      '--target',
      target,
      '--conf',
      path.join(target, 'swarmforge', 'swarmforge.conf'),
      '--now',
      String(nowMs),
      '--sleep-path',
      'finish-shift',
    ],
    { encoding: 'utf8', timeout: 30000 }
  );
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function emptyPacket(shiftKey) {
  return {
    shiftKey,
    pathTaken: [],
    dwellHotspots: [],
    bounceClasses: [],
    skipReasons: [],
    stalls: [],
    hypotheses: [],
    qualityRecommendations: [],
    determinismCandidates: [],
  };
}

// "Day D" and "day D+1" at 04:25, constructed from LOCAL components so the
// scenario's own shiftKeys match whatever LOCAL day the real night CLI
// (which keys off the process's own local clock) computes, whatever TZ the
// suite runs under.
const D_MS = new Date(2026, 7, 8, 4, 25, 0).getTime();
const D1_MS = new Date(2026, 7, 9, 4, 25, 0).getTime();

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a lifecycle ledger under a fixture root$/, (ctx) => {
    ctx.bl1967 = {
      target: mkFixtureRepo(),
      isoD: iso(D_MS),
      isoD1: iso(D1_MS),
      // Scenario 1 calls runClosingCeremony directly (shiftKey defaults to
      // nowIso's own UTC date); scenario 2 drives the real night CLI
      // (shiftKey is the local day key). Seeding a ledger event on both
      // dates means either scenario's own fold sees a non-empty shift,
      // whatever the host TZ makes them resolve to.
      shiftKeyUtcD1: iso(D1_MS).slice(0, 10),
      shiftKeyLocalD1: localDayKey(D1_MS),
    };
    const dates = new Set([ctx.bl1967.shiftKeyUtcD1, ctx.bl1967.shiftKeyLocalD1]);
    let i = 0;
    for (const day of dates) {
      appendLeanLedgerEventIfNew(ctx.bl1967.target, {
        ticket: `BL-900${i}`,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: `${day}T01:00:00.000Z`,
        role: 'coder',
        data: { processingMs: 1000 },
      });
      i += 1;
    }
  });

  scoped(/^a previous ceremony run recorded as ending at 04:25Z on day D$/, (ctx) => {
    const shiftKeyUtcD = iso(D_MS).slice(0, 10);
    ctx.bl1967.shiftKeyUtcD = shiftKeyUtcD;
    writeCeremonyRun(ctx.bl1967.target, {
      shiftKey: shiftKeyUtcD,
      packet: emptyPacket(shiftKeyUtcD),
      deliveredAt: ctx.bl1967.isoD,
      windowStart: null,
      windowEnd: ctx.bl1967.isoD,
      outcome: { type: 'no_change', ref: null, recordedAt: ctx.bl1967.isoD },
      adjustments: [],
      failedAt: null,
      deliveryFailure: null,
    });
  });

  // ── Scenario 1: direct call ──────────────────────────────────────────
  scoped(/^the ceremony runs at 04:25Z on day D\+1$/, (ctx) => {
    ctx.bl1967.result = runClosingCeremony(ctx.bl1967.target, ctx.bl1967.isoD1, { sendNote: () => {} });
  });

  scoped(/^the run names a window starting at 04:25Z on day D and ending at 04:25Z on day D\+1$/, (ctx) => {
    const { run } = ctx.bl1967.result;
    if (run.windowStart !== ctx.bl1967.isoD) {
      throw new Error(`expected windowStart ${ctx.bl1967.isoD}, got ${JSON.stringify(run.windowStart)}`);
    }
    if (run.windowEnd !== ctx.bl1967.isoD1) {
      throw new Error(`expected windowEnd ${ctx.bl1967.isoD1}, got ${JSON.stringify(run.windowEnd)}`);
    }
  });

  // ── Scenario 2: the real night CLI ───────────────────────────────────
  scoped(/^the swarm goes to sleep through the night path at 04:25Z on day D\+1$/, (ctx) => {
    markBriefingAlreadySent(ctx.bl1967.target, ctx.bl1967.shiftKeyLocalD1);
  });

  scoped(/^that path delivers the lean packet$/, (ctx) => {
    ctx.bl1967.cliResult = runNightCli(ctx.bl1967.target, D1_MS);
  });

  scoped(/^the run's window ends at 04:25Z on day D\+1, not at midnight$/, (ctx) => {
    if (ctx.bl1967.cliResult.status !== 0) {
      throw new Error(`night CLI failed (${ctx.bl1967.cliResult.status}):\n${ctx.bl1967.cliResult.out}`);
    }
    const run = readCeremonyRun(ctx.bl1967.target, ctx.bl1967.shiftKeyLocalD1);
    if (!run) {
      throw new Error(`expected a stored ceremony run for ${ctx.bl1967.shiftKeyLocalD1}, found none`);
    }
    if (run.windowEnd !== ctx.bl1967.isoD1) {
      throw new Error(`expected windowEnd ${ctx.bl1967.isoD1}, got ${JSON.stringify(run.windowEnd)}`);
    }
    if (/T00:00:00\.000Z$/.test(run.windowEnd)) {
      throw new Error(`windowEnd reads a synthetic midnight: ${run.windowEnd}`);
    }
  });
}

module.exports = { registerSteps };
