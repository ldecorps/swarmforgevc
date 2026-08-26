'use strict';

// BL-902: step handlers for "briefing email decides sendability before
// composing". Drives the real briefing_email_lib.bb (+ daemon_alarm_lib.bb's
// shared warn-missing-key-if-needed!) through briefing_email_harness.bb's
// sendability-gate mode - a fake send-email!/log! adapter and one tracking
// fn per gather/render adapter (no real network, no real shell-out, no live
// daemon; the real end-to-end daemon wiring/cadence is covered separately
// by test_handoffd_briefing_email_wiring.sh).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const FILE_NAME = '2026-08-16.md';

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-sendability-gate-'));
  }
  return ctx.briefingsDir;
}

function writeUnsentBriefing(briefingsDir) {
  fs.writeFileSync(path.join(briefingsDir, FILE_NAME), 'Headline: BL-902 acceptance fixture\n\nBody.\n');
}

function runGate(briefingsDir, reason, runs) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, 'sendability-gate', reason, String(runs)], { encoding: 'utf8' });
  return JSON.parse(out);
}

const REASON_BY_PHRASE = {
  'the API key is missing': 'missing-api-key',
  'email is disabled in conf': 'disabled',
};

function reasonForPhrase(phrase) {
  const reason = REASON_BY_PHRASE[phrase];
  if (!reason) {
    throw new Error(`unknown reason phrase: "${phrase}"`);
  }
  return reason;
}

function registerSteps(registry) {
  registry.define(/^a briefings directory containing one unsent briefing$/, (ctx) => {
    writeUnsentBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^every optional section adapter records whether it was invoked$/, () => {
    // Non-behavioral: sendability-gate mode always wires a tracking fn for
    // every optional gather/render adapter send-unsent-briefings! knows
    // about - see briefing_email_harness.bb's tracking-adapters map.
  });

  // Matches both the literal Given text (scenarios 01/03/04) and every
  // Scenario Outline Examples row for <reason> (scenario 02) - runtime.js's
  // substitute() replaces <reason> with the row's literal phrase BEFORE
  // this pattern ever sees the step text, so one capturing regex covers
  // both shapes; no separate "<reason>"-literal handler is needed (or
  // reachable - the placeholder text itself is never what gets matched).
  registry.define(/^email delivery is unavailable because (.+)$/, (ctx, phrase) => {
    ctx.reason = reasonForPhrase(phrase);
  });

  registry.define(/^email delivery is available$/, (ctx) => {
    ctx.reason = 'sendable';
  });

  registry.define(/^the backlog is large enough that gathering would be expensive$/, () => {
    // Non-behavioral marker: the claim under test is that gathering NEVER
    // starts for an undeliverable sweep, so no adapter output size can
    // matter - there is deliberately nothing to fixture here (a large fake
    // adapter payload would only prove the SAME zero-invocation assertion
    // scenario 01 already covers, never something a real gather could
    // still get away with).
  });

  registry.define(/^the briefing email sweep runs$/, (ctx) => {
    ctx.result = runGate(ensureBriefingsDir(ctx), ctx.reason, 1);
  });

  registry.define(/^the briefing email sweep runs a second time$/, (ctx) => {
    ctx.result = runGate(ctx.briefingsDir, ctx.reason, 1);
  });

  registry.define(/^the briefing email sweep runs three times$/, (ctx) => {
    ctx.result = runGate(ensureBriefingsDir(ctx), ctx.reason, 3);
  });

  registry.define(/^no section adapter is invoked$/, (ctx) => {
    if (ctx.result.sectionCallsTotal !== 0) {
      throw new Error(`expected zero section adapter invocations, got: ${JSON.stringify(ctx.result.sectionCallCounts)}`);
    }
  });

  registry.define(/^every section adapter is invoked$/, (ctx) => {
    // 13 = every optional gather/render adapter tracking-adapters wires
    // (:read-briefing-content + the 11 optional-section-adapter-keys +
    // :diagram-section) - see briefing_email_lib.bb's own
    // optional-section-adapter-keys for the canonical count.
    if (ctx.result.sectionCallsTotal !== 13) {
      throw new Error(`expected every one of the 13 tracked section adapters invoked exactly once, got: ${JSON.stringify(ctx.result.sectionCallCounts)}`);
    }
  });

  registry.define(/^the sweep performs no shell-out$/, (ctx) => {
    // The shell-outs this ticket is about (suite-duration-line etc. in
    // handoffd.bb) live INSIDE each optional adapter fn, never in the
    // library - an adapter fn that was never called performed no shell-out
    // by construction, so this is the same zero-invocation assertion as
    // "no section adapter is invoked" above, from the shell-out angle.
    if (ctx.result.sectionCallsTotal !== 0) {
      throw new Error(`expected no shell-out (zero section adapter invocations), got: ${JSON.stringify(ctx.result.sectionCallCounts)}`);
    }
  });

  registry.define(/^the sweep logs that the briefing was skipped for a missing key$/, (ctx) => {
    if (!ctx.result.logs.some((l) => l[0] === 'briefing-skip-missing-key' && l[1] === FILE_NAME)) {
      throw new Error(`expected a briefing-skip-missing-key log line for ${FILE_NAME}, got: ${JSON.stringify(ctx.result.logs)}`);
    }
  });

  registry.define(/^the briefing is not marked as sent$/, (ctx) => {
    if (ctx.result.sent.length !== 0) {
      throw new Error(`expected nothing marked sent, got: ${JSON.stringify(ctx.result.sent)}`);
    }
    const sentMarkerPath = path.join(ctx.briefingsDir, '.sent.json');
    if (fs.existsSync(sentMarkerPath)) {
      throw new Error(`expected no .sent.json marker file, found one: ${fs.readFileSync(sentMarkerPath, 'utf8')}`);
    }
  });

  registry.define(/^the briefing is still offered to the second sweep$/, (ctx) => {
    // The harness's 2nd run already re-scanned briefingsDir for unsent
    // files (find-unsent-briefings) and, per the prior step, found nothing
    // marked sent - so the 2nd sweep's own result already IS the proof:
    // it had the same file available to re-attempt.
    if (ctx.result.logs.filter((l) => l[0] === 'briefing-skip-missing-key' && l[1] === FILE_NAME).length < 1) {
      throw new Error(`expected the 2nd sweep to have re-attempted and re-skipped ${FILE_NAME}, got: ${JSON.stringify(ctx.result.logs)}`);
    }
  });

  registry.define(/^the misconfiguration warning is logged exactly once$/, (ctx) => {
    const warnings = ctx.result.logs.filter((l) => l[0] === 'email-misconfigured');
    if (warnings.length !== 1) {
      throw new Error(`expected exactly one email-misconfigured warning across repeated sweeps, got ${warnings.length}: ${JSON.stringify(ctx.result.logs)}`);
    }
  });

  registry.define(/^the briefing is marked as sent exactly once$/, (ctx) => {
    if (ctx.result.sent.length !== 1 || ctx.result.sent[0] !== FILE_NAME || ctx.result.emailsSent !== 1) {
      throw new Error(`expected the briefing marked/sent exactly once, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
