'use strict';

// BL-215: step handlers for the configured-but-keyless daemon warning
// feature. Drives the real daemon_alarm_lib.bb send-alarm-email!/
// warn-missing-key-if-needed! through email_missing_key_warn_harness.bb -
// fake post/log adapters (no real network, no real timers), never a live
// daemon - matching the ticket's own non-behavioral gate.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HARNESS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'email_missing_key_warn_harness.bb');

function runHarness(to, apiKey, repeatCount) {
  const out = execFileSync('bb', [HARNESS, to, apiKey || '', String(repeatCount || 1)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  registry.define(/^notify_email_to is configured$/, (ctx) => {
    ctx.to = 'ops@example.com';
  });

  registry.define(/^notify_email_to is configured and RESEND_API_KEY is absent$/, (ctx) => {
    ctx.to = 'ops@example.com';
    ctx.apiKey = '';
  });

  registry.define(/^RESEND_API_KEY is absent from the daemon's environment$/, (ctx) => {
    ctx.apiKey = '';
  });

  registry.define(/^notify_email_to is not configured$/, (ctx) => {
    ctx.to = '';
  });

  registry.define(/^notify_email_to and RESEND_API_KEY are both set$/, (ctx) => {
    ctx.to = 'ops@example.com';
    ctx.apiKey = 'fake-key';
  });

  registry.define(/^the daemon tries to send an alarm or briefing email$/, (ctx) => {
    ctx.result = runHarness(ctx.to, ctx.apiKey, 1);
  });

  registry.define(/^the daemon sends an alarm or briefing email$/, (ctx) => {
    ctx.result = runHarness(ctx.to, ctx.apiKey, 1);
  });

  registry.define(/^the daemon's send path runs many times$/, (ctx) => {
    ctx.result = runHarness(ctx.to, ctx.apiKey, 5);
  });

  registry.define(/^the send returns a distinct "missing key" result$/, (ctx) => {
    if (ctx.result.reason !== 'missing-api-key') {
      throw new Error(`expected reason "missing-api-key", got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the daemon logs a visible warning naming RESEND_API_KEY$/, (ctx) => {
    if (!ctx.result.warnings.some((w) => w.includes('RESEND_API_KEY'))) {
      throw new Error(`expected a warning naming RESEND_API_KEY, got: ${JSON.stringify(ctx.result.warnings)}`);
    }
  });

  registry.define(/^no email is sent$/, (ctx) => {
    if (ctx.result.emailsSent !== 0) {
      throw new Error(`expected no email sent, got emailsSent=${ctx.result.emailsSent}`);
    }
  });

  registry.define(/^no missing-key warning is logged$/, (ctx) => {
    if (ctx.result.warnings.length !== 0) {
      throw new Error(`expected no missing-key warning, got: ${JSON.stringify(ctx.result.warnings)}`);
    }
  });

  registry.define(/^the email is posted$/, (ctx) => {
    if (ctx.result.emailsSent !== 1) {
      throw new Error(`expected exactly one email posted, got emailsSent=${ctx.result.emailsSent}`);
    }
  });

  registry.define(/^the missing-key warning is logged at most once per dedup window$/, (ctx) => {
    if (ctx.result.warnings.length !== 1) {
      throw new Error(`expected exactly one deduped warning across repeated attempts, got: ${JSON.stringify(ctx.result.warnings)}`);
    }
  });
}

module.exports = { registerSteps };
