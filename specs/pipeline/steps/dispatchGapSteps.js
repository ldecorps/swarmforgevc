'use strict';

// BL-222: step handlers for the dispatch-gap-autoroute feature. Drives the
// real chase_sweep_lib.bb + swarm_handoff.bb through
// dispatch_gap_sweep_harness.bb (a thin test-only wrapper mirroring
// handoffd.bb's own dispatch-gap-sweep!/auto-route! exactly) - never a live
// daemon or tmux session. Real delivery (the tmux-dependent half of
// swarm_handoff.bb) is already covered by that script's own test suite;
// these steps scope to what BL-222 adds: detection and the auto-route send.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWEEP_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'dispatch_gap_sweep_harness.bb');

const ITEM_ID = 'BL-217';

// BL-890: the cadence conditional's own head - `(when` plus its full test
// form - not a magic character count. Anchoring here gives us the '(' of
// the enclosing `when`, so its matching close paren (found by balanced-
// paren scanning, below) is the conditional's true structural extent.
const CADENCE_CONDITIONAL_ANCHOR = '(when (zero? (mod cycle chase-sweep-every-cycles))';
const DISPATCH_GAP_SWEEP_NAME = 'dispatch-gap-sweep!';

// Scans forward from `openIndex` (which must point at an opening '(')
// balancing parens until it finds the matching close, skipping over
// Clojure/Babashka line comments (`;` to end of line) and string literals
// (respecting `\"` escapes) so a paren mentioned in prose or a string never
// perturbs the count. Returns -1 if the source ends before balancing.
function findMatchingParen(source, openIndex) {
  let depth = 0;
  let inString = false;
  let inComment = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === ';') { inComment = true; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Locates the cadence conditional by structure: find the anchor, then
// balance parens from its opening '(' to find where the `when` form
// actually closes. Returns null (never throws) when the anchor - and so
// the conditional itself - cannot be found; distinguishing "not found"
// from "found but sweep missing" is the caller's job (BL-890 invariant 2).
function locateCadenceConditional(source, anchor) {
  const start = source.indexOf(anchor);
  if (start === -1) return null;
  const end = findMatchingParen(source, start);
  if (end === -1) return null;
  return { start, end, text: source.slice(start, end + 1) };
}

// BL-890: position-independent replacement for the old 600-character-
// window check. The verdict depends only on whether `sweepName` textually
// appears anywhere within the cadence conditional's own structural extent
// - never on where it sits or how much text (e.g. comments) precedes it.
function checkSweepWiredInCadence(source, sweepName, anchor) {
  const conditional = locateCadenceConditional(source, anchor);
  if (!conditional) {
    return { ok: false, reason: 'conditional-not-found' };
  }
  if (!conditional.text.includes(sweepName)) {
    return { ok: false, reason: 'sweep-not-wired' };
  }
  return { ok: true };
}

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-dispatch-gap-'));
    git(ctx.targetPath, ['init', '-q']);
    git(ctx.targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function coderWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'coder');
}

function cleanerWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'cleaner');
}

function writeRolesTsv(ctx) {
  const targetPath = ctx.targetPath;
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  const rows = [
    ['coordinator', 'master', targetPath, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coderWorktree(ctx), 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ['cleaner', 'cleaner', cleanerWorktree(ctx), 'swarmforge-cleaner', 'Cleaner', 'claude', 'batch'],
  ];
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveItem(ctx) {
  const activeDir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(
    path.join(activeDir, `${ITEM_ID}-demo.yaml`),
    `id: ${ITEM_ID}\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n`
  );
}

function writeHandoff(dir, basename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, basename), lines.join('\n') + '\n\nbody\n');
}

function coordinatorOutboxDir(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function listQueuedNotesFor(ctx, itemId) {
  const dir = coordinatorOutboxDir(ctx);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    files = [];
  }
  return files
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .filter((content) => new RegExp(`^message: ${itemId}`, 'm').test(content));
}

