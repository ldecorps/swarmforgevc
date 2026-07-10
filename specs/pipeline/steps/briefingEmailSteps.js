'use strict';

// BL-214: step handlers for the headless-daemon-emails-the-briefing
// feature. Drives the real briefing_email_lib.bb through
// briefing_email_harness.bb - a fake send-email! adapter (no real
// network), never a live daemon or tmux session (the real end-to-end
// daemon wiring is covered separately by
// swarmforge/scripts/test/test_handoffd_briefing_email_wiring.sh).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const HANDOFFD = path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb');
const DAEMON_ALARM_LIB = path.join(SWARMFORGE_SCRIPTS, 'daemon_alarm_lib.bb');
const FILE_NAME = '2026-07-09.md';

function definedFunctionBody(src, defnName, maxChars) {
  const after = src.split(`(defn ${defnName}`)[1];
  if (!after) {
    return null;
  }
  return after.slice(0, maxChars);
}

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-email-'));
  }
  return ctx.briefingsDir;
}

function writeBriefing(briefingsDir) {
  fs.writeFileSync(path.join(briefingsDir, FILE_NAME), 'Headline: shipped a thing\n\nBody.\n');
}

function runHarness(briefingsDir, mode) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, mode], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── brief-01 ─────────────────────────────────────────────────────────
  registry.define(/^the daemon is running with no VS Code host open$/, () => {
    // Non-behavioral: the daemon path (handoffd.bb/briefing_email_lib.bb)
    // has no dependency on vscode at all - nothing to fixture.
  });

  registry.define(/^a new docs\/briefings\/<date>\.md has just been committed$/, (ctx) => {
    writeBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^the daemon's briefing watch runs$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.mode || 'success');
  });

  registry.define(/^it sends that briefing once via send-alarm-email!$/, (ctx) => {
    if (ctx.result.emailsSent !== 1 || !ctx.result.sent.includes(FILE_NAME)) {
      throw new Error(`expected the briefing sent exactly once, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the send uses the daemon's configured to\/from and RESEND_API_KEY$/, () => {
    // Wiring-contract guard (real bb read, same pattern as
    // dispatchGapSteps.js's cadence check) - checks WHERE the behavior
    // actually lives now, not a literal inline pattern: the cleaner
    // extracted daemon_alarm_lib.bb's shared send-configured-email! (BL-215
    // + BL-214 both read conf/env through it, one Resend client, one
    // missing-key-warning path), so handoffd.bb's own briefing wrapper is
    // asserted only to DELEGATE to it, and the actual to/from/RESEND_API_KEY
    // reading is asserted against send-configured-email! itself. The real
    // end-to-end read is exercised for real (no mocks) by
    // test_handoffd_briefing_email_wiring.sh.
    const handoffdSrc = fs.readFileSync(HANDOFFD, 'utf8');
    const briefingWrapperBody = definedFunctionBody(handoffdSrc, 'send-configured-briefing-email!', 400);
    if (!briefingWrapperBody) {
      throw new Error('expected handoffd.bb to define send-configured-briefing-email!');
    }
    if (!/daemon-alarm-lib\/send-configured-email!/.test(briefingWrapperBody)) {
      throw new Error(
        `expected send-configured-briefing-email! to delegate to daemon_alarm_lib.bb's shared send-configured-email! (no second Resend client); got: ${briefingWrapperBody}`
      );
    }
    if (!/conf-file/.test(briefingWrapperBody)) {
      throw new Error(`expected send-configured-briefing-email! to pass the daemon's conf-file through; got: ${briefingWrapperBody}`);
    }

    const alarmLibSrc = fs.readFileSync(DAEMON_ALARM_LIB, 'utf8');
    const sharedBody = definedFunctionBody(alarmLibSrc, 'send-configured-email!', 800);
    if (!sharedBody) {
      throw new Error('expected daemon_alarm_lib.bb to define the shared send-configured-email!');
    }
    if (!/notify_email_to/.test(sharedBody) || !/notify_email_from/.test(sharedBody)) {
      throw new Error(`expected send-configured-email! to read notify_email_to/notify_email_from from conf; got: ${sharedBody}`);
    }
    if (!/System\/getenv "RESEND_API_KEY"/.test(sharedBody)) {
      throw new Error(`expected send-configured-email! to read RESEND_API_KEY from the daemon's own env; got: ${sharedBody}`);
    }
    if (!/send-alarm-email!/.test(sharedBody)) {
      throw new Error(`expected send-configured-email! to reuse send-alarm-email! for the actual POST; got: ${sharedBody}`);
    }
  });

  // ── brief-02 ─────────────────────────────────────────────────────────
  registry.define(/^a briefing that was already emailed and marked sent$/, (ctx) => {
    const briefingsDir = ensureBriefingsDir(ctx);
    writeBriefing(briefingsDir);
    fs.writeFileSync(path.join(briefingsDir, '.sent.json'), JSON.stringify({ sent: [FILE_NAME] }));
  });

  registry.define(/^the daemon restarts and the briefing watch runs again$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), 'success');
  });

  registry.define(/^no second email is sent for that briefing$/, (ctx) => {
    if (ctx.result.emailsSent !== 0 || ctx.result.sent.length !== 0) {
      throw new Error(`expected no second send for an already-sent briefing, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── brief-03 ─────────────────────────────────────────────────────────
  registry.define(/^notify_email_to or RESEND_API_KEY is absent$/, (ctx) => {
    ctx.mode = 'missing-api-key';
  });

  registry.define(/^the daemon's briefing watch finds a new briefing$/, (ctx) => {
    writeBriefing(ensureBriefingsDir(ctx));
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.mode);
  });

  registry.define(/^it logs the skip and sends nothing$/, (ctx) => {
    if (ctx.result.emailsSent !== 0) {
      throw new Error(`expected no email sent when unconfigured, got emailsSent=${ctx.result.emailsSent}`);
    }
    if (!ctx.result.logs.some((l) => l[0] === 'briefing-skip-missing-key' || l[0] === 'briefing-skip-disabled')) {
      throw new Error(`expected a logged skip, got: ${JSON.stringify(ctx.result.logs)}`);
    }
  });

  registry.define(/^the daemon does not crash$/, (ctx) => {
    // runHarness above already threw (execFileSync) had it crashed - a
    // successful ctx.result parse IS the proof.
    if (!ctx.result) {
      throw new Error('expected the harness to have run and produced a result without throwing');
    }
  });

  // ── brief-04 ─────────────────────────────────────────────────────────
  registry.define(/^the daemon owns briefing email delivery$/, () => {
    // Non-behavioral: asserted below by the retirement check itself.
  });

  registry.define(/^the VS Code host is also open$/, () => {
    // No fixture: this scenario is a static wiring-contract check, not a
    // live-host simulation - see the Then step.
  });

  registry.define(/^the host does not also email the briefing$/, () => {
    const retiredModule = path.join(__dirname, '..', '..', '..', 'extension', 'src', 'notify', 'briefingEmailWatcher.ts');
    if (fs.existsSync(retiredModule)) {
      throw new Error('expected briefingEmailWatcher.ts to be retired (BL-214 moved delivery to the daemon)');
    }
    const extensionSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'extension', 'src', 'extension.ts'),
      'utf8'
    );
    if (/startBriefingEmailWatcher|sendUnsentBriefings/.test(extensionSrc)) {
      throw new Error('expected extension.ts to no longer wire up the retired host-side briefing email send');
    }
  });
}

module.exports = { registerSteps };
