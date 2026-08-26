'use strict';

// BL-451: step handlers for "The PWA recert view and the redundant BL-339
// recert notify are retired once recert lives in Telegram" - the RETIRE
// half of the full move to Telegram (BL-450 is the build half).
//
// Scenario 01 drives the real pwa/index.html + pwa/app.js in jsdom (via
// render-pwa-recert-retired.js, mirroring the now-retired
// render-recert-mailto.js's own pattern) - proves the recert view and its
// verbs are gone from the real rendered document, not merely absent from a
// reimplementation of it.
//
// Scenario 02 proves the retirement by reading the real SOURCE (no live
// Telegram/network round trip to drive): the notify CLI BL-339 shipped no
// longer exists, and handoffd.bb no longer shells out to it - the same
// "grep the real output/source" posture recertNotifySteps.js's own
// recert-notify-deep-link-07 step already uses for a different absence
// claim (confirmScenario never called from Telegram).
//
// Scenario 03 reuses BL-450's own real conciergeTick-driven posting steps
// ("scenarios need recertification" / "the recert posting runs") via the
// fixture helpers bl450RecertStandingTopicSteps.js exports, so this proves
// the SAME real wiring BL-450's own scenarios exercise, never a second
// simulation of it. Scoped (registry.defineScoped) throughout because
// "scenarios need recertification" and "the recert posting runs" text is
// already registered unscoped by bl450RecertStandingTopicSteps.js for its
// own (compatible) ctx shape - reused here, not shadowed.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RENDER_SCRIPT = path.join(REPO_ROOT, 'extension', 'scripts', 'render-pwa-recert-retired.js');
const NOTIFY_CLI_SOURCE = path.join(REPO_ROOT, 'extension', 'src', 'tools', 'notify-recert-batch.ts');
const HANDOFFD_SOURCE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

const { initRecertTopicFixture, seedScenariosNeedingRecertification, RECERT_TOPIC_ID } = require('./bl450RecertStandingTopicSteps');

const FEATURE_NAME = 'The PWA recert view and the redundant BL-339 recert notify are retired once recert lives in Telegram';

function registerSteps(registry) {
  // ── retire-pwa-recert-01 / retire-pwa-recert-03 (shared Given) ────────
  // Builds the SAME ctx shape "the recert posting runs" (bl450, unscoped)
  // expects, so scenario 03 below can reuse it unchanged. Harmless for
  // scenario 01, which never reads ctx.targetPath/ctx.adapters.
  registry.defineScoped(
    /^scenarios need recertification$/,
    (ctx) => {
      initRecertTopicFixture(ctx);
      seedScenariosNeedingRecertification(ctx);
    },
    FEATURE_NAME
  );

  // ── retire-pwa-recert-01 ────────────────────────────────────────────
  registry.defineScoped(
    /^the phone PWA is loaded$/,
    (ctx) => {
      const out = execFileSync('node', [RENDER_SCRIPT], { encoding: 'utf8' });
      ctx.pwaRender = JSON.parse(out);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the PWA does not render a recert view$/,
    (ctx) => {
      if (ctx.pwaRender.recertSectionPresent) {
        throw new Error(`expected no recertSection element in the rendered PWA, got: ${JSON.stringify(ctx.pwaRender)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the PWA offers no confirm, update, or delete recert control$/,
    (ctx) => {
      if (ctx.pwaRender.recertContentPresent || ctx.pwaRender.recertControlsPresent) {
        throw new Error(`expected no recert confirm/update/delete controls anywhere in the rendered PWA, got: ${JSON.stringify(ctx.pwaRender)}`);
      }
    },
    FEATURE_NAME
  );

  // ── retire-pwa-recert-02 ────────────────────────────────────────────
  // "Given a recert batch is waiting on the human" is narrative only here:
  // this scenario's real proof is source-grepping below (no live
  // batch/fixture is read by either step). recertNotifySteps.js (BL-339),
  // which used to register this text with a real git-backed fixture, was
  // removed once the BL-339 feature was retired to a tombstone (2026-07-17)
  // - its fixture was never load-bearing for THIS scenario, only for
  // BL-339's own now-deleted scenarios.
  registry.defineScoped(/^a recert batch is waiting on the human$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^the recert notify sweep runs$/,
    (ctx) => {
      ctx.notifyCliExists = fs.existsSync(NOTIFY_CLI_SOURCE);
      const handoffdSource = fs.readFileSync(HANDOFFD_SOURCE, 'utf8');
      ctx.handoffdStillShellsToNotifyCli = /notify-recert-batch\.js/.test(handoffdSource);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no recert-batch-waiting deep-link message is sent to Telegram$/,
    (ctx) => {
      if (ctx.notifyCliExists) {
        throw new Error('expected the BL-339 notify-recert-batch CLI source to be retired, but it still exists');
      }
      if (ctx.handoffdStillShellsToNotifyCli) {
        throw new Error('expected handoffd.bb to no longer shell out to the retired notify-recert-batch CLI');
      }
    },
    FEATURE_NAME
  );

  // ── retire-pwa-recert-03 ────────────────────────────────────────────
  // "the recert posting runs" is reused unscoped from
  // bl450RecertStandingTopicSteps.js - the SAME real conciergeTick wiring
  // BL-450's own scenarios drive, against the ctx this feature's own
  // scoped "scenarios need recertification" Given built above.
  registry.defineScoped(
    /^a scenario is presented for recertification in the Recert Telegram topic$/,
    (ctx) => {
      if (!ctx.posted.some((m) => m.topicId === RECERT_TOPIC_ID)) {
        throw new Error(`expected a scenario posted into the Recert Telegram topic, got: ${JSON.stringify(ctx.posted)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
