'use strict';

// BL-286: step handlers for "briefing diagrams survive Gmail - sent as cid
// attachments, not data-URIs". Drives the REAL briefing_email_lib.bb through
// briefing_email_harness.bb's diagram-available/diagram-unavailable/success
// modes (BL-260's own harness, extended by BL-286 to also capture
// attachments) - no real render binary, no real email send, no live daemon.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const FILE_NAME = '2026-07-09.md';

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-cid-'));
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
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the briefing email renders architecture diagrams into its HTML part$/, () => {
    // Framing only - established by BL-260, the ticket this bug fixes.
  });

  // ── diagram-cid-01 ───────────────────────────────────────────────────
  registry.define(/^a briefing whose architecture diagrams are available$/, (ctx) => {
    ctx.diagramMode = 'diagram-available';
    writeBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^the briefing email HTML is built$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  registry.define(/^each diagram is referenced by a cid image source$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/cid:architecture-diagram/.test(html) || !/cid:swarm-flow-diagram/.test(html)) {
      throw new Error(`expected the html to reference each diagram by a cid image source; got: ${html}`);
    }
  });

  registry.define(/^the HTML contains no data-URI image source$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (/data:image/.test(html)) {
      throw new Error(`expected no data-URI image source in the html; got: ${html}`);
    }
  });

  // ── diagram-cid-02 ───────────────────────────────────────────────────
  registry.define(/^a briefing email that references its diagrams by cid$/, (ctx) => {
    ctx.diagramMode = 'diagram-available';
    writeBriefing(ensureBriefingsDir(ctx));
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  registry.define(/^the send payload is built$/, () => {
    // Framing only - the prior Given step already built the payload via the
    // harness, matching how briefingDiagramSteps.js's own "email body is
    // composed" step is sometimes folded into the Given for later scenarios.
  });

  registry.define(/^it carries one inline attachment per referenced diagram$/, (ctx) => {
    const attachments = ctx.result.lastSentAttachments || [];
    if (attachments.length !== 2) {
      throw new Error(`expected one attachment per referenced diagram (2); got: ${JSON.stringify(attachments)}`);
    }
  });

  registry.define(/^each attachment's content id matches the cid that references it$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    const attachments = ctx.result.lastSentAttachments || [];
    for (const attachment of attachments) {
      const cid = `cid:${attachment['content-id']}`;
      if (!html.includes(cid)) {
        throw new Error(`expected the html to reference attachment content-id via ${cid}; got: ${html}`);
      }
    }
  });

  // ── diagram-cid-03 ───────────────────────────────────────────────────
  registry.define(/^a briefing email whose diagrams are sent as inline attachments$/, (ctx) => {
    ctx.diagramMode = 'diagram-available';
    writeBriefing(ensureBriefingsDir(ctx));
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  registry.define(/^each attachment carries the diagram's image bytes and a filename$/, (ctx) => {
    const attachments = ctx.result.lastSentAttachments || [];
    const expected = [
      { filename: 'architecture-diagram.png', base64: 'ZmFrZS1wbmctYnl0ZXM=' },
      { filename: 'swarm-flow-diagram.png', base64: 'ZmFrZS1zd2FybS1mbG93' },
    ];
    for (const want of expected) {
      const got = attachments.find((a) => a.filename === want.filename);
      if (!got) {
        throw new Error(`expected an attachment with filename ${want.filename}; got: ${JSON.stringify(attachments)}`);
      }
      if (got.base64 !== want.base64) {
        throw new Error(`expected attachment ${want.filename} to carry the diagram's image bytes; got: ${JSON.stringify(got)}`);
      }
    }
  });

  // ── diagram-cid-04 ───────────────────────────────────────────────────
  registry.define(/^a briefing run where no diagrams are available$/, (ctx) => {
    ctx.diagramMode = 'diagram-unavailable';
    writeBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^the briefing email is sent$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  registry.define(/^the email sends with the unavailable-diagrams plaintext note$/, (ctx) => {
    if (ctx.result.emailsSent !== 1 || !ctx.result.sent.includes(FILE_NAME)) {
      throw new Error(`expected the briefing to still send once; got: ${JSON.stringify(ctx.result)}`);
    }
    if (!/unavailable/.test(ctx.result.lastSentText || '')) {
      throw new Error(`expected the unavailable-diagrams plaintext note; got: ${ctx.result.lastSentText}`);
    }
  });

  registry.define(/^its send payload carries no attachments$/, (ctx) => {
    const attachments = ctx.result.lastSentAttachments;
    if (attachments && attachments.length > 0) {
      throw new Error(`expected no attachments in the send payload; got: ${JSON.stringify(attachments)}`);
    }
  });

  // ── diagram-cid-05 ───────────────────────────────────────────────────
  registry.define(/^a briefing send that has no diagram section at all$/, (ctx) => {
    ctx.diagramMode = 'success';
    writeBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^the send payload has neither an attachments field nor an html field$/, (ctx) => {
    if (Object.prototype.hasOwnProperty.call(ctx.result, 'lastSentHtml') && ctx.result.lastSentHtml != null) {
      throw new Error(`expected no html field in the send payload; got: ${JSON.stringify(ctx.result)}`);
    }
    if (Object.prototype.hasOwnProperty.call(ctx.result, 'lastSentAttachments') && ctx.result.lastSentAttachments != null) {
      throw new Error(`expected no attachments field in the send payload; got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
