'use strict';

// BL-1528: step handlers for "an undeliverable closing-ceremony note is a
// failed run, never a pending one". Drives the REAL compiled sequence
// (night-closing-ceremony-run.js's `lean-packet` action -> the REAL
// closingCeremonyRun.js -> the REAL swarm_handoff.sh) against a fixture
// project, mirroring bl820ClosingCeremonyLeanPassSteps.js's own
// mkFixtureRepo/symlinked-scripts idiom. The "reached its lean-packet step"
// premise is built via the SAME shape QA's own qa_e2e_procedure uses: a
// pre-seeded night state, not a full tick through freeze/drain/briefing (the
// briefingAlreadySent path in nightClosingCeremonyLive.ts emits exactly one
// `lean-packet` action with no rotate-documenter/instruct-briefing alongside
// it, so this fixture needs no live tmux session at all).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const NIGHT_RUN_CLI = path.join(EXT_DIR, 'out', 'tools', 'night-closing-ceremony-run.js');

const { readCeremonyRun, writeCeremonyRun } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyStore'));
const { ceremonyRunState } = require(path.join(EXT_DIR, 'out', 'quality', 'closingCeremony'));
const { appendLeanLedgerEventIfNew } = require(path.join(EXT_DIR, 'out', 'metrics', 'leanLedgerStore'));

// ── fixture helpers ─────────────────────────────────────────────────────

function localDayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function writeRolesTsv(target, withSpecifier) {
  const rows = [
    ['coordinator', 'master', target, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
  ];
  if (withSpecifier) {
    rows.push(['specifier', 'master', target, 'swarmforge-specifier', 'Specifier', 'claude', 'task']);
  }
  fs.writeFileSync(path.join(target, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function mkFixtureRepo() {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1528-')));
  execFileSync('git', ['init', '-q'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: target });
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  writeRolesTsv(target, false);
  fs.mkdirSync(path.join(target, 'swarmforge'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'), path.join(target, 'swarmforge', 'scripts'), 'dir');
  fs.writeFileSync(path.join(target, 'swarmforge', 'swarmforge.conf'), 'closure_stop_local 06:00\n');
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: target });
  return target;
}

function listFilesRecursive(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function handoffFilesCiting(target, needle) {
  const dir = path.join(target, '.swarmforge', 'handoffs');
  return listFilesRecursive(dir)
    .filter((f) => f.endsWith('.handoff'))
    .filter((f) => fs.readFileSync(f, 'utf8').includes(needle));
}

function loudLogLines(target) {
  const log = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-loud.log');
  try {
    return fs.readFileSync(log, 'utf8').trim().split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

function readNightState(target) {
  const statePath = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-state.json');
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// Marks today's briefing already sent, so the FIRST sweep from a fresh
// (idle/absent) night state takes nightClosingCeremonyLive.ts's
// `briefingAlreadySent` branch inside `startFrozen`: exactly one
// `lean-packet` action plus `night-stop`, never rotate-documenter or
// instruct-briefing - the shape that "has reached its lean-packet step"
// needs, with no live tmux session required.
function markBriefingAlreadySent(target, dayKey) {
  const dir = path.join(target, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.sent.json'), JSON.stringify([`${dayKey}.md`]));
}

function runNightCli(ctx) {
  const res = spawnSync(
    process.execPath,
    [NIGHT_RUN_CLI, '--target', ctx.target, '--conf', path.join(ctx.target, 'swarmforge', 'swarmforge.conf'), '--now', String(ctx.nowMs), '--sleep-path', 'finish-shift'],
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

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a target project whose lifecycle ledger holds one non-empty shift$/, (ctx) => {
    ctx.target = mkFixtureRepo();
    ctx.nowMs = Date.parse('2026-09-13T20:00:00.000Z');
    ctx.shiftKey = localDayKey(ctx.nowMs);
    appendLeanLedgerEventIfNew(ctx.target, {
      ticket: 'BL-9001',
      type: 'stage_transition',
      source: 'stage-dwell',
      at: `${ctx.shiftKey}T09:00:00.000Z`,
      role: 'coder',
      data: { processingMs: 1000 },
    });
  });

  registry.define(/^the night closing ceremony has reached its lean-packet step$/, (ctx) => {
    markBriefingAlreadySent(ctx.target, ctx.shiftKey);
  });

  // ── roster Givens ────────────────────────────────────────────────────
  registry.define(/^the roster has no row for the packet note's recipient$/, () => {
    // Default fixture roster (Background) already excludes specifier.
  });

  registry.define(/^the roster has no row for the failure note's recipient$/, () => {
    // Same default recipient ('specifier'), same default roster.
  });

  registry.define(/^the roster has a row for the packet note's recipient$/, (ctx) => {
    writeRolesTsv(ctx.target, true);
  });

  // ── BL-1528 undeliverable-lean-packet-04's own Given ────────────────
  registry.define(/^a pending ceremony run from an earlier shift$/, (ctx) => {
    ctx.earlierShiftKey = localDayKey(ctx.nowMs - 2 * 24 * 60 * 60 * 1000);
    writeCeremonyRun(ctx.target, {
      shiftKey: ctx.earlierShiftKey,
      packet: emptyPacket(ctx.earlierShiftKey),
      deliveredAt: `${ctx.earlierShiftKey}T20:00:00.000Z`,
      outcome: null,
      adjustments: [],
      failedAt: null,
      deliveryFailure: null,
    });
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the lean-packet step runs$/, (ctx) => {
    ctx.firstRun = runNightCli(ctx);
  });

  registry.define(/^the lean-packet step runs a second time$/, (ctx) => {
    ctx.secondRun = runNightCli(ctx);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^the stored ceremony run for that shift is failed$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (!run || ceremonyRunState(run) !== 'failed') {
      throw new Error(`expected the run for ${ctx.shiftKey} to be failed, got: ${JSON.stringify(run)}`);
    }
  });

  registry.define(/^the stored ceremony run for that shift is pending$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (!run || ceremonyRunState(run) !== 'pending') {
      throw new Error(`expected the run for ${ctx.shiftKey} to be pending, got: ${JSON.stringify(run)}`);
    }
  });

  registry.define(/^the stored run carries the delivery failure text naming the unknown recipient$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (!run || !/Unknown recipient role 'specifier'\./.test(run.deliveryFailure || '')) {
      throw new Error(`expected deliveryFailure to name the unknown recipient, got: ${JSON.stringify(run && run.deliveryFailure)}`);
    }
  });

  registry.define(/^no handoff citing the packet exists in any inbox$/, (ctx) => {
    const matches = handoffFilesCiting(ctx.target, `lean/ceremony/${ctx.shiftKey}.json`);
    if (matches.length > 0) {
      throw new Error(`expected no handoff citing the packet, found: ${JSON.stringify(matches)}`);
    }
  });

  registry.define(/^one handoff citing the packet is queued for the recipient$/, (ctx) => {
    const matches = handoffFilesCiting(ctx.target, `lean/ceremony/${ctx.shiftKey}.json`).filter((f) =>
      fs.readFileSync(f, 'utf8').includes('to: specifier')
    );
    if (matches.length !== 1) {
      throw new Error(`expected exactly one handoff citing the packet for specifier, found: ${JSON.stringify(matches)}`);
    }
  });

  registry.define(/^the closing-ceremony loud log ends with closing-lean-packet-undeliverable naming the shift$/, (ctx) => {
    const lines = loudLogLines(ctx.target);
    const last = lines[lines.length - 1] || '';
    if (!last.endsWith(`closing-lean-packet-undeliverable ${ctx.shiftKey}`)) {
      throw new Error(`expected the loud log's last line to end with the undeliverable code naming the shift, got: ${JSON.stringify(lines)}`);
    }
  });

  registry.define(/^the night state's loudSurfaces names closing-lean-packet-undeliverable$/, (ctx) => {
    const state = readNightState(ctx.target);
    if (!state.loudSurfaces.some((s) => s.startsWith('closing-lean-packet-undeliverable'))) {
      throw new Error(`expected loudSurfaces to name the code, got: ${JSON.stringify(state.loudSurfaces)}`);
    }
  });

  registry.define(/^the closing-ceremony loud log gains no line$/, (ctx) => {
    const lines = loudLogLines(ctx.target);
    if (lines.length > 0) {
      throw new Error(`expected no loud log line, got: ${JSON.stringify(lines)}`);
    }
  });

  registry.define(/^the step completes without an error exit$/, (ctx) => {
    const run = ctx.secondRun ?? ctx.firstRun;
    if (run.status !== 0) {
      throw new Error(`expected the CLI to exit 0, got ${run.status}:\n${run.out}`);
    }
  });

  registry.define(/^the written night state lists lean-packet as done$/, (ctx) => {
    const state = readNightState(ctx.target);
    if (!state.sequence.includes('lean-packet')) {
      throw new Error(`expected the written night state's sequence to include lean-packet, got: ${JSON.stringify(state.sequence)}`);
    }
  });

  registry.define(/^no second loud line is appended$/, (ctx) => {
    const lines = loudLogLines(ctx.target);
    if (lines.length !== 1) {
      throw new Error(`expected exactly one loud log line after a second no-op sweep, got: ${JSON.stringify(lines)}`);
    }
  });

  registry.define(/^the earlier run is finalized as failed$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.earlierShiftKey);
    if (!run || ceremonyRunState(run) !== 'failed') {
      throw new Error(`expected the earlier run (${ctx.earlierShiftKey}) to be failed, got: ${JSON.stringify(run)}`);
    }
  });

  registry.define(/^the closing-ceremony loud log contains closing-ceremony-failure-undeliverable naming the earlier shift$/, (ctx) => {
    const lines = loudLogLines(ctx.target);
    if (!lines.some((l) => l.includes(`closing-ceremony-failure-undeliverable ${ctx.earlierShiftKey}`))) {
      throw new Error(`expected a loud line naming the earlier shift's undeliverable failure note, got: ${JSON.stringify(lines)}`);
    }
  });
}

module.exports = { registerSteps };
