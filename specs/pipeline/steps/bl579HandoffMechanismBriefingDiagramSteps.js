'use strict';

// BL-579: morning briefing carries a handoff-mechanism diagram. Drives the
// REAL renderBriefingDiagrams + build-diagram-section path. Allowlist counts
// come from DIAGRAM_FILES (exported), never a hardcoded "3".

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  'the morning briefing carries a handoff-MECHANISM diagram alongside architecture and swarm-flow';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const HARNESS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'briefing_email_harness.bb');
const HANDOFF_NAME = 'handoff-mechanism';
const HANDOFF_FILE = 'handoff-flow.mmd';
const HANDOFF_SRC = path.join(REPO_ROOT, 'docs', 'diagrams', HANDOFF_FILE);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let handoffBackup = null;

function restoreHandoffSource() {
  if (handoffBackup !== null) {
    fs.writeFileSync(HANDOFF_SRC, handoffBackup);
    handoffBackup = null;
  }
}

process.on('exit', restoreHandoffSource);

function diagramModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'render-briefing-diagrams'));
}

function allowlist() {
  return diagramModule().DIAGRAM_FILES;
}

function buildDiagramSection(diagrams) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl579-section-'));
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
  registry.defineScoped(
    /^the morning briefing's diagram allowlist names the handoff-mechanism diagram$/,
    (ctx) => {
      restoreHandoffSource();
      const names = allowlist().map((d) => d.name);
      assert.ok(names.includes(HANDOFF_NAME), `DIAGRAM_FILES missing ${HANDOFF_NAME}: ${JSON.stringify(names)}`);
      assert.equal(allowlist().find((d) => d.name === HANDOFF_NAME).file, HANDOFF_FILE);
      ctx.allowlist = allowlist();
    },
    FEATURE
  );

  registry.defineScoped(/^the briefing's diagrams are rendered from the committed sources$/, async (ctx) => {
    const { renderBriefingDiagrams } = diagramModule();
    try {
      ctx.rendered = await renderBriefingDiagrams(REPO_ROOT);
      ctx.renderFailed = false;
    } catch (err) {
      ctx.rendered = null;
      ctx.renderFailed = true;
      ctx.renderError = err;
    }
  }, FEATURE);

  registry.defineScoped(/^one rendered diagram is produced for each name in the allowlist$/, (ctx) => {
    assert.equal(ctx.renderFailed, false, `render failed: ${ctx.renderError}`);
    assert.deepEqual(
      ctx.rendered.map((d) => d.name),
      ctx.allowlist.map((d) => d.name)
    );
  }, FEATURE);

  registry.defineScoped(/^the handoff-mechanism diagram is among them$/, (ctx) => {
    assert.ok(ctx.rendered.some((d) => d.name === HANDOFF_NAME));
  }, FEATURE);

  registry.defineScoped(/^every rendered diagram carries non-empty image bytes$/, (ctx) => {
    for (const { name, base64 } of ctx.rendered) {
      const png = Buffer.from(base64, 'base64');
      assert.ok(png.length > 8, `${name} empty`);
      assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), `${name} not PNG`);
    }
  }, FEATURE);

  registry.defineScoped(/^the briefing's diagrams have been rendered$/, async (ctx) => {
    if (!ctx.rendered) {
      const { renderBriefingDiagrams } = diagramModule();
      ctx.rendered = await renderBriefingDiagrams(REPO_ROOT);
      ctx.renderFailed = false;
    }
  }, FEATURE);

  registry.defineScoped(/^the briefing email is built$/, (ctx) => {
    // CID wiring only needs names + non-empty base64; full PNG payloads
    // overflow bb -e's pipe buffer (ENOBUFS).
    const stubs = ctx.rendered.map((d) => ({
      name: d.name,
      base64: Buffer.from(`stub-${d.name}`).toString('base64'),
    }));
    ctx.emailSection = buildDiagramSection(stubs);
  }, FEATURE);

  registry.defineScoped(/^the handoff-mechanism diagram is referenced by its own cid$/, (ctx) => {
    assert.match(ctx.emailSection.html || '', /cid:handoff-mechanism-diagram/);
  }, FEATURE);

  registry.defineScoped(/^the email carries one inline attachment per referenced diagram$/, (ctx) => {
    const attachments = ctx.emailSection.attachments || [];
    assert.equal(attachments.length, ctx.rendered.length);
  }, FEATURE);

  registry.defineScoped(/^the handoff-mechanism diagram source does not parse$/, (ctx) => {
    handoffBackup = fs.readFileSync(HANDOFF_SRC, 'utf8');
    fs.writeFileSync(HANDOFF_SRC, 'this is not valid mermaid {{{{\n');
  }, FEATURE);

  registry.defineScoped(/^the render run reports failure$/, (ctx) => {
    assert.equal(ctx.renderFailed, true, 'expected render failure');
    restoreHandoffSource();
  }, FEATURE);

  registry.defineScoped(/^the briefing email still sends with its no-diagram note$/, (ctx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl579-deg-'));
    fs.writeFileSync(path.join(dir, '2026-07-09.md'), 'Headline: x\n\nBody.\n');
    const out = execFileSync('bb', [HARNESS, dir, 'diagram-unavailable'], { encoding: 'utf8' });
    const result = JSON.parse(out);
    const blob = `${result.lastSentText || ''}\n${result.lastSentHtml || ''}`;
    assert.match(blob, /unavailable|diagram/i);
    fs.rmSync(dir, { recursive: true, force: true });
  }, FEATURE);
}

module.exports = { registerSteps };
