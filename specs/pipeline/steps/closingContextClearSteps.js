'use strict';

// BL-309: step handlers for "the coordinator's context is cleared at a safe
// boundary after each ticket's bookkeeping close". Drives the real
// closing_context_clear_lib.bb through closing_context_clear_harness.bb -
// fake :inject-clear!/:inject-startup-reread!/:record-clear! adapters (no
// real tmux), no real clock. The real end-to-end daemon wiring (a live
// handoffd.bb process, a real master-resident coordinator mailbox, real
// backlog/done/, fake tmux) is covered separately by
// swarmforge/scripts/test/test_handoffd_closing_context_clear_wiring.sh.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'closing_context_clear_harness.bb');

function runHarness(idle, closedTicketId, lastClearedTicketId) {
  const out = execFileSync(
    'bb',
    [HARNESS, idle ? 'true' : 'false', closedTicketId || '-', lastClearedTicketId || '-'],
    { encoding: 'utf8' }
  );
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── clear-fires-at-safe-close-01 ──────────────────────────────────────
  registry.define(/^the coordinator has just completed its bookkeeping close for a ticket$/, (ctx) => {
    ctx.closedTicketId = ctx.closedTicketId || 'BL-401';
    ctx.lastClearedTicketId = ctx.lastClearedTicketId === undefined ? null : ctx.lastClearedTicketId;
  });

  registry.define(/^the coordinator is idle with no in-process task and an empty inbox$/, (ctx) => {
    ctx.idle = true;
  });

  registry.define(/^the closing-context-clear check runs$/, (ctx) => {
    ctx.result = runHarness(ctx.idle, ctx.closedTicketId, ctx.lastClearedTicketId);
  });

  registry.define(/^a clear is injected into the coordinator's pane$/, (ctx) => {
    if (ctx.result.action !== 'clear' || !ctx.result.calls.some((c) => c.op === 'inject-clear')) {
      throw new Error(`expected a clear to be injected, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the startup re-read instruction is injected immediately after$/, (ctx) => {
    const ops = ctx.result.calls.map((c) => c.op);
    const clearIdx = ops.indexOf('inject-clear');
    const rereadIdx = ops.indexOf('inject-startup-reread');
    if (clearIdx === -1 || rereadIdx === -1 || rereadIdx !== clearIdx + 1) {
      throw new Error(`expected inject-startup-reread immediately after inject-clear, got: ${JSON.stringify(ctx.result.calls)}`);
    }
    const rereadCall = ctx.result.calls[rereadIdx];
    if (!/constitution\.prompt/.test(rereadCall.text) || !/PIPELINE\.md/.test(rereadCall.text)) {
      throw new Error(`expected the startup re-read instruction to name the constitution and PIPELINE.md, got: ${JSON.stringify(rereadCall)}`);
    }
  });

  // ── no-clear-while-not-idle-02 ─────────────────────────────────────────
  registry.define(/^the coordinator is not idle because it has (an in-process task|a pending inbox item)$/, (ctx) => {
    ctx.idle = false;
  });

  registry.define(/^no clear is injected$/, (ctx) => {
    if (ctx.result.action === 'clear' || ctx.result.calls.length !== 0) {
      throw new Error(`expected no clear to be injected, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── no-repeat-clear-same-close-03 ─────────────────────────────────────
  registry.define(/^a clear was already issued for the coordinator's most recent bookkeeping close$/, (ctx) => {
    ctx.closedTicketId = 'BL-401';
    ctx.lastClearedTicketId = 'BL-401';
    ctx.idle = true;
  });

  registry.define(/^no new bookkeeping close has happened since$/, (ctx) => {
    // Non-behavioral: ctx.closedTicketId already equals ctx.lastClearedTicketId
    // (set above) - nothing further to fixture.
    if (ctx.closedTicketId !== ctx.lastClearedTicketId) {
      throw new Error('fixture setup error: expected the closed ticket to match the last-cleared one');
    }
  });

  // ── new-close-triggers-again-04 ────────────────────────────────────────
  registry.define(/^the coordinator has since completed its bookkeeping close for a different ticket$/, (ctx) => {
    ctx.closedTicketId = 'BL-402';
  });
}

module.exports = { registerSteps };
