'use strict';

// BL-464: step handlers for "The pipeline board shows every active ticket
// at its true current stage exactly once, from an authoritative
// coordinator-fed source". Drives the REAL `pipeline_stage_cli.bb sync`
// (Babashka - the coordinator's own writer) against a real fs fixture
// (roles.tsv, per-role in_process handoffs, backlog/active yaml files),
// then the REAL compiled reader/renderer chain (readTicketStageMap ->
// invertTicketStageToRoleHeldTickets -> computePipelineBoard) - the exact
// same three functions telegram-front-desk-bot.ts's live wiring calls -
// never a hand-rolled substitute for either half.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');
const { readTicketStageMap, invertTicketStageToRoleHeldTickets } = require(path.join(EXT_DIR, 'out', 'swarm', 'swarmState'));
const { computePipelineBoard } = require(path.join(EXT_DIR, 'out', 'concierge', 'pipelineBoard'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-pipeline-board-stage-'));
}

// Master-resident roles (specifier/coordinator) share one worktree-path
// with a per-role mailbox subdir; every other role gets its OWN distinct
// worktree-path - mirrors the real multi-worktree layout (a shared flat
// path for two non-master roles would collide their mailboxes), same
// fixture convention test_pipeline_stage_cli.sh already establishes.
function writeRolesTsv(root) {
  const lines = [
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `coder\tcoder\t${root}/wt-coder\tswarmforge-coder\tCoder\tclaude\ttask`,
    `cleaner\tcleaner\t${root}/wt-cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
    `QA\tQA\t${root}/wt-QA\tswarmforge-QA\tQa\tclaude\ttask`,
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    '',
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n'));
}

function writeBacklogActive(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

function inProcessDir(root, role) {
  return role === 'specifier' || role === 'coordinator'
    ? path.join(root, '.swarmforge', 'handoffs', role, 'inbox', 'in_process')
    : path.join(root, `wt-${role}`, '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function writeNoteHandoff(root, role, id) {
  const dir = inProcessDir(root, role);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '10_note.handoff'),
    `from: coordinator\nto: ${role}\ntype: note\npriority: 10\nmessage: ${id} promoted to active/ — starting now\n\nRe-read your role and constitution.\n\n${id} promoted to active/ — starting now\n`
  );
}

function writeGitHandoff(root, role, id, fromRole, commit) {
  const dir = inProcessDir(root, role);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `50_${role}.handoff`),
    `from: ${fromRole}\nto: ${role}\ntype: git_handoff\npriority: 50\ntask: ${id}-thing\ncommit: ${commit}\n\nmerge_and_process ${fromRole} ${commit}\n`
  );
}

function clearInProcess(root, role) {
  const dir = inProcessDir(root, role);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, f));
    }
  }
}

function sync(root) {
  execFileSync('bb', [CLI, root, 'sync'], { encoding: 'utf8' });
}

// BL-464's own render: real pipeline_stage_cli.bb sync -> real
// readTicketStageMap -> real invertTicketStageToRoleHeldTickets -> real
// computePipelineBoard - the exact chain telegram-front-desk-bot.ts's live
// wiring calls, proven end to end against a real fs fixture.
//
// Exported (not registered as its own "the pipeline board is rendered"
// step) because that EXACT step text is already owned by
// bl452PipelineBoardSteps.js (registered first in index.js, so first-match-
// wins resolve() gives it the text) - mirrors
// aDroppedMessageMustNotParkTheOffsetSteps.js's own established fix for the
// identical collision shape: the FIRST-registered file's own handler
// delegates to THIS exported helper when its ctx.fixture precondition
// (bl452's own Given steps) is absent, exactly the way that ticket's
// ctx.updates check delegates to frontDeskListensOnlyToItsOwnChatSteps.js's
// collectFrontDeskMessages.
function renderPipelineBoardForFixtureRoot(ctx) {
  sync(ctx.root);
  const roleHeldTickets = invertTicketStageToRoleHeldTickets(readTicketStageMap(ctx.root));
  ctx.board = computePipelineBoard(roleHeldTickets, [], {});
}

function rowFor(ctx, id) {
  return ctx.board.rows.filter((r) => r.id === id);
}

function registerSteps(registry) {
  // ── board-authoritative-stage-01 / -04 (note-based kickoff) ──────────
  registry.define(/^a ticket promoted to active and kicked off to the coder by a coordinator note$/, (ctx) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    writeRolesTsv(ctx.root);
    ctx.ticketId = 'BL-434';
    writeBacklogActive(ctx.root, ctx.ticketId);
    writeNoteHandoff(ctx.root, 'coder', ctx.ticketId);
  });

  registry.define(/^the coder is actively working it$/, () => {
    // The note itself IS the "kicked off, now in_process" state this fixture
    // already set up - nothing further to arrange. A separate step exists
    // because the feature file's own Given/And phrasing describes two
    // distinct facts, even though this fixture models them with one action.
  });

  registry.define(/^the authoritative ticket-to-stage source reflects where each active ticket is$/, (ctx) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    writeRolesTsv(ctx.root);
  });

  registry.define(/^a ticket is held in a way an in_process git_handoff task-header scrape would miss$/, (ctx) => {
    ctx.ticketId = 'BL-450';
    writeBacklogActive(ctx.root, ctx.ticketId);
    // A note carries no task: header at all (handoff-protocol.md forbids
    // it) - exactly the shape the old readInProcessTicketIds scrape
    // (task-header-only) could never see.
    writeNoteHandoff(ctx.root, 'coder', ctx.ticketId);
  });

  // ── board-authoritative-stage-02 (double-role transition) ────────────
  registry.define(/^an active ticket whose handoff is momentarily observable at two roles during a transition$/, (ctx) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    writeRolesTsv(ctx.root);
    ctx.ticketId = 'BL-460';
    writeBacklogActive(ctx.root, ctx.ticketId);
    writeGitHandoff(ctx.root, 'coder', ctx.ticketId, 'specifier', '1111111111');
    writeGitHandoff(ctx.root, 'cleaner', ctx.ticketId, 'coder', '2222222222');
  });

  // ── board-authoritative-stage-03 (moved to a new stage) ──────────────
  registry.define(/^an active ticket that has moved from one stage to the next$/, (ctx) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    writeRolesTsv(ctx.root);
    ctx.ticketId = 'BL-461';
    ctx.previousStage = 'coder';
    ctx.newStage = 'cleaner';
    writeBacklogActive(ctx.root, ctx.ticketId);
    writeGitHandoff(ctx.root, ctx.previousStage, ctx.ticketId, 'specifier', '3333333333');
    sync(ctx.root); // an EARLIER sync recorded it at the previous stage...
    clearInProcess(ctx.root, ctx.previousStage); // ...then it moved on: the old role's handoff is gone...
    writeGitHandoff(ctx.root, ctx.newStage, ctx.ticketId, ctx.previousStage, '4444444444'); // ...and the new role now holds it.
  });

  // ── board-authoritative-stage-05 (BL-471 case-robustness) ────────────
  registry.define(/^an active ticket "([^"]+)"$/, (ctx, id) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    writeRolesTsv(ctx.root);
    ctx.ticketId = id;
    ctx.role = 'coder';
    writeBacklogActive(ctx.root, ctx.ticketId);
  });

  registry.define(/^a role holds a handoff whose header leads with the id "([^"]+)"$/, (ctx, differentlyCasedId) => {
    writeNoteHandoff(ctx.root, ctx.role, differentlyCasedId);
  });

  registry.define(/^the ticket appears on the board at that role's stage$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column !== ctx.role) {
      throw new Error(`expected ${ctx.ticketId} on the board at the "${ctx.role}" stage, got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });

  registry.define(/^it appears on exactly one row$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1) {
      throw new Error(`expected ${ctx.ticketId} on exactly one row, got: ${JSON.stringify(rows)}`);
    }
  });

  // "the pipeline board is rendered" is NOT registered here - see
  // renderPipelineBoardForFixtureRoot's own comment above; bl452's shared
  // handler delegates to it.

  // ── Then/And ──────────────────────────────────────────────────────────
  registry.define(/^the ticket appears on the board at the coder's stage$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column !== 'coder') {
      throw new Error(`expected ${ctx.ticketId} on the board at the coder stage, got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });

  registry.define(/^the ticket appears on exactly one row$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1) {
      throw new Error(`expected ${ctx.ticketId} on exactly one row, got: ${JSON.stringify(rows)}`);
    }
  });

  registry.define(/^that row is its single current stage$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows[0].column !== 'cleaner') {
      throw new Error(`expected ${ctx.ticketId}'s single row at the more-downstream "cleaner" stage, got: ${JSON.stringify(rows)}`);
    }
  });

  registry.define(/^the ticket appears at the new stage$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column !== ctx.newStage) {
      throw new Error(`expected ${ctx.ticketId} at its new stage (${ctx.newStage}), got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });

  registry.define(/^it does not also appear at the previous stage$/, (ctx) => {
    const staleRow = ctx.board.rows.find((r) => r.id === ctx.ticketId && r.column === ctx.previousStage);
    if (staleRow) {
      throw new Error(`expected NO row at the previous stage (${ctx.previousStage}) for ${ctx.ticketId}, got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });

  registry.define(/^that ticket still appears at its current stage$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column !== 'coder') {
      throw new Error(`expected ${ctx.ticketId} still visible at the coder stage despite carrying no task: header, got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });
}

module.exports = { registerSteps, renderPipelineBoardForFixtureRoot };
