'use strict';

// BL-1113: stamp-off of Cursor hotfix 27273f2b0a. Drives the REAL landed
// APIs (master_main_reconcile_lib sync-action / deadlock, cursor-forge.conf,
// pipelineBoard deriveKebabSlug + wrapPipelineBoardHtml, planConfirmButtons +
// writePendingPlanConfirm). Never reimplements those behaviours.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1113 stamp-off of Cursor hotfix 27273f2b0a';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'master_main_reconcile_lib.bb');
const PACK = path.join(REPO_ROOT, 'swarmforge', 'packs', 'cursor-forge.conf');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');

const KNOWN_ACTIONS = new Set(['proceed', 'ff-only', 'wait-reconcile', 'deadlock-tripped']);
const KNOWN_DEADLOCK = new Set(['clear', 'active']);

const EXPECTED_ROWS = {
  '0|0|clear': 'proceed',
  '0|2|clear': 'ff-only',
  '3|1|clear': 'wait-reconcile',
  '3|1|active': 'deadlock-tripped',
};

const EXPECTED_SLUGS = {
  'fix the widget': 'fix-the-widget',
  'Pipeline Board: Post The New Message': 'pipeline-board-post',
};

function bb(expr) {
  return execFileSync(
    'bb',
    ['-e', `(load-file "${LIB}")\n${expr}`],
    { encoding: 'utf8' }
  ).trim();
}

