'use strict';

// BL-820: step handlers for the closing-ceremony lean pass. Drives the REAL
// compiled orchestrator (closingCeremonyRun.js), store (closingCeremonyStore.js)
// and pure core (closingCeremony.js) - never a reimplementation of the fold
// or state-machine logic in the step file, mirroring BL-819's own step
// handler discipline. Scenarios that need REAL delivery (through the actual
// swarm_handoff.sh, never a direct inbox/new write) use the CLI's own
// REAL_DEPS/sendNoteViaHandoff (extension/out/tools/closing-ceremony-run.js);
// scenarios that only need the ceremony's own state machine use a fast
// injected fake, exactly the split closingCeremonyRun.test.js already
// established at the unit level.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const FINISH_SHIFT_ENTRY = path.join(REPO_ROOT, 'finish-shift');
const FINISH_SHIFT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'finish_shift_lib.sh');

const { runClosingCeremony } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyRun'));
const { readCeremonyRun, recordCeremonyOutcome, recordCeremonyAdjustment } = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyStore'));
const { ceremonyRunState, isKnownCeremonyAdjustmentKind } = require(path.join(EXT_DIR, 'out', 'quality', 'closingCeremony'));
const { appendLeanLedgerEventIfNew } = require(path.join(EXT_DIR, 'out', 'metrics', 'leanLedgerStore'));
const { REAL_DEPS } = require(path.join(EXT_DIR, 'out', 'tools', 'closing-ceremony-run'));

const SHIFT_KEY = '2026-08-08';
const SHIFT_AT = `${SHIFT_KEY}T20:00:00.000Z`;
const PREV_SHIFT_KEY = '2026-08-07';

// ── fixture helpers ─────────────────────────────────────────────────────

