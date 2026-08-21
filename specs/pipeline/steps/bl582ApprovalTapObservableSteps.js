'use strict';

// BL-582: step handlers for "every approval tap produces an observable,
// durable outcome". Every scenario drives the REAL machinery - the compiled
// telegramFrontDeskBotCore poll path over a fixture backlog with the REAL
// pendingApprovalReply writer/explainer behind it, the REAL
// front_desk_supervisor_lib.bb state machine via bb, and the REAL
// appendFrontDeskDiagnostic sink written from a SUBPROCESS that then exits
// (scenario 07's "not lost with the process" is a claim about surviving a
// process death, so a fixture that never kills one would not test it).
//
// The Telegram HTTP surface is the environmentally-unsuitable boundary and
// is the only thing stubbed: answerCallbackQuery/editApprovalAskMessage are
// recorded, never called for real. Everything they gate - the record, the
// commit decision, the diagnostic - is the real code.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'every approval tap produces an observable, durable outcome';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const PRINCIPAL = '424242';
const CHAT_ID = '1';
const BACKLOG_ID = 'BL-582';

// Explicit known values per the Scenario Outline handler rule: the closed
// set of drop paths the feature's Examples actually use. A row these
// handlers do not know is a hard failure, never a passthrough. The two
// HUMAN-FACING paths (a real tap by the principal, in our chat) also owe a
// toast; the two unauthorized ones deliberately owe none - answering them
// would confirm this bot exists to a stranger.
// `reason` is the token the diagnostic line actually carries: it equals the
// Examples value for the three that are already reason names, and maps the
// prose row ("changed:false record") onto the name the code emits.
const KNOWN_DROP_PATHS = new Map([
  ['not-my-chat', { humanFacing: false, reason: 'not-my-chat' }],
  ['not-principal', { humanFacing: false, reason: 'not-principal' }],
  ['unrecognized-data', { humanFacing: true, reason: 'unrecognized-data' }],
  ['changed:false record', { humanFacing: true, reason: 'record-no-op' }],
]);

const ALL_DROP_REASONS = [...KNOWN_DROP_PATHS.values()].map((v) => v.reason);

function core() {
  return require(path.join(OUT, 'tools', 'telegramFrontDeskBotCore'));
}

function botCli() {
  return require(path.join(OUT, 'tools', 'telegram-front-desk-bot'));
}

function approvals() {
  return require(path.join(OUT, 'concierge', 'pendingApprovalReply'));
}