function syncAction({ ahead, behind, deadlock }) {
  const active = deadlock === 'active';
  return bb(
    `(println (name (master-main-reconcile-lib/sync-action
       {:ahead ${Number(ahead)}
        :behind ${Number(behind)}
        :deadlock-active? ${active}})))`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── main-sync-status-01 ──────────────────────────────────────────────
  scoped(/^local main is (\d+) ahead and (\d+) behind origin\/main$/, (ctx, ahead, behind) => {
    ctx.ahead = ahead;
    ctx.behind = behind;
  });

  scoped(/^the deadlock marker is (clear|active)$/, (ctx, deadlock) => {
    assert.ok(KNOWN_DEADLOCK.has(deadlock), `unknown deadlock cell ${deadlock}`);
    ctx.deadlock = deadlock;
  });

  scoped(/^main_sync_status_cli reports sync status$/, (ctx) => {
    // Drive the pure sync-action the CLI calls (fixture matrix; no network fetch).
    ctx.action = syncAction({
      ahead: ctx.ahead,
      behind: ctx.behind,
      deadlock: ctx.deadlock,
    });
  });

  scoped(/^the action is (\S+)$/, (ctx, action) => {
    assert.ok(KNOWN_ACTIONS.has(action), `unknown action ${action}`);
    const key = `${ctx.ahead}|${ctx.behind}|${ctx.deadlock}`;
    assert.equal(EXPECTED_ROWS[key], action, 'Examples row must match locked table');
    assert.equal(ctx.action, action);
  });

  // ── main-sync-deadlock-02 ────────────────────────────────────────────
  scoped(/^the main-sync deadlock marker is active$/, (ctx) => {
    ctx.daemonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1113-deadlock-'));
    bb(`(master-main-reconcile-lib/write-deadlock! "${ctx.daemonDir}"
         {:active true :alerted true :ahead 3 :behind 1 :reason "diverged"})`);
    ctx.deadlockState = bb(
      `(println (pr-str (master-main-reconcile-lib/read-deadlock "${ctx.daemonDir}")))`
    );
  });

  scoped(/^origin\/main has commits the local tip has not absorbed$/, (ctx) => {
    ctx.behind = 1;
    assert.equal(
      bb(`(println (master-main-reconcile-lib/deadlock-clear? ${ctx.behind}))`),
      'false'
    );
  });

  scoped(/^handoffd considers a dropped-parcel nudge$/, (ctx) => {
    // Same predicate handoffd's dropped-parcel-sweep! uses before nudging.
    const active = bb(
      `(println (master-main-reconcile-lib/deadlock-active?
         (master-main-reconcile-lib/read-deadlock "${ctx.daemonDir}")))`
    );
    ctx.nudgeSuppressed = active === 'true';
    const handoffdSrc = fs.readFileSync(HANDOFFD, 'utf8');
    ctx.handoffdSuppresses =
      handoffdSrc.includes('dropped-parcel-suppressed') &&
      handoffdSrc.includes('main-sync-deadlock');
  });

  scoped(/^the nudge is suppressed for main-sync-deadlock$/, (ctx) => {
    assert.equal(ctx.nudgeSuppressed, true);
    assert.equal(ctx.handoffdSuppresses, true);
  });

  scoped(/^the deadlock alert has been raised at most once for that trip$/, (ctx) => {
    try {
      // Trip-once: already-active state is never due again.
      const due = bb(`(println (master-main-reconcile-lib/deadlock-trip-due?
        {:ahead 3 :behind 1 :coordinator-in-process-aged? true
         :blocked-ticks 99
         :deadlock-state (master-main-reconcile-lib/read-deadlock "${ctx.daemonDir}")
         :threshold-ticks 3}))`);
      assert.equal(due, 'false', 'active deadlock must not re-trip');
      assert.match(ctx.deadlockState, /:alerted true/);
    } finally {
      if (ctx.daemonDir) {
        try {
          fs.rmSync(ctx.daemonDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        ctx.daemonDir = undefined;
      }
    }
  });

  // ── cursor-forge-pack-03 ─────────────────────────────────────────────
  scoped(/^the pack file swarmforge\/packs\/cursor-forge\.conf$/, (ctx) => {
    assert.ok(fs.existsSync(PACK), `missing ${PACK}`);
    ctx.packText = fs.readFileSync(PACK, 'utf8');
  });

  scoped(/^the pack is read$/, (ctx) => {
    assert.ok(ctx.packText.length > 0);
  });

  scoped(/^rotation is standing$/, (ctx) => {
    assert.match(ctx.packText, /config rotation standing/);
  });

  scoped(/^active_backlog_max_depth is 3$/, (ctx) => {
    assert.match(ctx.packText, /config active_backlog_max_depth 3/);
  });

  scoped(/^remote_control is off$/, (ctx) => {
    assert.match(ctx.packText, /config remote_control off/);
  });

  scoped(/^every pipeline window uses the cursor agent token$/, (ctx) => {
    const windows = ctx.packText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('window '));
    assert.ok(windows.length >= 7, `expected pipeline windows, got ${windows.length}`);
    for (const line of windows) {
      assert.match(line, /\bcursor\b/, `window must use cursor: ${line}`);
    }
  });

  // ── pipeline-board-ux-04 ─────────────────────────────────────────────
  scoped(/^a ticket titled "([^"]*)"$/, (ctx, title) => {
    ctx.ticketTitle = title;
  });

  scoped(/^the Pipeline Board HTML body is rendered$/, (ctx) => {
    // Prefer compiled out/; fall back to sibling require used by unit tests.
    const board = require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'pipelineBoard.js'));
    ctx.slug = board.deriveKebabSlug(ctx.ticketTitle);
    const text = [
      'DC\u00a0QA',
      `BL-1113 ${ctx.slug}`,
    ].join('\n');
    ctx.boardHtml = board.wrapPipelineBoardHtml(text);
  });

  scoped(/^the kebab slug is "([^"]*)"$/, (ctx, slug) => {
    assert.equal(EXPECTED_SLUGS[ctx.ticketTitle], slug, 'Examples slug must match locked table');
    assert.equal(ctx.slug, slug);
  });

  scoped(/^the stage header uses an HTML nbsp entity between DC and QA$/, (ctx) => {
    assert.match(ctx.boardHtml, /DC&nbsp;QA/);
  });

  // ── create-plan-confirm-05 ───────────────────────────────────────────
  scoped(/^a Cursor bridge progress event that carries a CreatePlan body$/, (ctx) => {
    ctx.planBody = '1. Do the thing\n2. Ship it';
    ctx.planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1113-plan-'));
  });

  scoped(/^the Telegram Cursor Remote live path handles that event$/, (ctx) => {
    const core = require(path.join(
      REPO_ROOT,
      'extension',
      'out',
      'tools',
      'telegramCursorOperatorCore.js'
    ));
    const live = require(path.join(
      REPO_ROOT,
      'extension',
      'out',
      'tools',
      'telegramCursorBridgeLive.js'
    ));
    ctx.planPrompt = core.formatPlanConfirmPrompt(ctx.planBody);
    ctx.planButtons = core.planConfirmButtons();
    live.writePendingPlanConfirm(ctx.planRoot, {
      plan: ctx.planBody,
      postedAtMs: Date.now(),
    });
    ctx.pendingPath = live.pendingPlanConfirmPath(ctx.planRoot);
  });

  scoped(/^a plan-confirm prompt is posted with Confirm plan and Reject plan buttons$/, (ctx) => {
    assert.match(ctx.planPrompt, /Plan awaiting confirmation/);
    const flat = ctx.planButtons.flat();
    assert.ok(flat.some((b) => b.text === 'Confirm plan'));
    assert.ok(flat.some((b) => b.text === 'Reject plan'));
  });

  scoped(/^a pending plan-confirm record is written for that plan$/, (ctx) => {
    try {
      assert.ok(fs.existsSync(ctx.pendingPath), `missing ${ctx.pendingPath}`);
      const pending = JSON.parse(fs.readFileSync(ctx.pendingPath, 'utf8'));
      assert.equal(pending.plan, ctx.planBody);
    } finally {
      if (ctx.planRoot) {
        try {
          fs.rmSync(ctx.planRoot, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        ctx.planRoot = undefined;
      }
    }
  });
}

module.exports = { registerSteps };
