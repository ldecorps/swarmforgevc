'use strict';

// BL-402: step handlers for "the morning briefing renders its diagrams at
// high resolution". Reuses BL-260's already-registered Given/When steps
// (briefingDiagramSteps.js) for the fixture-render and generate-and-compose
// setup, which populate ctx.renderedImage / ctx.result respectively - this
// file only adds the two Then assertions BL-402 introduces: the higher
// render width, and that the higher-res PNG still displays constrained to
// the email column width (the "must not regress" layout invariant).
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');

function mermaidRenderModule() {
  // Requires the COMPILED module (matches briefingDiagramSteps.js's own
  // in-process module-surface pattern) - proves out/ is actually built and
  // wired, not just the .ts source.
  return require(path.join(EXT_DIR, 'out', 'diagrams', 'mermaidRender'));
}

// PNG signature (8 bytes) + IHDR chunk length (4) + type "IHDR" (4), then
// width as a big-endian uint32 (RFC 2083 section 11.2.2 - the IHDR chunk).
function pngWidth(png) {
  return png.readUInt32BE(16);
}

function registerSteps(registry) {
  // ── high-dpi-render-width-01 ────────────────────────────────────────
  registry.define(/^the rendered PNG is at least 3200 pixels wide$/, (ctx) => {
    const width = pngWidth(ctx.renderedImage);
    if (width < 3200) {
      throw new Error(`expected the rendered PNG to be at least 3200px wide, got ${width}`);
    }
    const { DIAGRAM_RENDER_WIDTH } = mermaidRenderModule();
    if (DIAGRAM_RENDER_WIDTH < 3200) {
      throw new Error(`expected DIAGRAM_RENDER_WIDTH >= 3200, got ${DIAGRAM_RENDER_WIDTH}`);
    }
  });

  // ── scales-to-column-width-03 ───────────────────────────────────────
  registry.define(/^the inline diagram image is constrained to the container width$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/<img[^>]*>/.test(html)) {
      throw new Error(`expected at least one inline diagram <img> in the html; got: ${html}`);
    }
    if (!html.includes('style="max-width:100%;height:auto"')) {
      throw new Error(
        `expected the diagram <img> to keep style="max-width:100%;height:auto" so it displays at the column width; got: ${html}`
      );
    }
  });
}

module.exports = { registerSteps };