function registerSteps(registry) {
  registry.define(/^an item in backlog\/active\/ assigned to a role$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActiveItem(ctx);
  });

  registry.define(/^the sweep runs at the existing chase interval$/, () => {
    // Non-behavioral gate (no separate dispatch-gap timeout): pin that
    // dispatch-gap-sweep! is wired into the SAME cadence conditional as
    // chase-sweep! in handoffd.bb, not a standalone timer. BL-890:
    // position-independent - see checkSweepWiredInCadence above.
    const src = fs.readFileSync(path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb'), 'utf8');
    const result = checkSweepWiredInCadence(src, DISPATCH_GAP_SWEEP_NAME, CADENCE_CONDITIONAL_ANCHOR);
    if (result.reason === 'conditional-not-found') {
      throw new Error(
        `could not locate the cadence conditional (anchored on "${CADENCE_CONDITIONAL_ANCHOR}") in handoffd.bb - cannot tell whether ${DISPATCH_GAP_SWEEP_NAME} shares its cadence`
      );
    }
    if (result.reason === 'sweep-not-wired') {
      throw new Error(
        `expected ${DISPATCH_GAP_SWEEP_NAME} to be invoked inside the cadence conditional (found the conditional, but not the call) - it should share chase-sweep!'s existing cadence, not a separate timeout`
      );
    }
  });

  // ── BL-890: cadence-wiring check is position-independent ────────────────
  // These steps exercise checkSweepWiredInCadence directly against
  // synthetic, in-memory source (never the real handoffd.bb) so the
  // structural extent/failure-mode logic is proven independent of any one
  // file's current shape.

  registry.define(/^a cadence conditional in handoffd\.bb that invokes "([^"]+)"$/, (ctx, sweepName) => {
    ctx.bl890SweepName = sweepName;
    ctx.bl890Source = `${CADENCE_CONDITIONAL_ANCHOR}\n  (${sweepName} (load-roles)))\n`;
  });

  registry.define(/^a comment block of (\d+) characters precedes that invocation inside the conditional$/, (ctx, charCount) => {
    const n = Number(charCount);
    const filler = ';; ' + 'x'.repeat(Math.max(0, n - 4)) + '\n';
    ctx.bl890Source = `${CADENCE_CONDITIONAL_ANCHOR}\n  ${filler}  (${ctx.bl890SweepName} (load-roles)))\n`;
  });

  registry.define(/^a cadence conditional in handoffd\.bb that does not invoke "([^"]+)"$/, (ctx, sweepName) => {
    ctx.bl890SweepName = sweepName;
    ctx.bl890Source = `${CADENCE_CONDITIONAL_ANCHOR}\n  (some-other-sweep! (load-roles)))\n`;
  });

  registry.define(/^"([^"]+)" is invoked from its own separate timer instead$/, (ctx, sweepName) => {
    ctx.bl890Source += `\n(when (zero? (mod cycle its-own-separate-timer))\n  (${sweepName} (load-roles)))\n`;
  });

  registry.define(/^a handoffd\.bb in which the cadence conditional cannot be located$/, (ctx) => {
    ctx.bl890SweepName = DISPATCH_GAP_SWEEP_NAME;
    ctx.bl890Source = `(defn some-other-fn []\n  (${DISPATCH_GAP_SWEEP_NAME} (load-roles)))\n`;
  });

  registry.define(/^the cadence-wiring check runs$/, (ctx) => {
    ctx.bl890Result = checkSweepWiredInCadence(ctx.bl890Source, ctx.bl890SweepName, CADENCE_CONDITIONAL_ANCHOR);
  });

  registry.define(/^the check passes$/, (ctx) => {
    if (!ctx.bl890Result.ok) {
      throw new Error(`expected the cadence-wiring check to pass, got reason: ${ctx.bl890Result.reason}`);
    }
  });

  registry.define(/^the check fails$/, (ctx) => {
    if (ctx.bl890Result.ok) {
      throw new Error('expected the cadence-wiring check to fail, but it passed');
    }
  });

  registry.define(/^its failure message names "([^"]+)" and the cadence conditional$/, (ctx, sweepName) => {
    if (ctx.bl890Result.reason !== 'sweep-not-wired') {
      throw new Error(`expected the "sweep not wired" failure mode, got: ${ctx.bl890Result.reason}`);
    }
    if (sweepName !== ctx.bl890SweepName) {
      throw new Error(`expected the failure to concern "${sweepName}", scenario wired "${ctx.bl890SweepName}"`);
    }
  });

  registry.define(/^its failure message distinguishes a missing cadence conditional from an unwired sweep$/, (ctx) => {
    if (ctx.bl890Result.reason !== 'conditional-not-found') {
      throw new Error(`expected the "conditional not found" failure mode, got: ${ctx.bl890Result.reason}`);
    }
  });

  registry.define(/^the assignee's mailbox holds no routing handoff for the item$/, () => {
    // No-op: the Background's fixture already has zero dispatch trail.
  });

  registry.define(/^the item already has a routing handoff for the assignee$/, (ctx) => {
    writeHandoff(path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new'), '00_a.handoff', {
      from: 'coordinator',
      to: 'coder',
      type: 'note',
      message: `${ITEM_ID} active, spec-complete - pick up next.`,
    });
  });

  registry.define(/^the item has already progressed to a later pipeline role$/, (ctx) => {
    writeHandoff(path.join(cleanerWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new'), '00_a.handoff', {
      from: 'coder',
      to: 'cleaner',
      type: 'git_handoff',
      task: `${ITEM_ID}-demo`,
      commit: '0000000000',
    });
  });

  // BL-349 shares this EXACT step text ("the sweep runs") for its own
  // stuck-escalation-email-headless-07 - the registry resolves first-match,
  // so whichever module registers this regex first speaks for every
  // scenario that uses it (see mergedCodeReachesDaemonsSteps.js's own
  // identical note for "the swarm's health is reported"). Dispatches to
  // ctx.stuckEscalationRunner when an earlier Given step in the SAME
  // scenario has set one; absent that flag (every scenario this file
  // itself owns), behavior is UNCHANGED.
  registry.define(/^the sweep runs$/, (ctx) => {
    if (ctx.stuckEscalationRunner) {
      ctx.result = ctx.stuckEscalationRunner();
      return;
    }
    // BL-719: same extension point as ctx.stuckEscalationRunner above -
    // bl719DroppedParcelNudgeSteps.js's Background sets this so its own
    // scenarios (which share this exact step text) run the real
    // dropped-parcel + dispatch-gap harnesses together, mirroring what a
    // live daemon tick actually does.
    if (ctx.droppedParcelSweepRunner) {
      ctx.droppedParcelSweepRunner();
      return;
    }
    const targetPath = ensureTargetPath(ctx);
    ctx.sweepOutput = execFileSync('bb', [SWEEP_HARNESS, targetPath], { encoding: 'utf8' });
  });

  registry.define(/^the assignee receives a routing handoff for the item$/, (ctx) => {
    const queued = listQueuedNotesFor(ctx, ITEM_ID);
    if (queued.length === 0) {
      throw new Error(`expected an auto-routed note for ${ITEM_ID} queued via the real swarm_handoff.bb, got sweep output: ${ctx.sweepOutput}`);
    }
    if (!queued.some((content) => /^to: coder$/m.test(content))) {
      throw new Error(`expected the queued note addressed to the assignee (coder), got: ${queued.join('\n---\n')}`);
    }
  });

  registry.define(/^the sweep sends no further routing handoff for the item$/, (ctx) => {
    const queued = listQueuedNotesFor(ctx, ITEM_ID);
    if (queued.length > 0) {
      throw new Error(`expected no auto-routed note for ${ITEM_ID} (already dispatched or progressed), got: ${queued.join('\n---\n')}`);
    }
  });
}

module.exports = {
  registerSteps,
  checkSweepWiredInCadence,
  locateCadenceConditional,
  findMatchingParen,
  CADENCE_CONDITIONAL_ANCHOR,
  DISPATCH_GAP_SWEEP_NAME,
};
