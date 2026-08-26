'use strict';

// BL-456: step handlers for the Divio four-mode docs reorg. Drives the REAL
// compiled computeDocsStructure directly against this repo's OWN docs/ tree
// (no fixture) - the ticket's own E2E procedure says to verify against the
// real docs tree, not a fixture (BL-335), and the structural contract (four
// mode dirs, an orphan-free classified index) is exactly the kind of thing
// that must hold for the real tree, not just a synthetic one.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { DIVIO_MODES, DIVIO_MODE_ORIENTATIONS, computeDocsStructure } = require(path.join(EXT_OUT, 'docs', 'docsStructure'));

function registerSteps(registry) {
  // ── Given (non-behavioral - the real docs/ tree is read directly by the
  //    When step below) ──────────────────────────────────────────────────
  registry.define(/^the project docs tree$/, () => {});
  registry.define(/^the docs index$/, () => {});
  registry.define(/^the four Divio mode directories$/, () => {});
  registry.define(/^the authored docs and the docs index$/, () => {});

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the docs structure is validated$/, (ctx) => {
    ctx.report = computeDocsStructure(REPO_ROOT);
  });

  // ── divio-docs-01 ────────────────────────────────────────────────────
  registry.define(/^a directory exists for each of the tutorials, how-to, reference, and explanation modes$/, (ctx) => {
    if (ctx.report.missingModeDirs.length > 0) {
      throw new Error(`expected all four Divio mode directories to exist, missing: ${ctx.report.missingModeDirs.join(', ')}`);
    }
  });

  // ── divio-docs-02 (Scenario Outline) - engineering.prompt's Gherkin
  //    load-bearing-column rule: both <mode> and <orientation> are
  //    validated against the real closed set/lookup, never a passthrough ──
  registry.define(/^the "([^"]*)" mode is listed with the "([^"]*)" orientation$/, (ctx, mode, orientation) => {
    if (!DIVIO_MODES.includes(mode)) {
      throw new Error(`divio-docs-02: unrecognized <mode> example value "${mode}"`);
    }
    if (DIVIO_MODE_ORIENTATIONS[mode] !== orientation) {
      throw new Error(`divio-docs-02: unrecognized <orientation> example value "${orientation}" for mode "${mode}"`);
    }
    if (ctx.report.modesWithoutOrientation.includes(mode)) {
      throw new Error(`expected the "${mode}" mode to be classified with its "${orientation}" orientation in docs/index.md`);
    }
  });

  // ── divio-docs-03 ────────────────────────────────────────────────────
  registry.define(/^each mode directory contains at least one document$/, (ctx) => {
    if (ctx.report.emptyModeDirs.length > 0) {
      throw new Error(`expected every mode directory to contain at least one document, empty: ${ctx.report.emptyModeDirs.join(', ')}`);
    }
  });

  // ── divio-docs-04 ────────────────────────────────────────────────────
  registry.define(/^every authored doc is linked from the index$/, (ctx) => {
    if (ctx.report.orphanedDocs.length > 0) {
      throw new Error(`expected every authored doc to be linked from docs/index.md, orphaned: ${JSON.stringify(ctx.report.orphanedDocs)}`);
    }
  });

  registry.define(/^no authored doc is orphaned$/, (ctx) => {
    if (ctx.report.orphanedDocs.length > 0) {
      throw new Error(`expected no orphaned docs, found: ${JSON.stringify(ctx.report.orphanedDocs)}`);
    }
  });
}

module.exports = { registerSteps };
