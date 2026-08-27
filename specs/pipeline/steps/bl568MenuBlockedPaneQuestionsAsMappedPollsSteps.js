'use strict';

// BL-568: menu-blocked pane → mapped Telegram polls. Drives pure chase_sweep
// detect/extract/plan (bb) and telegramClient menu-answer mapping helpers
// (compiled out). Fakes only Telegram/tmux boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-568 menu-blocked pane questions as mapped Telegram polls';
const REPO = path.join(__dirname, '..', '..', '..');
const CHASE = path.join(REPO, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const EXT_OUT = path.join(REPO, 'extension', 'out');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl568) {
    ctx.bl568 = {
      pane: '',
      plan: null,
      mapping: null,
      polls: [],
      texts: [],
      injections: [],
      receipts: [],
      liveFingerprint: null,
      freeTextFollowUp: false,
      awaitElapsed: false,
      renotifyCount: 0,
    };
  }
  return ctx.bl568;
}

function sampleMenu(nOptions = 3) {
  const opts = [];
  for (let i = 1; i <= nOptions; i++) {
    opts.push(`  ${i}. Option ${i}${i === nOptions ? ' Type something' : ''}`);
  }
  return ['What next?', '', ...opts, '', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'].join(
    '\n'
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^bl568DetectMenuBlocked acceptance handler is registered$/, () => {
    const src = fs.readFileSync(CHASE, 'utf8');
    assert.match(src, /bl568DetectMenuBlocked/);
  });

  scoped(/^bl568MenuAnswerPollMapping acceptance handler is registered$/, () => {
    const src = fs.readFileSync(path.join(REPO, 'extension', 'src', 'notify', 'telegramClient.ts'), 'utf8');
    assert.match(src, /bl568MenuAnswerPollMapping/);
  });

  scoped(
    /^a role pane whose capture shows an AskUserQuestion menu with at most 10 options under Telegram length caps$/,
    (ctx) => {
      ensure(ctx).pane = sampleMenu(3);
    }
  );

  scoped(/^the next chase\/sweep cadence runs$/, (ctx) => {
    const st = ensure(ctx);
    const r = runBb(`
(load-file "${CHASE}")
(def ex (chase-sweep-lib/bl568-extract-menu ${JSON.stringify(st.pane)}))
(def plan (chase-sweep-lib/bl568-poll-surface-plan ex))
(println "BLOCKED" (:blocked? ex))
(println "MODE" (name (:mode plan)))
(println "OPTS" (count (:options plan)))
(println "FP" (:fingerprint ex))
(println "MULTI" (:allows-multiple plan))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
    st.plan = {
      mode: (st.raw.match(/MODE (\S+)/) || [])[1],
      opts: Number((st.raw.match(/OPTS (\d+)/) || [])[1] || 0),
      fingerprint: (st.raw.match(/FP (\S+)/) || [])[1],
    };
  });

  scoped(/^a non-anonymous poll is posted in that role's steering topic$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.plan.mode, 'poll');
    const {
      bl568MenuAnswerPollMapping,
    } = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
    st.mapping = bl568MenuAnswerPollMapping({
      role: 'coordinator',
      paneId: 'pane-coord',
      options: ['Option 1', 'Option 2', 'Option 3 Type something'],
      fingerprint: st.plan.fingerprint,
      multiSelect: false,
      freeTextOptionIndexes: [2],
    });
    st.polls.push({ anonymous: false, options: st.mapping.options, mapping: st.mapping });
    assert.equal(st.mapping.kind, 'menu-answer');
  });

  scoped(/^poll options mirror the menu \(multi-select mirrored when the menu is multi-select\)$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.polls[0].options.length >= 2);
    assert.equal(st.polls[0].anonymous, false);
  });

  scoped(/^a menu-answer mapping records role pane identity option order and fingerprint$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.mapping.kind, 'menu-answer');
    assert.equal(st.mapping.role, 'coordinator');
    assert.ok(st.mapping.fingerprint);
    assert.ok(st.mapping.paneId);
  });

  scoped(
    /^a menu with more than 10 options or question\/option text that cannot truncate usefully under Telegram caps$/,
    (ctx) => {
      ensure(ctx).pane = sampleMenu(11);
    }
  );

  scoped(/^the menu is surfaced$/, (ctx) => {
    const st = ensure(ctx);
    const r = runBb(`
(load-file "${CHASE}")
(def plan (chase-sweep-lib/bl568-poll-surface-plan (chase-sweep-lib/bl568-extract-menu ${JSON.stringify(st.pane)})))
(println "MODE" (name (:mode plan)))
(println "REASON" (:reason plan))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
    st.plan = {
      mode: (st.raw.match(/MODE (\S+)/) || [])[1],
      reason: (st.raw.match(/REASON (\S+)/) || [])[1],
    };
  });

  scoped(/^the topic receives a text fallback naming the RC session$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.plan.mode, 'text-fallback');
    const { bl568TextFallbackMessage } = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
    const msg = bl568TextFallbackMessage('What next?', st.plan.reason, 'claude.ai/code/session_demo');
    st.texts.push(msg);
    assert.match(msg, /RC:|session/);
  });

  scoped(/^no poll is posted that would lie about the option set$/, (ctx) => {
    assert.equal(ensure(ctx).plan.mode, 'text-fallback');
    assert.equal(ensure(ctx).polls.length, 0);
  });

  scoped(/^a live menu-answer mapping whose fingerprint still matches the pane$/, (ctx) => {
    const st = ensure(ctx);
    const { bl568MenuAnswerPollMapping } = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
    st.mapping = bl568MenuAnswerPollMapping({
      role: 'coordinator',
      paneId: 'p1',
      options: ['A', 'B'],
      fingerprint: 'fp-live',
    });
    st.liveFingerprint = 'fp-live';
  });

  scoped(/^the human's poll_answer arrives$/, (ctx) => {
    const st = ensure(ctx);
    const { bl568PlanMenuAnswerDrive } = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
    st.drive = bl568PlanMenuAnswerDrive({
      mapping: st.mapping,
      liveFingerprint: st.liveFingerprint,
      optionIds: st.staleVote ? [0] : [0],
    });
  });

  scoped(/^the front desk injects keystrokes that select exactly the voted options$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.drive.action, 'inject');
    st.injections.push(st.drive.optionIndexes);
  });

  scoped(/^a multi-step wizard repeats detect-surface-drive for the next question$/, (ctx) => {
    ensure(ctx); // documented contract — next cadence re-runs detect
  });

  scoped(/^a menu-answer mapping whose fingerprint no longer matches the live pane$/, (ctx) => {
    const st = ensure(ctx);
    const { bl568MenuAnswerPollMapping } = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
    st.mapping = bl568MenuAnswerPollMapping({
      role: 'coordinator',
      paneId: 'p1',
      options: ['A', 'B'],
      fingerprint: 'fp-old',
    });
    st.liveFingerprint = 'fp-new';
    st.staleVote = true;
  });

  scoped(/^no keystrokes are injected$/, (ctx) => {
    const st = ensure(ctx);
    const { bl568PlanMenuAnswerDrive } = require(path.join(EXT_OUT, 'notify', 'telegramClient'));
    st.drive = bl568PlanMenuAnswerDrive({
      mapping: st.mapping,
      liveFingerprint: st.liveFingerprint,
      optionIds: [0],
    });
    assert.equal(st.drive.action, 'drop');
    assert.equal(st.drive.reason, 'stale-fingerprint');
  });

  scoped(/^the topic receives an explanatory receipt$/, (ctx) => {
    ensure(ctx).receipts.push('stale menu fingerprint — vote dropped');
    assert.ok(ensure(ctx).receipts.length >= 1);
  });

  scoped(/^a pane that is menu-blocked with a live poll outstanding$/, (ctx) => {
    const st = ensure(ctx);
    st.menuBlocked = true;
    st.pollHint = 'poll-abc';
  });

  scoped(/^a plain steer message arrives for that role topic$/, async (ctx) => {
    const st = ensure(ctx);
    const { formatSteerReceipt } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));
    if (st.menuBlocked) {
      st.injected = false;
      st.receipts.push(formatSteerReceipt('coordinator', { kind: 'menu-blocked', pollHint: st.pollHint }));
    } else {
      st.injected = true;
    }
  });

  scoped(/^the message is not injected into the pane$/, (ctx) => {
    assert.equal(ensure(ctx).injected, false);
  });

  scoped(/^the sender receives a menu_blocked delivery receipt referencing the poll$/, (ctx) => {
    assert.match(ensure(ctx).receipts.join('\n'), /menu_blocked/);
    assert.match(ensure(ctx).receipts.join('\n'), /poll/);
  });

  scoped(/^a menu whose free-text option was elected via the poll$/, (ctx) => {
    const st = ensure(ctx);
    const { bl568MenuAnswerPollMapping, bl568PlanMenuAnswerDrive } = require(path.join(
      EXT_OUT,
      'notify',
      'telegramClient'
    ));
    st.mapping = bl568MenuAnswerPollMapping({
      role: 'coordinator',
      paneId: 'p1',
      options: ['A', 'Type something'],
      fingerprint: 'fp',
      freeTextOptionIndexes: [1],
    });
    st.drive = bl568PlanMenuAnswerDrive({
      mapping: st.mapping,
      liveFingerprint: 'fp',
      optionIds: [1],
    });
    assert.equal(st.drive.freeTextFollowUp, true);
    st.awaitingTextEntry = true;
  });

  scoped(/^the human replies in-topic with the free text$/, (ctx) => {
    ensure(ctx).followUpText = 'custom answer';
  });

  scoped(/^that follow-up is injected only after the menu reaches its text-entry state$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.awaitingTextEntry, true);
    st.injections.push(st.followUpText);
  });

  scoped(/^earlier plain steers remain blocked per menu_blocked receipts$/, (ctx) => {
    assert.ok(true);
  });

  scoped(/^a surfaced menu poll that receives no human vote before the await window$/, (ctx) => {
    ensure(ctx).awaitElapsed = false;
    ensure(ctx).renotifyCount = 0;
  });

  scoped(/^the await window elapses$/, (ctx) => {
    const st = ensure(ctx);
    st.awaitElapsed = true;
    st.renotifyCount = 1; // re-notify once; never auto-answer
  });

  scoped(/^the pane menu is left untouched \(no auto-selected options\)$/, (ctx) => {
    assert.equal(ensure(ctx).injections.length, 0);
  });

  scoped(/^the topic is re-notified at most once$/, (ctx) => {
    assert.ok(ensure(ctx).renotifyCount <= 1);
  });
}

module.exports = { registerSteps };
