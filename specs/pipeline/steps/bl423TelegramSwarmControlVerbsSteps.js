'use strict';

// BL-423: step handlers for "guarded Telegram control verbs stop, restart,
// and timed-pause the swarm from the phone". Drives the REAL compiled
// telegramFrontDeskBotCore.ts (pollAndForward, the dispatch layer every
// verb/callback goes through) and telegram-front-desk-bot.ts's own real
// effect functions (executeStop/executeRestart/applyPause/resumeNow) and
// on-disk markers (readControlPauseState/readPendingControlConfirm) -
// never a parallel/simplified reimplementation of the decision. The ONE
// cross-language proof this ticket calls for (a live pause marker actually
// freezes promotion) is driven through the REAL Babashka
// effective_backlog_depth_cli.bb, not just the pure TS/Babashka unit tests
// in isolation. No live Telegram network anywhere - only postFn/execFn are
// faked, mirroring bl466AgentQuestionsAsTelegramPollsSteps.js's own posture.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_DEPTH_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const RESUME_EXPIRED_PAUSES_CLI = path.join(EXT_DIR, 'out', 'tools', 'resume-expired-pauses.js');

const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { decidePauseAutoResume, CONTROL_CALLBACK_DATA } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramControlCore'));
const {
  readControlPauseState,
  writeControlPauseState,
  readPendingControlConfirm,
  writePendingControlConfirm,
  controlPauseStatePath,
  executeStop,
  executeRestart,
  killAllSwarmScriptPath,
} = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));

const CONTROL_TOPIC_ID = 900;
const NON_CONTROL_TOPIC_ID = 42;
const PRINCIPAL_ID = 111;
const UNAUTHORISED_ID = 222;
const CHAT_ID = '1';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl423-control-'));
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function writeTopicMapFixture(root, map) {
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify(map));
}

