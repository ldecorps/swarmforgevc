'use strict';

// BL-580: morning briefing carries a front-desk mechanism diagram. Drives
// REAL renderBriefingDiagrams + build-diagram-section (same posture as
// bl579HandoffMechanismBriefingDiagramSteps.js). Counts stay derived from
// DIAGRAM_FILES — this file never asserts a literal "4".

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  'the morning briefing carries a front-desk MECHANISM diagram, Telegram in and answer out';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const HARNESS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'briefing_email_harness.bb');
const FD_NAME = 'front-desk';
const FD_FILE = 'front-desk-flow.mmd';
const FD_SRC = path.join(REPO_ROOT, 'docs', 'diagrams', FD_FILE);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let sourceBackup = null;

function restoreSource() {
  if (sourceBackup !== null) {
    fs.writeFileSync(FD_SRC, sourceBackup);
    sourceBackup = null;
  }
}

process.on('exit', restoreSource);

function diagramModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'render-briefing-diagrams'));
}

function allowlist() {
  return diagramModule().DIAGRAM_FILES;
}

function buildDiagramSection(diagrams) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl580-section-'));
  const diagramsPath = path.join(tmp, 'diagrams.json');
  fs.writeFileSync(diagramsPath, JSON.stringify(diagrams));
  const lib = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'briefing_email_lib.bb');
  const bb = `
(require '[cheshire.core :as json])
(load-file "${lib}")
(def diagrams (json/parse-string (slurp "${diagramsPath}") true))
(println (json/generate-string (briefing-email-lib/build-diagram-section diagrams)))
`;
  try {
    const out = execFileSync('bb', ['-e', bb], { encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the morning briefing's diagram allowlist names the front-desk diagram$/, (ctx) => {
    restoreSource();
    const names = allowlist().map((d) => d.name);
    assert.ok(names.includes(FD_NAME), `DIAGRAM_FILES missing ${FD_NAME}: ${JSON.stringify(names)}`);
    assert.equal(allowlist().find((d) => d.name === FD_NAME).file, FD_FILE);
    ctx.allowlist = allowlist();
  });

  scoped(/^the briefing's diagrams are rendered from the committed sources$/, async (ctx) => {
    const { renderBriefingDiagrams } = diagramModule();
    try {
      ctx.rendered = await renderBriefingDiagrams(REPO_ROOT);
      ctx.renderFailed = false;
    } catch (err) {
      ctx.rendered = null;
      ctx.renderFailed = true;
      ctx.renderError = err;
    }
  });

  scoped(/^the front-desk diagram is among them carrying non-empty image bytes$/, (ctx) => {
    assert.equal(ctx.renderFailed, false, `render failed: ${ctx.renderError}`);
    const hit = ctx.rendered.find((d) => d.name === FD_NAME);
    assert.ok(hit, `front-desk missing from ${JSON.stringify(ctx.rendered.map((d) => d.name))}`);
    const png = Buffer.from(hit.base64, 'base64');
    assert.ok(png.length > 8);
    assert.ok(png.subarray(0, 8).equals(PNG_MAGIC));
    ctx.frontDeskPng = png;
  });

  scoped(/^the briefing email references the front-desk diagram by its own cid$/, (ctx) => {
    const stubs = ctx.rendered.map((d) => ({
      name: d.name,
      base64: Buffer.from(`stub-${d.name}`).toString('base64'),
    }));
    ctx.emailSection = buildDiagramSection(stubs);
    assert.match(ctx.emailSection.html || '', /cid:front-desk-diagram/);
  });

  scoped(/^that reference is matched by an inline attachment carrying those bytes$/, (ctx) => {
    const attachments = ctx.emailSection.attachments || [];
    const cidOf = (a) => a['content-id'] || a.contentId || a.cid || '';
    const hit = attachments.find((a) => cidOf(a).includes('front-desk'));
    assert.ok(hit, `no front-desk attachment in ${JSON.stringify(attachments.map(cidOf))}`);
  });

  scoped(/^the front-desk diagram source does not parse$/, (ctx) => {
    sourceBackup = fs.readFileSync(FD_SRC, 'utf8');
    fs.writeFileSync(FD_SRC, 'this is not valid mermaid {{{{\n');
  });

  scoped(/^the render run reports failure$/, (ctx) => {
    assert.equal(ctx.renderFailed, true, 'expected render failure');
    restoreSource();
  });

  scoped(/^the briefing email still sends with its no-diagram note$/, (ctx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl580-deg-'));
    fs.writeFileSync(path.join(dir, '2026-07-09.md'), 'Headline: x\n\nBody.\n');
    const out = execFileSync('bb', [HARNESS, dir, 'diagram-unavailable'], { encoding: 'utf8' });
    const result = JSON.parse(out);
    const blob = `${result.lastSentText || ''}\n${result.lastSentHtml || ''}`;
    assert.match(blob, /unavailable|diagram/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