// Real swarm_handoff.sh delivery needs its own sibling .bb helper scripts
// present under <target>/swarmforge/scripts/ - a symlink to this repo's own
// scripts dir (never a copy) is the same sandbox-sibling-links idiom
// Stryker's own sandbox already uses (ensureStrykerSandboxSiblingLinks),
// so the REAL script (not a reimplementation) runs against the fixture.
function mkFixtureRepo() {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl820-')));
  execFileSync('git', ['init', '-q'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: target });
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    ['coordinator', 'master', target, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'].join('\t') +
      '\n' +
      ['specifier', 'master', target, 'swarmforge-specifier', 'Specifier', 'claude', 'task'].join('\t') +
      '\n'
  );
  fs.mkdirSync(path.join(target, 'swarmforge'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'), path.join(target, 'swarmforge', 'scripts'), 'dir');
  execFileSync('git', ['add', '-A'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: target });
  return target;
}

// A typical shift's worth of lifecycle activity, touching every packet
// field (path taken, dwell, bounce, skip, stall) - matches "a shift with a
// lifecycle ledger holding that shift's tickets".
function seedTypicalShiftLedger(target, shiftKey) {
  const at = `${shiftKey}T09:00:00.000Z`;
  appendLeanLedgerEventIfNew(target, { ticket: 'BL-9001', type: 'stage_transition', source: 'stage-dwell', at, role: 'coder', data: { processingMs: 5000 } });
  appendLeanLedgerEventIfNew(target, { ticket: 'BL-9001', type: 'stage_transition', source: 'stage-dwell', at: `${shiftKey}T09:30:00.000Z`, role: 'architect', data: { processingMs: 1000 } });
  appendLeanLedgerEventIfNew(target, { ticket: 'BL-9001', type: 'bounce', source: 'bounce-store', at, data: { failureClass: 'behavior' } });
  appendLeanLedgerEventIfNew(target, { ticket: 'BL-9002', type: 'stage_skip', source: 'routing-skip-log', role: 'cleaner', at, data: { reason: 'bounded single-lib change' } });
  appendLeanLedgerEventIfNew(target, { ticket: 'BL-9002', type: 'stall', source: 'chaser-telemetry', role: 'coder', at, data: { eventType: 'chase', count: 1 } });
}

function nextDayIso(iso) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
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

const OUTCOME_TEXT_TO_SPEC = {
  'a new process ticket': { type: 'process_ticket', ref: 'BL-9101' },
  'a spec or gate tweak': { type: 'spec_gate_tweak', ref: 'swarmforge/constitution/articles/99-example.md' },
  'an explicit no-change': { type: 'no_change', ref: null },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a shift with a lifecycle ledger holding that shift's tickets$/, (ctx) => {
    ctx.target = mkFixtureRepo();
    ctx.shiftKey = SHIFT_KEY;
    ctx.at = SHIFT_AT;
    ctx.sent = [];
    ctx.deps = { sendNote: (t, draft) => ctx.sent.push(draft) };
    seedTypicalShiftLedger(ctx.target, ctx.shiftKey);
  });

  // ── BL-820 ceremony-actually-invoked-at-shift-close-01 ─────────────
  // Also the shared When for scenario 09 - it both statically inspects the
  // wiring (for scenario 01's own Then steps) AND actually runs the
  // orchestrator (for scenario 09's "the closing lean pass still runs").
  registry.define(/^the shift-close path reaches its lean step$/, (ctx) => {
    ctx.finishShiftSrc = fs.readFileSync(FINISH_SHIFT_ENTRY, 'utf8');
    ctx.finishShiftLibSrc = fs.readFileSync(FINISH_SHIFT_LIB, 'utf8');
    ctx.ceremonyResult = runClosingCeremony(ctx.target, ctx.at, ctx.deps);
  });

  registry.define(/^the coordinator\+specifier lean pass is invoked$/, (ctx) => {
    if (!ctx.finishShiftSrc.includes('finish_shift_run_closing_ceremony "$TARGET"')) {
      throw new Error('expected ./finish-shift to call finish_shift_run_closing_ceremony as a named step');
    }
    if (!ctx.finishShiftLibSrc.includes('finish_shift_run_closing_ceremony()')) {
      throw new Error('expected finish_shift_lib.sh to define finish_shift_run_closing_ceremony');
    }
  });

  registry.define(/^the pass runs before the shift fully winds down$/, (ctx) => {
    const ceremonyIdx = ctx.finishShiftSrc.indexOf('finish_shift_run_closing_ceremony "$TARGET"');
    const pipelineKillIdx = ctx.finishShiftSrc.indexOf('bash "$KILL_PIPELINE"');
    if (ceremonyIdx === -1 || pipelineKillIdx === -1 || ceremonyIdx >= pipelineKillIdx) {
      throw new Error('expected the closing-ceremony call to precede the pipeline kill (the shift fully winding down)');
    }
  });

  // ── BL-820 packet-is-shift-scoped-evidence-not-a-log-dump-02 ───────
  // Also the shared When for scenario 03 and scenario 06 - runs the REAL
  // orchestrator through the REAL handoff transport so scenario 06 can
  // prove real delivery; 02/03 only inspect the resulting packet.
  registry.define(/^the coordinator builds the closing packet$/, (ctx) => {
    ctx.buildResult = runClosingCeremony(ctx.target, ctx.at, REAL_DEPS);
    ctx.packet = ctx.buildResult.run.packet;
  });

  registry.define(/^it names the path taken, dwell hotspots, bounce classes, skip reasons, and stalls for that shift$/, (ctx) => {
    for (const field of ['pathTaken', 'dwellHotspots', 'bounceClasses', 'skipReasons', 'stalls']) {
      if (ctx.packet[field].length === 0) {
        throw new Error(`expected the packet's "${field}" to be non-empty for a shift with real activity, got: ${JSON.stringify(ctx.packet)}`);
      }
    }
  });

  registry.define(/^it carries between one and three concrete process hypotheses$/, (ctx) => {
    if (ctx.packet.hypotheses.length < 1 || ctx.packet.hypotheses.length > 3) {
      throw new Error(`expected 1-3 hypotheses, got ${ctx.packet.hypotheses.length}: ${JSON.stringify(ctx.packet.hypotheses)}`);
    }
  });

  registry.define(/^it contains no raw log transcript$/, (ctx) => {
    const actualKeys = Object.keys(ctx.packet).sort();
    const closedKeys = ['bounceClasses', 'dwellHotspots', 'hypotheses', 'pathTaken', 'shiftKey', 'skipReasons', 'stalls'].sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(closedKeys)) {
      throw new Error(`expected the packet's own closed field shape, got keys: ${JSON.stringify(actualKeys)}`);
    }
  });

  // ── BL-820 packet-covers-only-its-own-shift-03 ──────────────────────
  registry.define(/^the ledger also holds entries from the previous shift$/, (ctx) => {
    appendLeanLedgerEventIfNew(ctx.target, {
      ticket: 'BL-9099',
      type: 'stage_transition',
      source: 'stage-dwell',
      at: `${PREV_SHIFT_KEY}T09:00:00.000Z`,
      role: 'yesterday-only-role',
      data: { processingMs: 999 },
    });
  });

  registry.define(/^only the current shift's lifecycle entries are summarised$/, (ctx) => {
    if (ctx.packet.pathTaken.includes('yesterday-only-role')) {
      throw new Error(`expected the previous shift's role to be excluded, got pathTaken: ${JSON.stringify(ctx.packet.pathTaken)}`);
    }
  });

  // ── BL-820 specifier-produces-an-outcome-04 / silent-ceremony-05 ───
  // Shared Given for both scenarios - creates a pending (non-auto-resolved)
  // ceremony run via the fast injected fake transport.
  registry.define(/^the specifier receives the closing packet$/, (ctx) => {
    ctx.runResult = runClosingCeremony(ctx.target, ctx.at, ctx.deps);
    if (ctx.runResult.status !== 'created') {
      throw new Error(`expected a pending (non-empty) ceremony run, got status: ${ctx.runResult.status}`);
    }
  });

  registry.define(/^it completes the lean pass with (a new process ticket|a spec or gate tweak|an explicit no-change)$/, (ctx, outcomeText) => {
    const spec = OUTCOME_TEXT_TO_SPEC[outcomeText];
    ctx.outcomeType = spec.type;
    recordCeremonyOutcome(ctx.target, ctx.shiftKey, { type: spec.type, ref: spec.ref, recordedAt: ctx.at });
  });

  registry.define(/^that outcome is recorded against the ceremony run$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (!run.outcome || run.outcome.type !== ctx.outcomeType) {
      throw new Error(`expected the run's outcome to be "${ctx.outcomeType}", got: ${JSON.stringify(run.outcome)}`);
    }
  });

  // Shared with scenario 10.
  registry.define(/^the ceremony run counts as complete$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (ceremonyRunState(run) !== 'complete') {
      throw new Error(`expected the ceremony run to be complete, got state derived from: ${JSON.stringify(run)}`);
    }
  });

  // ── BL-820 silent-ceremony-is-a-failure-05 ──────────────────────────
  registry.define(/^the lean pass ends without any recorded outcome$/, (ctx) => {
    // "Ending without an outcome" is observed the same way it is in real
    // operation: a LATER shift's own ceremony run finalizes any run still
    // pending from before it (closingCeremonyRun.ts's own "never in
    // silence" floor) - never a special-cased timeout inside this step.
    ctx.finalizeResult = runClosingCeremony(ctx.target, nextDayIso(ctx.at), ctx.deps);
  });

  registry.define(/^the ceremony run is recorded as failed$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (ceremonyRunState(run) !== 'failed') {
      throw new Error(`expected the run to be failed, got: ${JSON.stringify(run)}`);
    }
  });

  registry.define(/^that failure is surfaced rather than passed over silently$/, (ctx) => {
    const surfaced = ctx.sent.some((draft) => draft.includes('FAILED') && draft.includes(ctx.shiftKey));
    if (!surfaced) {
      throw new Error(`expected a failure note naming shift ${ctx.shiftKey}, sent: ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── BL-820 packet-reaches-specifier-not-only-briefing-06 ────────────
  registry.define(/^the packet is delivered to the specifier$/, (ctx) => {
    const outboxDir = path.join(ctx.target, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
    const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).filter((f) => f.endsWith('.handoff')) : [];
    const match = files.find((f) => fs.readFileSync(path.join(outboxDir, f), 'utf8').includes('to: specifier'));
    if (!match) {
      throw new Error(`expected a queued note addressed to specifier in ${outboxDir}, found: ${JSON.stringify(files)}`);
    }
    ctx.deliveredHandoffFile = path.join(outboxDir, match);
  });

  registry.define(/^delivery does not depend on the human reading the briefing$/, (ctx) => {
    const briefingsDir = path.join(ctx.target, 'docs', 'briefings');
    if (fs.existsSync(briefingsDir) && fs.readdirSync(briefingsDir).length > 0) {
      throw new Error('expected no docs/briefings write as part of ceremony delivery');
    }
    if (!ctx.deliveredHandoffFile || !fs.existsSync(ctx.deliveredHandoffFile)) {
      throw new Error('expected the handoff-queued note (proof of delivery) to exist independent of any briefing');
    }
  });

  // ── BL-820 coordinator-within-power-adjustments-recorded-07 ────────
  registry.define(/^the packet shows a dwell hotspot the coordinator can act on$/, (ctx) => {
    ctx.runResult = runClosingCeremony(ctx.target, ctx.at, ctx.deps);
    if (ctx.runResult.run.packet.dwellHotspots.length === 0) {
      throw new Error('expected the seeded shift to show a dwell hotspot');
    }
    ctx.filesBefore = listFilesRecursive(ctx.target);
  });

  registry.define(/^the coordinator makes a within-power adjustment$/, (ctx) => {
    ctx.adjustment = {
      kind: 'promotion_order',
      detail: 'promoted BL-9001 ahead of BL-9002 to relieve the coder dwell hotspot',
      record: { form: 'note', ref: 'note-bl820-07' },
      recordedAt: ctx.at,
    };
    ctx.adjustedRun = recordCeremonyAdjustment(ctx.target, ctx.shiftKey, ctx.adjustment);
  });

  registry.define(/^the adjustment is limited to promotion order or throttle posture$/, (ctx) => {
    if (!isKnownCeremonyAdjustmentKind(ctx.adjustment.kind)) {
      throw new Error(`expected a known within-power adjustment kind, got ${ctx.adjustment.kind}`);
    }
    let rejected = false;
    try {
      recordCeremonyAdjustment(ctx.target, ctx.shiftKey, { kind: 'reprioritize_backlog_schema', detail: 'out of power', record: { form: 'note', ref: 'n' }, recordedAt: ctx.at });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error('expected an out-of-power adjustment kind to be rejected, not merely absent from this scenario');
    }
  });

  registry.define(/^the adjustment is recorded against the ceremony run$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    const found = run.adjustments.some((a) => a.kind === ctx.adjustment.kind && a.detail === ctx.adjustment.detail);
    if (!found) {
      throw new Error(`expected the adjustment to be recorded against the run, got: ${JSON.stringify(run.adjustments)}`);
    }
  });

  registry.define(/^no domain spec is authored and no constitution article is edited$/, (ctx) => {
    const after = listFilesRecursive(ctx.target);
    const newFiles = after.filter((f) => !ctx.filesBefore.includes(f));
    const forbidden = newFiles.filter((f) => f.includes(`${path.sep}backlog${path.sep}paused${path.sep}`) || f.includes(`${path.sep}swarmforge${path.sep}constitution${path.sep}`));
    if (forbidden.length > 0) {
      throw new Error(`expected no writes under backlog/paused/ or swarmforge/constitution/, found: ${JSON.stringify(forbidden)}`);
    }
  });

  // ── BL-820 tentative-adjustments-are-reversible-08 ──────────────────
  registry.define(/^the lean pass proposes a process adjustment$/, (ctx) => {
    ctx.runResult = runClosingCeremony(ctx.target, ctx.at, ctx.deps);
    ctx.proposedAdjustment = {
      kind: 'throttle_posture',
      detail: 'dropped active_backlog_max_depth to 1 after a harsh bounce wave',
      record: { form: 'ticket', ref: 'BL-9102' },
      recordedAt: ctx.at,
    };
  });

  registry.define(/^that adjustment is applied$/, (ctx) => {
    ctx.appliedRun = recordCeremonyAdjustment(ctx.target, ctx.shiftKey, ctx.proposedAdjustment);
  });

  registry.define(/^it is either ticketed or recorded as a note$/, (ctx) => {
    const recorded = ctx.appliedRun.adjustments[ctx.appliedRun.adjustments.length - 1];
    if (recorded.record.form !== 'ticket' && recorded.record.form !== 'note') {
      throw new Error(`expected the adjustment's record form to be "ticket" or "note", got: ${recorded.record.form}`);
    }
  });

  registry.define(/^it is reversible from that record alone$/, (ctx) => {
    const recorded = ctx.appliedRun.adjustments[ctx.appliedRun.adjustments.length - 1];
    if (!recorded.record.ref) {
      throw new Error('expected a non-empty reversibility ref');
    }
    let rejected = false;
    try {
      recordCeremonyAdjustment(ctx.target, ctx.shiftKey, { kind: 'throttle_posture', detail: 'y', record: { form: 'ticket', ref: '' }, recordedAt: ctx.at });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error('expected an adjustment with no reversibility ref to be rejected, not merely absent from this scenario');
    }
  });

  // ── BL-820 mid-shift-digest-does-not-replace-the-pass-09 ───────────
  registry.define(/^a mid-shift bounce digest already reached the specifier$/, (ctx) => {
    const dir = path.join(ctx.target, '.swarmforge', 'operator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mid-shift-digest-marker.json'), JSON.stringify({ note: 'a harsh bounce wave digest already reached the specifier mid-shift' }));
  });

  registry.define(/^the closing lean pass still runs$/, (ctx) => {
    if (!ctx.ceremonyResult || (ctx.ceremonyResult.status !== 'created' && ctx.ceremonyResult.status !== 'auto_no_change')) {
      throw new Error(`expected the closing lean pass to actually run, got: ${JSON.stringify(ctx.ceremonyResult)}`);
    }
  });

  registry.define(/^the mid-shift digest is not accepted in its place$/, (ctx) => {
    if (ctx.ceremonyResult.status !== 'created') {
      throw new Error(`expected the ceremony to build a real packet from the real ledger despite the pre-existing digest, got status: ${ctx.ceremonyResult.status}`);
    }
  });

  // ── BL-820 empty-shift-still-produces-an-explicit-no-change-10 ─────
  registry.define(/^a shift whose ledger holds no ticket lifecycle entries$/, (ctx) => {
    ctx.target = mkFixtureRepo();
    ctx.shiftKey = SHIFT_KEY;
    ctx.at = SHIFT_AT;
    ctx.sent = [];
    ctx.deps = { sendNote: (t, draft) => ctx.sent.push(draft) };
  });

  registry.define(/^the closing lean pass runs$/, (ctx) => {
    ctx.runResult = runClosingCeremony(ctx.target, ctx.at, ctx.deps);
  });

  registry.define(/^it records an explicit no-change outcome$/, (ctx) => {
    const run = readCeremonyRun(ctx.target, ctx.shiftKey);
    if (!run.outcome || run.outcome.type !== 'no_change') {
      throw new Error(`expected an explicit no-change outcome, got: ${JSON.stringify(run.outcome)}`);
    }
  });
}

module.exports = { registerSteps };
