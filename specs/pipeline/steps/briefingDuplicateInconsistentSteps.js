'use strict';

// BL-406: root cause of "briefing sent 3-4x with inconsistent language and
// diagram attachments" was six leaked /tmp acceptance-sandbox handoffd.bb
// daemons, each independently running the real send path and each sending
// its own real email (fixed by handoffd.bb's front-door refuse-tmp-root
// guard - see test_handoffd_refuses_tmp_root.sh for that wiring proof, and
// test_daemon_alarm_lib.sh's BL-406 section for the pure predicate). Given
// that a leaked daemon can no longer run at all, what remains for THIS
// feature to lock in is the send path's own single-invocation guarantees -
// drives the real briefing_email_lib.bb through briefing_email_harness.bb
// (a fake send-email! adapter, no real network), same harness
// briefingEmailSteps.js (BL-214) already uses.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const FILE_NAME = '2026-07-15.md';
const HEADLINE = 'Headline: rapport du jour - swarm status';

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-duplicate-inconsistent-'));
  }
  return ctx.briefingsDir;
}

function writeBriefing(briefingsDir) {
  fs.writeFileSync(path.join(briefingsDir, FILE_NAME), `${HEADLINE}\n\nCorps du message.\n`);
}

function runHarness(briefingsDir, mode) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, mode], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  registry.define(/^the daily morning briefing send path$/, () => {
    // Non-behavioral Background: the send path (briefing_email_lib.bb) has
    // no dependency on a live daemon/tmux/VS Code host to fixture here -
    // the real end-to-end daemon wiring, including the BL-406 refuse-tmp-
    // root guard, is covered separately by
    // test_handoffd_refuses_tmp_root.sh and test_handoffd_briefing_email_wiring.sh.
  });

  // ── briefing-duplicate-inconsistent-01 ──────────────────────────────────
  registry.define(/^the briefing has already sent successfully today$/, (ctx) => {
    const briefingsDir = ensureBriefingsDir(ctx);
    writeBriefing(briefingsDir);
    fs.writeFileSync(path.join(briefingsDir, '.sent.json'), JSON.stringify({ sent: [FILE_NAME] }));
  });

  registry.define(/^the briefing send path is triggered again the same day$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), 'success');
  });

  registry.define(/^no additional briefing email is sent$/, (ctx) => {
    if (ctx.result.emailsSent !== 0 || ctx.result.sent.length !== 0) {
      throw new Error(`expected no additional send for an already-sent briefing, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── briefing-duplicate-inconsistent-02 / -03 share the same fixture and
  //    the same single harness invocation (diagram-available mode exercises
  //    both the text/html rendering AND the diagram/attachment decision in
  //    one composition, so both scenarios assert against one send) ────────
  registry.define(/^a single day's briefing send$/, (ctx) => {
    writeBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^the briefing is composed$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), 'diagram-available');
  });

  registry.define(/^the resolved language is the same for that day's send$/, (ctx) => {
    const { lastSentText, lastSentHtml } = ctx.result;
    if (!lastSentText || !lastSentText.includes(HEADLINE.replace(/^Headline: /, ''))) {
      throw new Error(`expected the plaintext send to carry the fixture's own headline text, got: ${JSON.stringify(lastSentText)}`);
    }
    // The html part must render the SAME resolved content, not an
    // independently re-resolved copy that could drift to a different
    // language - a single `content` value feeds both parts by construction
    // (send-unsent-briefings!), and this pins that down.
    if (!lastSentHtml || !lastSentHtml.includes('rapport du jour')) {
      throw new Error(`expected the html send to render the identical headline text as the plaintext send, got: ${JSON.stringify(lastSentHtml)}`);
    }
  });

  registry.define(/^the diagram-attachment decision is the same for that day's send$/, (ctx) => {
    const { lastSentHtml, lastSentAttachments } = ctx.result;
    const htmlHasDiagram = typeof lastSentHtml === 'string' && /cid:architecture-diagram/.test(lastSentHtml);
    const attachmentsHaveDiagram =
      Array.isArray(lastSentAttachments) && lastSentAttachments.some((a) => a['content-id'] === 'architecture-diagram');
    if (htmlHasDiagram !== attachmentsHaveDiagram) {
      throw new Error(
        `expected the html body's diagram reference and the attachment list to agree on whether a diagram was included, got html=${htmlHasDiagram} attachments=${attachmentsHaveDiagram} (${JSON.stringify(lastSentAttachments)})`
      );
    }
    if (!htmlHasDiagram || !attachmentsHaveDiagram) {
      throw new Error(`expected this fixture's diagram-available send to consistently include the diagram in both html and attachments, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
