'use strict';

// BL-1278: step handlers for "the approval card shows the description, not
// the mint notes". Drives the REAL topicRouter.ts and conciergeTick.ts
// (compiled to extension/out/concierge/) - builds ticket payloads and
// invokes messageTextForEvent to verify the card's "What it solves" line
// shows the description (problem statement) rather than the notes (mint
// provenance).

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { messageTextForEvent } = require(path.join(EXT_OUT, 'concierge', 'topicRouter'));

function registerSteps(registry) {
  // ── Scenario 01: approval card shows description ─────────────────────
  registry.define(/^a paused ticket awaiting approval whose description says what the ticket solves$/, (ctx) => {
    ctx.ticket = {
      id: 'BL-1278',
      type: 'ApprovalRequested',
      payload: {
        title: 'a fine feature',
        description: 'This is the problem statement that explains what the ticket solves.',
        notes: 'Verification done at mint: read the code, confirmed the behavior.',
      },
    };
  });

  registry.define(/^whose notes record how the ticket was verified at mint$/, (ctx) => {
    // The notes are already set in the previous step. This step is a
    // continuation that makes the scenario read naturally.
    if (!ctx.ticket.payload.notes) {
      throw new Error('expected notes to be set');
    }
  });

  registry.define(/^the concierge posts its approval ask$/, (ctx) => {
    ctx.cardText = messageTextForEvent(ctx.ticket);
  });

  registry.define(/^the card's "What it solves" line shows the description$/, (ctx) => {
    if (!ctx.cardText.includes('What it solves: This is the problem statement')) {
      throw new Error(`expected card to show description in "What it solves", got:\n${ctx.cardText}`);
    }
  });

  registry.define(/^it does not show the mint verification record$/, (ctx) => {
    if (ctx.cardText.includes('Verification done at mint')) {
      throw new Error(`expected card to NOT show notes (mint provenance), got:\n${ctx.cardText}`);
    }
  });

  // ── Scenario 02: fallback to notes when no description ───────────────
  registry.define(/^a paused ticket awaiting approval that has no description$/, (ctx) => {
    ctx.ticket = {
      id: 'BL-1278',
      type: 'ApprovalRequested',
      payload: {
        title: 'a fine feature',
        notes: 'This fixes the widget.\n\nSecond paragraph.',
      },
    };
  });

  registry.define(/^the card's "What it solves" line falls back to the notes$/, (ctx) => {
    if (!ctx.cardText.includes('What it solves: This fixes the widget.')) {
      throw new Error(`expected card to fall back to notes, got:\n${ctx.cardText}`);
    }
    if (ctx.cardText.includes('Second paragraph')) {
      throw new Error(`expected only the first paragraph of notes, got:\n${ctx.cardText}`);
    }
  });

  // ── Scenario 03: TaskStarted card follows the same rule ──────────────
  registry.define(/^an active ticket whose description says what the ticket solves$/, (ctx) => {
    ctx.ticket = {
      id: 'BL-1278',
      type: 'TaskStarted',
      payload: {
        title: 'a fine feature',
        description: 'This is the problem statement that explains what the ticket solves.',
        notes: 'Verification done at mint: read the code, confirmed the behavior.',
        firstAcceptanceStep: 'The first step',
      },
    };
  });

  registry.define(/^the concierge posts its task-started card$/, (ctx) => {
    ctx.cardText = messageTextForEvent(ctx.ticket);
  });
}

module.exports = { registerSteps };