function mkFixture(ctx, { humanApproval } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl582-acc-'));
  ctx.root = root;
  ctx.diagnostics = [];
  ctx.answered = [];
  ctx.commits = [];
  ctx.notified = [];
  if (humanApproval !== undefined) {
    const dir = path.join(root, 'backlog', 'paused');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${BACKLOG_ID}-slug.yaml`), `id: ${BACKLOG_ID}\ntitle: t\nhuman_approval: ${humanApproval}\n`);
    ctx.ticketPath = path.join(dir, `${BACKLOG_ID}-slug.yaml`);
  }
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function callbackUpdate({ ownChat = true, fromPrincipal = true, data = `approve:${BACKLOG_ID}` } = {}) {
  return {
    update_id: 1,
    callback_query: {
      id: 'cbq-1',
      data,
      from: { id: fromPrincipal ? Number(PRINCIPAL) : 999 },
      message: { chat: { id: ownChat ? 1 : 2 }, message_thread_id: 7 },
    },
  };
}

// The live adapter set, with the REAL record/explain writers bound to the
// fixture root - the same two functions telegram-front-desk-bot.ts binds in
// production, never a stand-in that could pass while the real one fails.
function adaptersFor(ctx, update, { repaintSucceeds = true, commitResult = true, askTracked = true } = {}) {
  const { recordApprovalReply, recordRejectionReply, recordAmendReply, explainApprovalRecordNoOp, readRecordedVerdict } = approvals();
  return {
    chatId: CHAT_ID,
    getUpdates: async () => ({ success: true, updates: [update] }),
    postToBridge: async () => true,
    openSubjectAndRecord: async () => undefined,
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    recordApprovalReply: async (id) => recordApprovalReply(ctx.root, id),
    recordRejectionReply: async (id, reason) => recordRejectionReply(ctx.root, id, reason),
    recordAmendReply: async (id) => recordAmendReply(ctx.root, id),
    explainApprovalRecordNoOp: async (id) => explainApprovalRecordNoOp(ctx.root, id),
    readRecordedApprovalVerdict: async (id) => (ctx.staleTapGuard ? readRecordedVerdict(ctx.root, id) : undefined),
    setPendingButtonAction: async () => {},
    answerCallbackQuery: async (id, text) => ctx.answered.push({ id, text }),
    readApprovalAskMessage: async () => (askTracked ? { topicId: 800, messageId: 9, text: `${BACKLOG_ID} needs your approval` } : undefined),
    editApprovalAskMessage: async (topicId, messageId, text) => {
      if (!repaintSucceeds) {
        return { success: false, error: 'edit refused' };
      }
      ctx.repainted = { topicId, messageId, text };
      return { success: true };
    },
    commitApprovalWrites: async (id, message) => {
      ctx.commits.push({ id, message });
      return commitResult;
    },
    notifyApprovalsTopic: async (topicId, text) => {
      ctx.notified.push({ topicId, text });
      return true;
    },
    logDiagnostic: (line) => ctx.diagnostics.push(line),
  };
}

function ticketText(ctx) {
  return fs.readFileSync(ctx.ticketPath, 'utf8');
}

function diagnosticFor(ctx, reason) {
  return ctx.diagnostics.filter((line) => line.includes(`reason=${reason}`));
}

// Scenario 06 drives the real bb state machine rather than restating its
// arithmetic here: a healthy entry (pid alive, heartbeat fine) whose build
// went stale past the grace must transition WITHOUT a crash.
function runSupervisorFreshness({ staleSinceMs, nowMs, graceMs }) {
  const expr = `
(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${path.join(SCRIPTS_DIR, 'front_desk_supervisor_lib.bb')}")
(let [entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil :started-at-ms 0
             :gave-up-at-ms nil :build-stale-since-ms ${staleSinceMs}}
      cfg {:max-attempts 5 :backoff-base-ms 1000 :backoff-max-ms 60000
           :healthy-reset-ms 600000 :build-grace-ms ${graceMs}}
      r (front-desk-supervisor-lib/check-one! entry ${nowMs} (constantly true) (constantly 4242) cfg
          {:giveup-cooldown-ms 600000} false (fn [_] nil) true)]
  (println (json/generate-string {:status (get-in r [:entry :status]) :event (name (or (:event r) :none))})))`;
  const res = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(res.status, 0, `bb run failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01: the happy path, end to end over a real ticket file ────────────
  scoped(/^a principal's Approve tap on a tracked ask$/, (ctx) => {
    mkFixture(ctx, { humanApproval: 'pending' });
    ctx.update = callbackUpdate();
    ctx.options = {};
  });

  // ── 02: a record that landed, then a repaint that did not ─────────────
  scoped(/^the yaml record write for an Approve tap succeeded$/, (ctx) => {
    mkFixture(ctx, { humanApproval: 'pending' });
    ctx.update = callbackUpdate();
    ctx.options = {};
  });

  scoped(/^the subsequent repaint attempt fails$/, (ctx) => {
    ctx.options = { ...ctx.options, repaintSucceeds: false };
  });

  // ── 03: every drop path ───────────────────────────────────────────────
  scoped(/^a callback tap that hits the (.+) guard$/, (ctx, dropPath) => {
    assert.ok(KNOWN_DROP_PATHS.has(dropPath), `unknown drop path "${dropPath}" - the handlers know ${[...KNOWN_DROP_PATHS.keys()]}`);
    ctx.dropPath = dropPath;
    ctx.options = {};
    if (dropPath === 'not-my-chat') {
      mkFixture(ctx, { humanApproval: 'pending' });
      ctx.update = callbackUpdate({ ownChat: false });
    } else if (dropPath === 'not-principal') {
      mkFixture(ctx, { humanApproval: 'pending' });
      ctx.update = callbackUpdate({ fromPrincipal: false });
    } else if (dropPath === 'unrecognized-data') {
      mkFixture(ctx, { humanApproval: 'pending' });
      ctx.update = callbackUpdate({ data: `snooze:${BACKLOG_ID}` });
    } else {
      // changed:false record - a real, authorized tap on a ticket the
      // writer will refuse. No ticket file at all is the live shape the
      // ticket describes (a stale topic mapping).
      mkFixture(ctx);
      ctx.update = callbackUpdate();
    }
  });

  // ── 04: the repeat tap ────────────────────────────────────────────────
  scoped(/^a ticket whose human_approval verdict is already recorded$/, (ctx) => {
    mkFixture(ctx, { humanApproval: 'approved' });
    ctx.staleTapGuard = true;
    ctx.options = {};
  });

  scoped(/^the same principal taps Approve again on that ask$/, async (ctx) => {
    try {
      ctx.update = callbackUpdate();
      ctx.before = ticketText(ctx);
      ctx.result = await core().pollAndForward(0, PRINCIPAL, adaptersFor(ctx, ctx.update, ctx.options));
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  // ── 05: the commit-on-decision path ───────────────────────────────────
  scoped(/^an Approve tap is being recorded on the master checkout$/, (ctx) => {
    mkFixture(ctx, { humanApproval: 'pending' });
    ctx.update = callbackUpdate();
    ctx.options = {};
  });

  scoped(/^the yaml write completes$/, async (ctx) => {
    try {
      ctx.result = await core().pollAndForward(0, PRINCIPAL, adaptersFor(ctx, ctx.update, ctx.options));
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  // ── 06: the supervisor's healthy tick ─────────────────────────────────
  scoped(/^the front-desk bot is healthy but running a build older than the grace period$/, (ctx) => {
    ctx.supervisor = { staleSinceMs: 1000, graceMs: 300000, nowMs: 1000 + 300001 };
  });

  scoped(/^the supervisor's healthy-tick check runs$/, (ctx) => {
    ctx.supervisorResult = runSupervisorFreshness(ctx.supervisor);
  });

  // ── 07: the diagnostic outlives the process that wrote it ─────────────
  scoped(/^a callback drop diagnostic was just emitted$/, (ctx) => {
    const root = mkFixture(ctx);
    const line = 'front-desk callback callback_query_id=cbq-1 reason=record-no-op detail=BL-582:no-ticket-file';
    ctx.emittedLine = line;
    // Emitted from a SUBPROCESS which then exits - the claim under test is
    // that the record survives the process, so the process really dies.
    let child;
    try {
      const emit = `require(${JSON.stringify(path.join(OUT, 'tools', 'telegram-front-desk-bot'))}).appendFrontDeskDiagnostic(${JSON.stringify(root)}, ${JSON.stringify(line)})`;
      child = spawnSync(process.execPath, ['-e', emit], { encoding: 'utf8' });
      assert.equal(child.status, 0, `the emitting process failed: ${child.stderr}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
    ctx.emitterPid = child.pid;
  });

  scoped(/^the failure window ends$/, (ctx) => {
    // The emitting process has already exited (spawnSync is synchronous).
    assert.ok(ctx.emitterPid, 'an emitting process must have run');
  });

  // ── shared When ───────────────────────────────────────────────────────
  scoped(/^the callback (?:is processed|finishes processing)$/, async (ctx) => {
    try {
      ctx.result = await core().pollAndForward(0, PRINCIPAL, adaptersFor(ctx, ctx.update, ctx.options));
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^the ticket yaml records human_approval approved wherever it lives, active or paused$/, (ctx) => {
    try {
      assert.match(ticketText(ctx), /^human_approval: approved$/m, 'the paused ticket must be flipped to approved');
      assert.equal(ctx.result.posted, 1);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the ask's buttons are stripped and the verdict is shown$/, (ctx) => {
    try {
      assert.ok(ctx.repainted, 'the ask must have been edited');
      assert.match(ctx.repainted.text, /Approved/, 'the repainted ask must show the verdict');
      assert.deepEqual(ctx.answered, [{ id: 'cbq-1', text: undefined }], 'a successful tap clears its spinner with no toast');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the repaint failure is reported$/, (ctx) => {
    try {
      const lines = diagnosticFor(ctx, 'repaint-failed');
      assert.equal(lines.length, 1, `exactly one repaint-failure diagnostic is owed, got ${JSON.stringify(ctx.diagnostics)}`);
      assert.match(lines[0], new RegExp(BACKLOG_ID), 'the diagnostic must name the ticket');
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the recorded verdict remains intact$/, (ctx) => {
    try {
      assert.match(ticketText(ctx), /^human_approval: approved$/m, 'a failed repaint must never roll the verdict back');
      assert.deepEqual(ctx.commits.map((c) => c.id), [BACKLOG_ID], 'the verdict is still committed - durability does not depend on the repaint');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a distinguishable diagnostic is emitted for (.+)$/, (ctx, dropPath) => {
    try {
      assert.equal(dropPath, ctx.dropPath, 'the Then must name the same drop path the Given set up');
      const { reason } = KNOWN_DROP_PATHS.get(dropPath);
      const lines = diagnosticFor(ctx, reason);
      assert.equal(lines.length, 1, `exactly one diagnostic naming ${reason} is owed, got ${JSON.stringify(ctx.diagnostics)}`);
      // Distinguishable, not merely present: the line names THIS path and
      // reads as no other known one.
      for (const other of ALL_DROP_REASONS.filter((r) => r !== reason)) {
        assert.ok(!lines[0].includes(`reason=${other}`), `the ${reason} diagnostic must not also read as ${other}:\n${lines[0]}`);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the human-facing guards surface as a callback toast rather than silence$/, (ctx) => {
    try {
      const { humanFacing } = KNOWN_DROP_PATHS.get(ctx.dropPath);
      if (humanFacing) {
        assert.equal(ctx.answered.length, 1, `a human-facing guard owes a toast, got ${JSON.stringify(ctx.answered)}`);
        assert.ok(ctx.answered[0].text, 'the toast must carry text - an empty spinner-clear is the silence this ticket ends');
      } else {
        assert.deepEqual(ctx.answered, [], 'an unauthorized tap is still answered never - only the diagnostic changed');
      }
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^no second write occurs$/, (ctx) => {
    try {
      assert.equal(ticketText(ctx), ctx.before, 'the ticket file must be byte-identical after a repeat tap');
      assert.deepEqual(ctx.commits, [], 'nothing was written, so nothing is committed');
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the response states the verdict is already recorded rather than doing nothing silently$/, (ctx) => {
    try {
      assert.equal(ctx.answered.length, 1, 'the repeat tap owes exactly one answer');
      assert.match(ctx.answered[0].text ?? '', /approved/i, 'the toast must name the verdict already on record');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the write is committed through the same commit-on-decision path used by expedite writes$/, (ctx) => {
    try {
      assert.deepEqual(ctx.commits.map((c) => c.id), [BACKLOG_ID], 'the approve write must reach the commit adapter');
      // The wiring half: production binds BOTH the expedite and the plain
      // approval commit adapters to the ONE commitApprovalWrites from
      // util/commitIntegrityRunner - never a second, drifting locate-and-
      // commit path. Read from source, because the defect this guards is a
      // future edit pointing one of them somewhere else.
      const wiring = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'src', 'tools', 'telegram-front-desk-bot.ts'), 'utf8');
      assert.match(wiring, /import \{ commitApprovalWrites \} from '\.\.\/util\/commitIntegrityRunner'/);
      assert.match(wiring, /commitApprovalWrites: \(backlogId, message\) => commitApprovalWrites\(targetPath, backlogId, message\)/);
      assert.match(wiring, /return commitApprovalWrites\(targetPath, backlogId, `Expedite/);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^a failed commit fails loudly rather than leaving an uncommitted record$/, async (ctx) => {
    try {
      const loud = { ...ctx, diagnostics: [], answered: [], commits: [], notified: [] };
      loud.root = ctx.root;
      loud.ticketPath = ctx.ticketPath;
      // Re-arm the ticket so the second tap is a real transition again.
      fs.writeFileSync(ctx.ticketPath, `id: ${BACKLOG_ID}\ntitle: t\nhuman_approval: pending\n`);
      await core().pollAndForward(0, PRINCIPAL, adaptersFor(loud, callbackUpdate(), { commitResult: false }));
      assert.equal(loud.notified.length, 1, `a failed commit owes exactly one loud notice, got ${JSON.stringify(loud.notified)}`);
      assert.match(loud.notified[0].text, /FAILED TO COMMIT/);
      assert.match(loud.notified[0].text, new RegExp(BACKLOG_ID));
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the bot is restarted onto a fresh build$/, (ctx) => {
    assert.equal(ctx.supervisorResult.status, 'stale-build', 'a healthy child past the build grace must be moved onto the restart path');
    assert.equal(ctx.supervisorResult.event, 'build-stale', 'the restart is reported under its own event, distinct from a crash');
  });

  scoped(/^this does not require a crash to trigger$/, (ctx) => {
    // The bb run above passed (constantly true) for pid-alive? and false
    // for heartbeat-stale? - the child was healthy on every other axis, so
    // nothing but the build age can have produced the transition.
    assert.notEqual(ctx.supervisorResult.event, 'crashed');
    assert.notEqual(ctx.supervisorResult.event, 'stalled');
  });

  scoped(/^the diagnostic is present in a log file that was not lost with the process$/, (ctx) => {
    try {
      const logPath = botCli().frontDeskDiagnosticsLogPath(ctx.root);
      assert.ok(fs.existsSync(logPath), `the durable diagnostic log must exist at ${logPath}`);
      assert.ok(fs.readFileSync(logPath, 'utf8').includes(ctx.emittedLine), 'the emitted line must be readable after its writer exited');
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
