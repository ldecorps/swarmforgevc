'use strict';

// BL-846: step handlers for "a role's answer reaches the pane that role is
// actually running in". Scenario 01 (the Scenario Outline) drives the REAL
// compiled resolveRolePaneTarget (telegram-front-desk-bot.ts) against a real
// sessions.tsv + mono-router-active-role fixture, with tmux faked only for
// getPaneBaseIndex's show-window-options call - the exact function BL-846
// fixes, exercised end to end.
//
// Scenarios 02/03 drive the REAL pollAndForward -> deliverAskAnswer ->
// captureRoleAnswer chain (telegramFrontDeskBotCore.ts, unchanged by this
// ticket) for the routing DECISION (which leg fires, whether the pending
// marker clears), reusing the REAL readRoleAwaitingAnswer/
// clearRoleAwaitingAnswer/resolveAskOptions (plain fs, no subprocess) - the
// same "drive the real core, fake only the boundary" posture
// bl425RoleSteeringTopicsSteps.js/bl607RoleClarifyingPollSteps.js already
// use. redirectToRole and enqueueRoleAnswerNote ARE mocked here rather than
// driven for real: redirectToRole's own failure path retries through
// sendInstructionVerified's REAL sleepSync backoff (real wall-clock delay,
// against the Test Speed rule's "no real timers"), and enqueueRoleAnswerNote
// shells to the real swarm_handoff.bb (needs a live git repo) - both already
// covered by their own dedicated unit tests (BL-425, BL-607). The
// redirectToRole mock's delivered/no-pane verdict is computed by calling the
// REAL resolveRolePaneTarget and checking whether it resolved to the
// fixture's one genuinely-live session (the resident's) - so the routing
// decision under test is still driven by BL-846's own fixed code, not a
// hand-picked boolean.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  resolveRolePaneTarget,
  roleAwaitingAnswerPath,
  readRoleAwaitingAnswer,
  clearRoleAwaitingAnswer,
  resolveAskOptions,
} = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const { pollAndForward, roleAskThreadId } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { installInProcessTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

const FEATURE_NAME = "a role's answer reaches the pane that role is actually running in";
const PRINCIPAL_ID = 111;

// Matches the real mono-router pack's own .swarmforge/roles.tsv row order
// observed live for this repo's own swarm (coder first - this pack's
// configured resident/home role - then the rest of the pipeline, coordinator
// last), NOT rolePack.ts's PIPELINE_CHAIN order (specifier first) - the two
// are unrelated: PIPELINE_CHAIN is generic stage order, this is the specific
// launcher-written session roster order a live mono-router pack produces.
const ROSTER = ['coder', 'specifier', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator'];
const RESIDENT_ROLE = ROSTER.find((r) => r !== 'coordinator');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl846-'));
}

function stateDir(ctx) {
  return path.join(ctx.targetPath, '.swarmforge');
}

function writeMarker(ctx, rawValue) {
  const markerPath = path.join(stateDir(ctx), 'mono-router-active-role');
  if (rawValue === 'missing') {
    return;
  }
  if (rawValue === 'blank') {
    fs.writeFileSync(markerPath, '   \n');
    return;
  }
  const role = rawValue.replace(/^"|"$/g, '');
  fs.writeFileSync(markerPath, `${role}\n`);
}

function residentSession() {
  return `swarmforge-${RESIDENT_ROLE}`;
}

// The real resolveRolePaneTarget decides WHICH session a role's answer
// targets; "delivered" here means that session is the fixture's one
// genuinely-live one (the resident's) - see file header for why this stops
// short of driving the real tmux inject.
function realDeliveryOutcome(ctx, role) {
  const resolved = resolveRolePaneTarget(ctx.targetPath, role);
  ctx.lastResolved = resolved;
  return resolved && resolved.target.startsWith(`${residentSession()}:`) ? { kind: 'delivered' } : { kind: 'no-pane' };
}

function mkCallbackUpdate(threadId, optionIndex) {
  return {
    update_id: 1,
    callback_query: { id: 'cbq-1', data: `ask:${threadId}:${optionIndex}`, from: { id: PRINCIPAL_ID }, message: { chat: { id: 1 } } },
  };
}

// installInProcessTmux monkeypatches child_process.spawnSync process-wide.
// Each of this feature's own scenarios re-runs Background, so this restores
// the PRIOR scenario's patch (proper LIFO, mirroring
// tmuxDoubleAnswersInProcessSteps.js's own convention) before installing the
// next - only the very last scenario's patch is left in place, same as
// every other single-install step file in this suite (e.g.
// gateAnswerSteps.js) already accepts.
let activeFakeTmux;

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a mono-router swarm whose only live panes are the resident pane and the coordinator pane$/,
    (ctx) => {
      if (activeFakeTmux) {
        activeFakeTmux.restore();
      }
      ctx.targetPath = mkTmp();
      fs.mkdirSync(stateDir(ctx), { recursive: true });
      fs.writeFileSync(path.join(stateDir(ctx), 'tmux-socket'), '/tmp/fake.sock');
      ctx.fakeTmux = installInProcessTmux([{ subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' }]);
      activeFakeTmux = ctx.fakeTmux;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the roster names a distinct session for every pipeline role$/,
    (ctx) => {
      const lines = ROSTER.map((role, i) => `${i + 1}\t${role}\tswarmforge-${role}\t${role}\tclaude`).join('\n');
      fs.writeFileSync(path.join(stateDir(ctx), 'sessions.tsv'), `${lines}\n`);
    },
    FEATURE_NAME
  );

  // ── role-pane-resolution-follows-recorded-identity-01 ────────────────────

  registry.defineScoped(
    /^the resident identity marker is (.+)$/,
    (ctx, raw) => {
      writeMarker(ctx, raw);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^delivery resolves the live pane for role "([^"]*)"$/,
    (ctx, role) => {
      ctx.requestedRole = role;
      ctx.resolved = resolveRolePaneTarget(ctx.targetPath, role);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it resolves (.+)$/,
    (ctx, resolutionPhrase) => {
      const expectedSession =
        resolutionPhrase === 'the resident pane'
          ? residentSession()
          : (() => {
              const match = /^([A-Za-z]+)'s own session pane$/.exec(resolutionPhrase);
              if (!match) {
                throw new Error(`unrecognized resolution phrase: "${resolutionPhrase}"`);
              }
              return `swarmforge-${match[1]}`;
            })();
      if (!ctx.resolved) {
        throw new Error(`expected a resolved pane for role "${ctx.requestedRole}" (wanted session "${expectedSession}"), got none`);
      }
      const actualSession = ctx.resolved.target.split(':')[0];
      if (actualSession !== expectedSession) {
        throw new Error(`role "${ctx.requestedRole}": expected session "${expectedSession}", got "${actualSession}"`);
      }
    },
    FEATURE_NAME
  );

  // ── answer-interrupts-a-blocked-resident-02 /
  //    dormant-role-answer-still-queues-03 ─────────────────────────────────

  registry.defineScoped(
    /^QA has a clarifying question pending$/,
    (ctx) => {
      const p = roleAwaitingAnswerPath(ctx.targetPath, 'QA');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ question: 'proceed?', options: [{ label: 'proceed' }] }));
    },
    FEATURE_NAME
  );

  // Purely establishes the scenario's own stated premise (matches the real
  // 2026-08-07 incident this ticket fixes) - the TS-side delivery code path
  // under test never reads in_process state at all (that guard lives
  // entirely in ready_for_next.sh, explicitly out of scope per the ticket's
  // own out_of_scope section), so this step asserts nothing on its own.
  registry.defineScoped(
    /^QA holds in-process work$/,
    (ctx) => {
      const dir = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '00_fixture_from_coordinator_to_QA_for_QA.handoff'),
        'id: fixture\nfrom: coordinator\nto: QA\nrecipient: QA\npriority: 00\ntype: git_handoff\ntask: BL-000-fixture\ncommit: 0000000000\n'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human answers that question$/,
    async (ctx) => {
      const threadId = roleAskThreadId('QA');
      ctx.redirected = [];
      ctx.queuedNotes = [];
      await pollAndForward(0, String(PRINCIPAL_ID), {
        chatId: '1',
        getUpdates: async () => ({ success: true, updates: [mkCallbackUpdate(threadId, 0)] }),
        postToBridge: async () => {
          throw new Error('postToBridge should never be called for a role question');
        },
        openSubjectAndRecord: async () => {
          throw new Error('openSubjectAndRecord should not be called for a role-topic answer');
        },
        subjectForTopic: () => undefined,
        backlogForTopic: () => undefined,
        readRoleTopicMap: () => ({}),
        redirectToRole: async (role, text) => {
          const outcome = realDeliveryOutcome(ctx, role);
          ctx.redirected.push({ role, text, outcome });
          return outcome;
        },
        getRolePendingQuestion: async (role) => readRoleAwaitingAnswer(ctx.targetPath, role) !== undefined,
        clearRolePendingQuestion: async (role) => clearRoleAwaitingAnswer(ctx.targetPath, role),
        enqueueRoleAnswerNote: async (role, text) => {
          ctx.queuedNotes.push({ role, text });
          return true;
        },
        answerCallbackQuery: async () => {},
        resolveAskOptions: async (tid) => resolveAskOptions(ctx.targetPath, tid),
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the answer is delivered into the resident pane as an interrupting nudge$/,
    (ctx) => {
      const match = ctx.redirected.find((r) => r.role === 'QA' && r.outcome.kind === 'delivered');
      if (!match) {
        throw new Error(`expected QA's answer delivered into the resident pane, got: ${JSON.stringify(ctx.redirected)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no answer note is queued into QA's inbox$/,
    (ctx) => {
      if (ctx.queuedNotes.length !== 0) {
        throw new Error(`expected no queued note for QA, got: ${JSON.stringify(ctx.queuedNotes)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the answer is queued as a note into QA's inbox$/,
    (ctx) => {
      if (!ctx.queuedNotes.some((n) => n.role === 'QA')) {
        throw new Error(`expected the answer queued as a note for QA, got: ${JSON.stringify(ctx.queuedNotes)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^QA's pending question marker is cleared$/,
    (ctx) => {
      if (readRoleAwaitingAnswer(ctx.targetPath, 'QA') !== undefined) {
        throw new Error("expected QA's pending-question marker cleared, but it is still set");
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