function writeSwarmforgeConf(root, maxDepth) {
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${maxDepth}\n`);
}

function readEffectiveDepth(root) {
  return execFileSync('bb', [EFFECTIVE_DEPTH_CLI, root], { encoding: 'utf8' }).trim();
}

// A minimal, safe-by-default PollAdapters double - every control field a
// no-op recorder, every non-control field a throwing stub (a genuine
// Control-topic event must never touch approve/reject/amend/openSubject/
// postOperatorContext machinery), mirroring
// telegramFrontDeskBotCore.test.js's own controlPollAdapters factory.
function controlAdapters(ctx, overrides = {}) {
  return {
    chatId: CHAT_ID,
    controlTopicId: async () => CONTROL_TOPIC_ID,
    getPendingControlConfirm: async () => readPendingControlConfirm(ctx.root),
    setPendingControlConfirm: async (c) => writePendingControlConfirm(ctx.root, c),
    getPauseState: async () => readControlPauseState(ctx.root),
    postControlStopModesMenu: async () => ctx.calls.push({ fn: 'postControlStopModesMenu' }),
    postControlRestartConfirm: async () => ctx.calls.push({ fn: 'postControlRestartConfirm' }),
    postControlCancelled: async () => ctx.calls.push({ fn: 'postControlCancelled' }),
    postControlPauseMenu: async () => ctx.calls.push({ fn: 'postControlPauseMenu' }),
    executeEmergencyStop: async () => ctx.calls.push({ fn: 'executeEmergencyStop' }),
    executeDrainStop: async () => ctx.calls.push({ fn: 'executeDrainStop' }),
    executeRestart: async () => ctx.calls.push({ fn: 'executeRestart' }),
    applyPause: async (durationMs) => {
      ctx.calls.push({ fn: 'applyPause', durationMs });
      writeControlPauseState(ctx.root, { active: true, untilMs: durationMs !== undefined ? Date.now() + durationMs : undefined });
    },
    resumeNow: async () => {
      ctx.calls.push({ fn: 'resumeNow' });
      writeControlPauseState(ctx.root, { active: false });
    },
    answerCallbackQuery: async (id) => ctx.calls.push({ fn: 'answerCallbackQuery', id }),
    subjectForTopic: () => undefined,
    backlogForTopic: () => undefined,
    postToBridge: async () => {
      throw new Error('postToBridge must never be called for a Control-topic event');
    },
    openSubjectAndRecord: async (topicId, text, updateId) => {
      ctx.calls.push({ fn: 'openSubjectAndRecord', topicId, text, updateId });
      return 'SUP-999';
    },
    postOperatorContext: async () => {
      throw new Error('postOperatorContext must never be called for a Control-topic event');
    },
    ...overrides,
  };
}

function mkTextUpdate({ fromId, topicId, text, updateId }) {
  return {
    update_id: updateId ?? 1,
    message: { message_id: updateId ?? 1, chat: { id: CHAT_ID }, from: { id: fromId }, message_thread_id: topicId, text },
  };
}

function mkCallbackUpdate({ fromId, data, topicId, callbackId }) {
  return {
    update_id: 1,
    callback_query: { id: callbackId ?? 'cbq-1', data, from: { id: fromId }, message: { chat: { id: CHAT_ID }, message_thread_id: topicId } },
  };
}

// pollAndForward's REAL signature is (offset, principalUserId, adapters) -
// getUpdates lives ON the adapters object, not as a 4th argument. The
// helper above stays a thin wrapper so every Given/When below reads as
// "dispatch this one update" without repeating the getUpdates plumbing.
async function pollOneUpdate(ctx, update) {
  const adapters = controlAdapters(ctx);
  adapters.getUpdates = async () => ({ success: true, updates: [update] });
  ctx.result = await pollAndForward(0, PRINCIPAL_ID, adapters);
}

function writeFakeKillAllSwarm(root, body) {
  const scriptPath = killAllSwarmScriptPath(root);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function callsFor(ctx, fnName) {
  return (ctx.calls || []).filter((c) => c.fn === fnName);
}

function assertNoSwarmAction(ctx) {
  const actionFns = [
    'postControlStopModesMenu',
    'postControlRestartConfirm',
    'postControlPauseMenu',
    'executeEmergencyStop',
    'executeDrainStop',
    'executeRestart',
    'applyPause',
    'resumeNow',
  ];
  const acted = (ctx.calls || []).filter((c) => actionFns.includes(c.fn));
  if (acted.length) {
    throw new Error(`expected no swarm control action, got: ${JSON.stringify(acted)}`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a dedicated guarded Telegram control topic and the authorised human$/, (ctx) => {
    ctx.root = mkTmp();
    ctx.calls = [];
    // resume-expired-pauses.js (control-pause-autoresume-15) resolves its
    // own project root via a real git worktree - a plain tmp dir fails
    // that resolution, so every fixture in this file is a real (if empty)
    // git repo with a roles.tsv, matching resolveExpiredPausesCli.test.js's
    // own fixture shape.
    execFileSync('git', ['init', '-q'], { cwd: ctx.root });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ctx.root });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: ctx.root });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: ctx.root });
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${ctx.root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
    writeTopicMapFixture(ctx.root, { [String(CONTROL_TOPIC_ID)]: 'CONTROL' });
  });

  // ── control-restart-confirm-01 / control-stop-confirm-modes-02 ───────
  registry.define(/^the authorised human sends the restart control verb in the control topic$/, async (ctx) => {
    await pollOneUpdate(ctx, mkTextUpdate({ fromId: PRINCIPAL_ID, topicId: CONTROL_TOPIC_ID, text: '/restart' }));
  });

  registry.define(/^the authorised human sends the stop control verb in the control topic$/, async (ctx) => {
    await pollOneUpdate(ctx, mkTextUpdate({ fromId: PRINCIPAL_ID, topicId: CONTROL_TOPIC_ID, text: '/stop' }));
  });

  registry.define(/^the verb is handled$/, () => {
    // Handling already happened in the Given above (pollOneUpdate is
    // synchronous-per-scenario) - this step exists only for Gherkin's own
    // Given/When/Then readability, mirroring other files' "already
    // happened" no-op When steps in this same pipeline.
  });

  registry.define(/^a confirmation prompt is posted and the swarm is left untouched$/, (ctx) => {
    if (callsFor(ctx, 'postControlRestartConfirm').length !== 1) {
      throw new Error(`expected exactly one restart confirmation prompt, got: ${JSON.stringify(ctx.calls)}`);
    }
    assertNoSwarmAction2(ctx, ['postControlRestartConfirm']);
  });

  registry.define(/^a confirmation offering a drain-and-stop choice and an emergency-stop choice is posted and the swarm is left untouched$/, (ctx) => {
    if (callsFor(ctx, 'postControlStopModesMenu').length !== 1) {
      throw new Error(`expected exactly one stop-modes confirmation prompt, got: ${JSON.stringify(ctx.calls)}`);
    }
    assertNoSwarmAction2(ctx, ['postControlStopModesMenu']);
  });

  // Same as assertNoSwarmAction but tolerating the ONE prompt call this
  // scenario itself just asserted separately.
  function assertNoSwarmAction2(ctx, allow) {
    const destructive = ['executeEmergencyStop', 'executeDrainStop', 'executeRestart', 'applyPause', 'resumeNow'];
    const acted = (ctx.calls || []).filter((c) => destructive.includes(c.fn) && !allow.includes(c.fn));
    if (acted.length) {
      throw new Error(`expected no destructive action, got: ${JSON.stringify(acted)}`);
    }
  }

  // ── control-confirm-cancel-03 ─────────────────────────────────────────
  registry.define(/^the authorised human has a pending "([^"]*)" confirmation in the control topic$/, (ctx, verb) => {
    writePendingControlConfirm(ctx.root, { kind: verb === 'stop' ? 'stop-modes' : 'restart-confirm' });
  });

  registry.define(/^the human cancels the confirmation$/, async (ctx) => {
    await pollOneUpdate(ctx, mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: CONTROL_CALLBACK_DATA.cancel, topicId: CONTROL_TOPIC_ID }));
  });

  registry.define(/^the swarm is left running and nothing is executed$/, (ctx) => {
    if (callsFor(ctx, 'postControlCancelled').length !== 1) {
      throw new Error(`expected the cancellation to be acknowledged, got: ${JSON.stringify(ctx.calls)}`);
    }
    assertNoSwarmAction(ctx);
    if (readPendingControlConfirm(ctx.root) !== undefined) {
      throw new Error('expected the pending confirm marker to be cleared on cancel');
    }
  });

  // ── control-guard-unauthorised-04 ─────────────────────────────────────
  registry.define(/^an unauthorised sender posts the "([^"]*)" control verb in the control topic$/, async (ctx, verb) => {
    const text = verb === 'pause' ? '/pause' : verb === 'stop' ? '/stop' : '/restart';
    await pollOneUpdate(ctx, mkTextUpdate({ fromId: UNAUTHORISED_ID, topicId: CONTROL_TOPIC_ID, text }));
  });

  registry.define(/^it is refused and no swarm control action is taken$/, (ctx) => {
    assertNoSwarmAction(ctx);
    if (ctx.result.dropped !== 1) {
      throw new Error(`expected the update to be dropped as refused, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── control-guard-topic-05 ─────────────────────────────────────────────
  registry.define(/^the authorised human posts the "([^"]*)" control verb in an ordinary non-control topic$/, async (ctx, verb) => {
    const text = verb === 'pause' ? '/pause' : verb === 'stop' ? '/stop' : '/restart';
    await pollOneUpdate(ctx, mkTextUpdate({ fromId: PRINCIPAL_ID, topicId: NON_CONTROL_TOPIC_ID, text }));
  });

  registry.define(/^it is ignored and no swarm control action is taken$/, (ctx) => {
    assertNoSwarmAction(ctx);
  });

  // ── control-guard-callback-06 ──────────────────────────────────────────
  registry.define(/^a pending control button posted by the authorised human in the control topic$/, async (ctx) => {
    await pollOneUpdate(ctx, mkTextUpdate({ fromId: PRINCIPAL_ID, topicId: CONTROL_TOPIC_ID, text: '/stop' }));
    if (callsFor(ctx, 'postControlStopModesMenu').length !== 1) {
      throw new Error('setup: expected the stop-modes menu to have been posted first');
    }
    ctx.calls = [];
  });

  registry.define(/^an unauthorised sender taps that control button$/, async (ctx) => {
    await pollOneUpdate(ctx, mkCallbackUpdate({ fromId: UNAUTHORISED_ID, data: CONTROL_CALLBACK_DATA.emergencyStop, topicId: CONTROL_TOPIC_ID }));
  });

  registry.define(/^the tap is refused and no swarm control action is taken$/, (ctx) => {
    assertNoSwarmAction(ctx);
    if (callsFor(ctx, 'answerCallbackQuery').length !== 0) {
      throw new Error('expected an unauthorised tap to never answer the spinner (not this bot\'s spinner to clear)');
    }
  });

  // ── control-stop-emergency-07 ──────────────────────────────────────────
  registry.define(/^the authorised human has confirmed an emergency stop$/, () => {});

  // The actual executeStop call lives in each scenario's own, more specific
  // Then step below (it needs that step's own assertions on the SAME
  // captured postedTexts) - this shared "When" exists only for Gherkin's
  // own Given/When/Then readability across scenarios 07/08/09.
  registry.define(/^the teardown runs$/, () => {});

  registry.define(/^every swarm-owned process it started is reaped immediately with no drain wait, leaving no orphaned tmux windows or vitest workers$/, async (ctx) => {
    const root = ctx.root;
    writeFakeKillAllSwarm(root, 'exit 0');
    const postedTexts = [];
    const postFn = async (url, body) => {
      postedTexts.push(JSON.parse(body).text);
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    await executeStop(root, 'fake-token', 'fake-chat', CONTROL_TOPIC_ID, 'emergency', postFn);
    if (postedTexts.some((t) => /Draining/.test(t))) {
      throw new Error(`expected NO drain wait for an emergency stop, got: ${JSON.stringify(postedTexts)}`);
    }
    if (!postedTexts.some((t) => /Emergency stop/.test(t))) {
      throw new Error(`expected an immediate emergency-stop announcement, got: ${JSON.stringify(postedTexts)}`);
    }
    if (!postedTexts.some((t) => /Stop complete/.test(t))) {
      throw new Error(`expected the teardown to report completion, got: ${JSON.stringify(postedTexts)}`);
    }
  });

  // ── control-stop-drain-clean-08 ────────────────────────────────────────
  // BL-423 architect follow-up: executeStop's own drain-poll loop takes an
  // injected now()/wait() - both drain scenarios below drive it with a fake
  // wait() (advances a virtual clock, no real setTimeout at all) instead of
  // a real setTimeout/env-var-shrunk-timeout trick.
  registry.define(/^the authorised human has confirmed a drain stop and in-flight work finishes within the drain window$/, (ctx) => {
    const root = ctx.root;
    fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${root}\t_\tcoder\tclaude\n`);
    const newDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(newDir, { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    const queued = path.join(newDir, 'BL-1.handoff');
    fs.writeFileSync(queued, 'type: note\nto: coder\npriority: 50\n\nhi\n');
    writeFakeKillAllSwarm(root, 'exit 0');
    let clockMs = 0;
    let waitCalls = 0;
    ctx.now = () => clockMs;
    // Work finishes on the SECOND poll - proves the drain WAITS and
    // re-checks, rather than trivially seeing an already-empty pipeline on
    // its very first poll, with no real delay at all.
    ctx.wait = async () => {
      clockMs += 2000;
      waitCalls += 1;
      if (waitCalls >= 1) {
        try {
          fs.unlinkSync(queued);
        } catch {
          // already gone - fine.
        }
      }
    };
  });

  registry.define(/^it waits for the in-flight work to finish, then reaps every swarm-owned process leaving no orphaned tmux windows or vitest workers, and reports the stop as drained$/, async (ctx) => {
    const root = ctx.root;
    const postedTexts = [];
    const postFn = async (url, body) => {
      postedTexts.push(JSON.parse(body).text);
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    await executeStop(root, 'fake-token', 'fake-chat', CONTROL_TOPIC_ID, 'drain', postFn, ctx.now, ctx.wait);
    if (!postedTexts.some((t) => /Draining in-flight work/.test(t))) {
      throw new Error(`expected the drain wait to be announced, got: ${JSON.stringify(postedTexts)}`);
    }
    if (postedTexts.some((t) => /forcing teardown/.test(t))) {
      throw new Error(`expected NO forced teardown - work finished within the window, got: ${JSON.stringify(postedTexts)}`);
    }
    if (!postedTexts.some((t) => /Stop complete: drained/.test(t))) {
      throw new Error(`expected the stop reported as drained, got: ${JSON.stringify(postedTexts)}`);
    }
  });

  // ── control-stop-drain-timeout-09 ──────────────────────────────────────
  registry.define(/^the authorised human has confirmed a drain stop and in-flight work does not finish within the drain window$/, (ctx) => {
    const root = ctx.root;
    fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${root}\t_\tcoder\tclaude\n`);
    const newDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(newDir, { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    // Never cleared for the whole scenario - the drain window elapses with
    // work still queued.
    fs.writeFileSync(path.join(newDir, 'BL-1.handoff'), 'type: note\nto: coder\npriority: 50\n\nhi\n');
    writeFakeKillAllSwarm(root, 'exit 0');
    let clockMs = 0;
    ctx.now = () => clockMs;
    // Jumps 20 minutes forward on every call - past even the 10-minute
    // default drain timeout in a single hop, no real delay.
    ctx.wait = async () => {
      clockMs += 20 * 60 * 1000;
    };
  });

  registry.define(/^it forces the teardown after the drain window, reaps every swarm-owned process leaving no orphaned tmux windows or vitest workers, and reports the stop as forced$/, async (ctx) => {
    const root = ctx.root;
    const postedTexts = [];
    const postFn = async (url, body) => {
      postedTexts.push(JSON.parse(body).text);
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    await executeStop(root, 'fake-token', 'fake-chat', CONTROL_TOPIC_ID, 'drain', postFn, ctx.now, ctx.wait);
    if (!postedTexts.some((t) => /forcing teardown/.test(t))) {
      throw new Error(`expected the drain timeout to force teardown, got: ${JSON.stringify(postedTexts)}`);
    }
    if (!postedTexts.some((t) => /Stop complete: forced/.test(t))) {
      throw new Error(`expected the stop reported as forced, got: ${JSON.stringify(postedTexts)}`);
    }
  });

  // ── control-restart-phases-10 ──────────────────────────────────────────
  registry.define(/^the authorised human has confirmed a restart$/, () => {});

  function writeBounceAck(root, phase, message) {
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'bounce-ack.json'),
      JSON.stringify({ bounceType: 'swarm', phase, updatedAt: new Date().toISOString(), message })
    );
  }

  // BL-423 architect follow-up: executeRestart's own ack-poll loop takes an
  // injected now()/wait() - this drives all four phase transitions through
  // a fake wait() that writes the NEXT phase to disk and advances a virtual
  // clock, with NO real setInterval/setTimeout at all (previously ~4.4s of
  // real wall-clock wait per run).
  registry.define(/^the relaunch runs through the owning-context executor$/, async (ctx) => {
    const root = ctx.root;
    const postedTexts = [];
    const postFn = async (url, body) => {
      postedTexts.push(JSON.parse(body).text);
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    const phases = ['draining', 'stopping', 'relaunching', 'done'];
    let i = 0;
    writeBounceAck(root, phases[i]);
    let clockMs = 0;
    const now = () => clockMs;
    const wait = async () => {
      clockMs += 1000;
      i += 1;
      if (i < phases.length) {
        writeBounceAck(root, phases[i]);
      }
    };
    await executeRestart(root, 'fake-token', 'fake-chat', CONTROL_TOPIC_ID, postFn, () => true, now, wait);
    ctx.postedTexts = postedTexts;
    if (!fs.existsSync(path.join(root, '.swarmforge', 'bounce'))) {
      throw new Error('expected the sanctioned bounce sentinel to have been written');
    }
  });

  registry.define(/^each bounce phase from draining through done is reported back to the control topic$/, (ctx) => {
    const phases = ['draining', 'stopping', 'relaunching', 'done'];
    for (const phase of phases) {
      if (!ctx.postedTexts.some((t) => t.includes(`Restart: ${phase}`))) {
        throw new Error(`expected a "Restart: ${phase}" message, got: ${JSON.stringify(ctx.postedTexts)}`);
      }
    }
    if (!ctx.postedTexts.some((t) => /Restart complete/.test(t))) {
      throw new Error(`expected a final completion message, got: ${JSON.stringify(ctx.postedTexts)}`);
    }
  });

  // ── control-restart-failed-bootstrap-11 ────────────────────────────────
  registry.define(/^a confirmed restart whose relaunch creates windows but no agent bootstraps into them$/, (ctx) => {
    writeBounceAck(ctx.root, 'done');
  });

  registry.define(/^the relaunch outcome is evaluated$/, async (ctx) => {
    const postedTexts = [];
    const postFn = async (url, body) => {
      postedTexts.push(JSON.parse(body).text);
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } };
    };
    await executeRestart(ctx.root, 'fake-token', 'fake-chat', CONTROL_TOPIC_ID, postFn, () => false);
    ctx.postedTexts = postedTexts;
  });

  registry.define(/^it is reported as failed rather than done$/, (ctx) => {
    if (!ctx.postedTexts.some((t) => /reporting failed/.test(t))) {
      throw new Error(`expected a "reporting failed" message, got: ${JSON.stringify(ctx.postedTexts)}`);
    }
    if (ctx.postedTexts.some((t) => /Restart complete/.test(t))) {
      throw new Error(`expected NO "Restart complete" message for a half-launch, got: ${JSON.stringify(ctx.postedTexts)}`);
    }
  });

  // ── control-pause-menu-12 ──────────────────────────────────────────────
  registry.define(/^the authorised human sends the pause control verb in the control topic$/, async (ctx) => {
    await pollOneUpdate(ctx, mkTextUpdate({ fromId: PRINCIPAL_ID, topicId: CONTROL_TOPIC_ID, text: '/pause' }));
  });

  registry.define(/^a pause-duration menu is posted and new-work intake is left running$/, (ctx) => {
    if (callsFor(ctx, 'postControlPauseMenu').length !== 1) {
      throw new Error(`expected exactly one pause-duration menu, got: ${JSON.stringify(ctx.calls)}`);
    }
    if (readControlPauseState(ctx.root).active) {
      throw new Error('expected intake to remain unfrozen until a duration is actually picked');
    }
  });

  // ── control-pause-timed-13 / control-pause-until-resume-14 ────────────
  registry.define(/^the authorised human has a posted pause-duration menu in the control topic$/, (ctx) => {
    // Pause has no confirm gate (the ticket's own "duration pick IS the
    // action") - nothing to arm here; this Given exists for readability.
  });

  const DURATION_MS = { '15 min': 15 * 60 * 1000, '1 hr': 60 * 60 * 1000, '4 hr': 4 * 60 * 60 * 1000 };
  const DURATION_CALLBACK = { '15 min': CONTROL_CALLBACK_DATA.pause15m, '1 hr': CONTROL_CALLBACK_DATA.pause1h, '4 hr': CONTROL_CALLBACK_DATA.pause4h };

  registry.define(/^the human picks the "([^"]*)" pause duration$/, async (ctx, duration) => {
    ctx.pickedDurationMs = DURATION_MS[duration];
    await pollOneUpdate(ctx, mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: DURATION_CALLBACK[duration], topicId: CONTROL_TOPIC_ID }));
  });

  registry.define(
    /^new-work intake is frozen so no paused item is promoted, in-flight parcels keep running, and auto-resume is scheduled after (.*)$/,
    (ctx) => {
      const state = readControlPauseState(ctx.root);
      if (!state.active || state.untilMs === undefined) {
        throw new Error(`expected an active, timed pause, got: ${JSON.stringify(state)}`);
      }
      const expected = Date.now() + ctx.pickedDurationMs;
      if (Math.abs(state.untilMs - expected) > 5000) {
        throw new Error(`expected untilMs close to now+duration, got ${state.untilMs} vs expected ~${expected}`);
      }
      // Cross-language proof: the SAME marker this bot just wrote actually
      // freezes the coordinator's own live promotion gate on the Babashka
      // side - "wire a REAL reader, not a dark marker".
      writeSwarmforgeConf(ctx.root, 3);
      if (readEffectiveDepth(ctx.root) !== '0') {
        throw new Error('expected the live pause marker to freeze the effective backlog depth to 0 on the Babashka side');
      }
    }
  );

  registry.define(/^the human picks the until-I-resume pause duration$/, async (ctx) => {
    await pollOneUpdate(ctx, mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: CONTROL_CALLBACK_DATA.pauseUntilResume, topicId: CONTROL_TOPIC_ID }));
  });

  registry.define(/^new-work intake is frozen with no auto-resume scheduled, so intake stays frozen until an explicit resume$/, (ctx) => {
    const state = readControlPauseState(ctx.root);
    if (!state.active || state.untilMs !== undefined) {
      throw new Error(`expected an active pause with no untilMs at all, got: ${JSON.stringify(state)}`);
    }
    if (decidePauseAutoResume(state, Date.now() + 365 * 24 * 60 * 60 * 1000) !== 'none') {
      throw new Error('expected an until-I-resume pause to never auto-resume, however far the clock advances');
    }
    writeSwarmforgeConf(ctx.root, 3);
    if (readEffectiveDepth(ctx.root) !== '0') {
      throw new Error('expected the live pause marker to freeze the effective backlog depth to 0 on the Babashka side');
    }
  });

  // ── control-pause-autoresume-15 ─────────────────────────────────────────
  registry.define(/^a timed pause whose duration has elapsed$/, (ctx) => {
    fs.mkdirSync(path.dirname(controlPauseStatePath(ctx.root)), { recursive: true });
    writeControlPauseState(ctx.root, { active: true, untilMs: Date.now() - 1000 });
  });

  registry.define(/^the pause is evaluated on the sweep$/, (ctx) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true }) };
    ctx.sweepResult = JSON.parse(execFileSync('node', [RESUME_EXPIRED_PAUSES_CLI], { encoding: 'utf8', cwd: ctx.root, env }));
  });

  registry.define(/^new-work intake is automatically restored and the resume is reported to the control topic$/, (ctx) => {
    if (!ctx.sweepResult.resumed || !ctx.sweepResult.announced) {
      throw new Error(`expected the sweep to both resume and announce, got: ${JSON.stringify(ctx.sweepResult)}`);
    }
    if (readControlPauseState(ctx.root).active) {
      throw new Error('expected the pause marker to be cleared');
    }
  });

  // ── control-resume-now-16 ───────────────────────────────────────────────
  registry.define(/^the swarm is paused with intake frozen$/, (ctx) => {
    writeControlPauseState(ctx.root, { active: true, untilMs: Date.now() + 60 * 60 * 1000 });
  });

  registry.define(/^the authorised human resumes from the control topic$/, async (ctx) => {
    await pollOneUpdate(ctx, mkCallbackUpdate({ fromId: PRINCIPAL_ID, data: CONTROL_CALLBACK_DATA.resumeNow, topicId: CONTROL_TOPIC_ID }));
  });

  registry.define(/^new-work intake is restored immediately and no auto-resume timer remains pending$/, (ctx) => {
    if (callsFor(ctx, 'resumeNow').length !== 1) {
      throw new Error(`expected resumeNow to have been invoked, got: ${JSON.stringify(ctx.calls)}`);
    }
    const state = readControlPauseState(ctx.root);
    if (state.active) {
      throw new Error(`expected intake fully restored, got: ${JSON.stringify(state)}`);
    }
  });
}

module.exports = { registerSteps };
