'use strict';

// BL-393: step handlers for "the briefing email buries its observables -
// render the markdown body to HTML for the email". Drives the real
// briefing_email_lib.bb through briefing_email_harness.bb (BL-214's own
// harness, extended by BL-286 to capture html/attachments) - no real
// render binary, no real email send, no live daemon. Each scenario writes
// its own fixture content directly (no adapters), since the raw file
// content already exercises the same render-markdown-to-html(content) code
// path the optional-section adapters feed in production.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const FILE_NAME = '2026-07-09.md';

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-body-html-'));
  }
  return ctx.briefingsDir;
}

function writeBriefing(briefingsDir, content) {
  fs.writeFileSync(path.join(briefingsDir, FILE_NAME), content);
}

function runHarness(briefingsDir, mode) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, mode], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a committed daily briefing sent by the headless daemon$/, () => {
    // Framing only - established by BL-214, the send path this ticket
    // changes the html part of.
  });

  // ── shared across every scenario ────────────────────────────────────
  registry.define(/^the briefing email payload is built$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode || 'success');
  });

  // Shared by body-html-01 and body-html-05.
  registry.define(/^the payload carries an HTML part rendered from the briefing body$/, (ctx) => {
    if (!ctx.result.lastSentHtml) {
      throw new Error(`expected an HTML part rendered from the briefing body; got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── body-html-01 ─────────────────────────────────────────────────────
  registry.define(/^a briefing whose body is markdown$/, (ctx) => {
    ctx.briefingContent = '# Title\n\nSome **bold** text.\n';
    writeBriefing(ensureBriefingsDir(ctx), ctx.briefingContent);
  });

  registry.define(/^the payload still carries the original markdown as its plain-text part$/, (ctx) => {
    if (ctx.result.lastSentText !== ctx.briefingContent) {
      throw new Error(
        `expected the plain-text part to still carry the original markdown unchanged; got: ${JSON.stringify(ctx.result.lastSentText)}`
      );
    }
  });

  // ── body-html-02 ─────────────────────────────────────────────────────
  registry.define(/^a briefing body containing headings, a metrics table, and bold text$/, (ctx) => {
    ctx.briefingContent = [
      '## Delivery metrics',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| Velocity | 34 |',
      '',
      'Suite duration is **healthy**.',
      '',
    ].join('\n');
    writeBriefing(ensureBriefingsDir(ctx), ctx.briefingContent);
  });

  registry.define(/^the HTML part's headings render as HTML heading elements$/, (ctx) => {
    if (!/<h[1-6]>Delivery metrics<\/h[1-6]>/.test(ctx.result.lastSentHtml || '')) {
      throw new Error(`expected the heading to render as an HTML heading element; got: ${ctx.result.lastSentHtml}`);
    }
  });

  registry.define(/^the HTML part's table renders as HTML table markup$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/<table>/.test(html) || !/<th>Metric<\/th>/.test(html) || !/<td>Velocity<\/td>/.test(html)) {
      throw new Error(`expected the table to render as HTML table markup; got: ${html}`);
    }
  });

  registry.define(/^the HTML part's bold text renders as HTML emphasis$/, (ctx) => {
    if (!/<strong>healthy<\/strong>/.test(ctx.result.lastSentHtml || '')) {
      throw new Error(`expected bold text to render as HTML emphasis; got: ${ctx.result.lastSentHtml}`);
    }
  });

  // ── body-html-03 ─────────────────────────────────────────────────────
  registry.define(/^a briefing whose content has appended computed sections$/, (ctx) => {
    ctx.briefingContent = ['Lede paragraph.', '', '## Appended section', '', 'Detail line here.', ''].join('\n');
    writeBriefing(ensureBriefingsDir(ctx), ctx.briefingContent);
  });

  registry.define(/^the HTML part includes those appended sections, not only the lede$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/Lede paragraph/.test(html)) {
      throw new Error(`expected the lede to be present in the html; got: ${html}`);
    }
    if (!/Appended section/.test(html) || !/Detail line here/.test(html)) {
      throw new Error(`expected the appended section to also be present in the html, not only the lede; got: ${html}`);
    }
  });

  // ── body-html-04 ─────────────────────────────────────────────────────
  registry.define(/^a briefing run whose architecture diagrams are available$/, (ctx) => {
    ctx.diagramMode = 'diagram-available';
    ctx.briefingContent = 'Headline body.\n';
    writeBriefing(ensureBriefingsDir(ctx), ctx.briefingContent);
  });

  registry.define(/^the HTML part contains both the rendered briefing body and the diagram images$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/Headline body/.test(html)) {
      throw new Error(`expected the html to contain the rendered briefing body; got: ${html}`);
    }
    if (!/cid:architecture-diagram/.test(html)) {
      throw new Error(`expected the html to also contain the diagram image reference; got: ${html}`);
    }
  });

  registry.define(/^neither replaces the other$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/Headline body/.test(html) || !/cid:/.test(html)) {
      throw new Error(`expected both the rendered body and the diagram images to coexist in the html; got: ${html}`);
    }
  });

  // ── body-html-05 ─────────────────────────────────────────────────────
  // "a briefing run where no diagrams are available" is already registered
  // by briefingDiagramCidAttachmentsSteps.js (diagram-cid-04) - identical
  // wording, same setup (diagramMode 'diagram-unavailable' + a fixture
  // briefing), reused rather than re-registered.
}

module.exports = { registerSteps };
