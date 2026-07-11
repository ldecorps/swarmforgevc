'use strict';

// BL-260: step handlers for the morning-briefing-renders-diagrams-inline
// feature. The render step (mermaidRender.ts) is driven directly through
// its compiled module surface (in-process require, no subprocess, no real
// email send) - the compose/send step is driven through the real
// briefing_email_lib.bb via briefing_email_harness.bb's diagram-available/
// diagram-unavailable modes (BL-214's own harness pattern), never a live
// daemon, tmux session, or real Resend network call.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const FILE_NAME = '2026-07-09.md';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIXTURE_MMD_PATH = path.join(EXT_DIR, 'test', 'fixtures', 'sample-diagram.mmd');

function mermaidRenderModule() {
  // Requires the COMPILED module (matches gateAnswerSteps.js's own
  // in-process module-surface pattern) - proves out/ is actually built and
  // wired, not just the .ts source.
  return require(path.join(EXT_DIR, 'out', 'diagrams', 'mermaidRender'));
}

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-diagram-'));
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
  registry.define(/^the project's Mermaid architecture diagrams under docs\/diagrams\/$/, () => {
    const diagramsDir = path.join(__dirname, '..', '..', '..', 'docs', 'diagrams');
    for (const file of ['architecture.mmd', 'swarm-flow.mmd']) {
      if (!fs.existsSync(path.join(diagramsDir, file))) {
        throw new Error(`expected docs/diagrams/${file} to exist`);
      }
    }
  });

  // ── rendered-inline-01 ───────────────────────────────────────────────
  registry.define(/^the daily briefing is generated with rendering available$/, (ctx) => {
    ctx.diagramMode = 'diagram-available';
    writeBriefing(ensureBriefingsDir(ctx));
  });

  registry.define(/^the email body is composed$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  registry.define(/^it includes the architecture diagram rendered as an inline image$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/data:image\/png;base64,/.test(html)) {
      throw new Error(`expected the composed html body to embed an inline PNG image; got: ${html}`);
    }
    if (!/architecture/.test(html)) {
      throw new Error(`expected the composed html body to name the architecture diagram; got: ${html}`);
    }
  });

  // ── local-deterministic-02 ───────────────────────────────────────────
  registry.define(/^the same Mermaid source$/, (ctx) => {
    ctx.mmdSource = fs.readFileSync(FIXTURE_MMD_PATH, 'utf8');
  });

  registry.define(/^it is rendered twice$/, async (ctx) => {
    const { renderMermaidToPng } = mermaidRenderModule();
    ctx.renderedFirst = await renderMermaidToPng(ctx.mmdSource);
    ctx.renderedSecond = await renderMermaidToPng(ctx.mmdSource);
  });

  registry.define(/^it produces byte-identical image output$/, (ctx) => {
    if (!ctx.renderedFirst.equals(ctx.renderedSecond)) {
      throw new Error('expected rendering the same Mermaid source twice to produce byte-identical output');
    }
  });

  registry.define(/^the render runs locally without sending the diagram to an external service$/, () => {
    // Static contract check (same idiom as briefingEmailSteps.js's wiring
    // checks): the render module must carry no network-call API at all, so
    // a future change can't quietly add an external render service without
    // this failing.
    const src = fs.readFileSync(path.join(EXT_DIR, 'src', 'diagrams', 'mermaidRender.ts'), 'utf8');
    const networkApiPattern = /\bfetch\(|https?\.request\(|https?\.get\(|XMLHttpRequest/;
    if (networkApiPattern.test(src)) {
      throw new Error('expected mermaidRender.ts to contain no network-call API (render must stay local)');
    }
  });

  // ── plaintext-degradation-03 ─────────────────────────────────────────
  registry.define(/^the email is sent multipart with an HTML part and a plaintext part$/, (ctx) => {
    writeBriefing(ensureBriefingsDir(ctx));
    ctx.result = runHarness(ensureBriefingsDir(ctx), 'diagram-available');
    if (!ctx.result.lastSentHtml || !ctx.result.lastSentText) {
      throw new Error(`expected both an html part and a text part to be sent; got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^a plaintext-only client opens it$/, (ctx) => {
    // Framing only: a plaintext client can only ever see lastSentText - the
    // Then step below asserts against exactly that field, never lastSentHtml.
    ctx.viewingPlaintextOnly = true;
  });

  registry.define(/^it shows the briefing text with a link or note for the diagram$/, (ctx) => {
    const text = ctx.result.lastSentText || '';
    if (!/^Headline/.test(text)) {
      throw new Error(`expected the plaintext part to still carry the original briefing text; got: ${text}`);
    }
    if (!/docs\/diagrams/.test(text)) {
      throw new Error(`expected the plaintext part to carry a link or note pointing at the diagram source; got: ${text}`);
    }
  });

  // ── render-unavailable-degradation-04 ────────────────────────────────
  registry.define(/^the diagram renderer is unavailable$/, (ctx) => {
    ctx.diagramMode = 'diagram-unavailable';
  });

  registry.define(/^the briefing email is generated$/, (ctx) => {
    writeBriefing(ensureBriefingsDir(ctx));
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  registry.define(/^the email still sends with a clear no-diagram note rather than failing$/, (ctx) => {
    if (ctx.result.emailsSent !== 1 || !ctx.result.sent.includes(FILE_NAME)) {
      throw new Error(`expected the briefing to still send once despite the renderer being unavailable; got: ${JSON.stringify(ctx.result)}`);
    }
    if (ctx.result.lastSentHtml) {
      throw new Error(`expected no html body when rendering is unavailable; got: ${ctx.result.lastSentHtml}`);
    }
    if (!/unavailable/.test(ctx.result.lastSentText || '')) {
      throw new Error(`expected a clear no-diagram note in the sent text; got: ${ctx.result.lastSentText}`);
    }
  });

  // ── render-fixture-well-formed-05 ────────────────────────────────────
  registry.define(/^a fixture Mermaid source$/, (ctx) => {
    ctx.mmdSource = fs.readFileSync(FIXTURE_MMD_PATH, 'utf8');
  });

  registry.define(/^the render step runs$/, async (ctx) => {
    const { renderMermaidToPng } = mermaidRenderModule();
    ctx.renderedImage = await renderMermaidToPng(ctx.mmdSource);
  });

  registry.define(/^it yields a non-empty well-formed image$/, (ctx) => {
    if (!ctx.renderedImage || ctx.renderedImage.length === 0) {
      throw new Error('expected a non-empty rendered image');
    }
    if (!ctx.renderedImage.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new Error('expected the rendered image to be a well-formed PNG (correct magic header)');
    }
  });
}

module.exports = { registerSteps };
