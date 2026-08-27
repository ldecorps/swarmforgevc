const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  flattenMermaidThemeVars,
  hasUnresolvedThemeVars,
  renderMermaidToFlatSvg,
  renderMermaidToPng,
  DEFAULT_DIAGRAM_THEME,
  DIAGRAM_RENDER_WIDTH,
} = require('../out/diagrams/mermaidRender');

const FIXTURE_MMD = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-diagram.mmd'), 'utf8');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// BL-445: renderMermaidToPng's real elkjs-layout + resvg-rasterize cost is
// this file's own biggest contributor to the suite's wall-clock (profiled,
// not guessed - see vitest.config.mjs's isolate note for the bigger pole).
// Three separate assertions below (well-formed, byte-identical's "first"
// call, and render-width) only need SOME real render of FIXTURE_MMD to
// inspect, not three independent ones, so they share one memoized render.
// The determinism assertion still performs its own SECOND, independent
// render to compare against - collapsing that one into the cache would make
// it compare a buffer to itself and prove nothing.
let canonicalFixturePngPromise;
function renderFixturePngOnce() {
  if (!canonicalFixturePngPromise) {
    canonicalFixturePngPromise = renderMermaidToPng(FIXTURE_MMD);
  }
  return canonicalFixturePngPromise;
}

// PNG signature (8 bytes) + IHDR chunk length (4) + type "IHDR" (4), then
// width as a big-endian uint32 (RFC 2083 section 11.2.2 - the IHDR chunk).
function pngWidth(png) {
  return png.readUInt32BE(16);
}

test('flattenMermaidThemeVars resolves every var(--name) reference to a literal hex color', () => {
  const svg = '<svg style="--bg:#ffffff;--fg:#101010"><style>@import url(x); text{}</style><rect fill="var(--_node-fill)" stroke="var(--bg)"/></svg>';
  const flat = flattenMermaidThemeVars(svg, { bg: '#ffffff', fg: '#101010' });

  assert.equal(hasUnresolvedThemeVars(flat), false);
  assert.doesNotMatch(flat, /var\(--/);
  assert.doesNotMatch(flat, /@import/);
  assert.match(flat, /fill="#/);
});

test('flattenMermaidThemeVars throws on a CSS var it has no derivation for (defends against a library update introducing a new one)', () => {
  const svg = '<svg><rect fill="var(--_never-seen-before)"/></svg>';
  assert.throws(() => flattenMermaidThemeVars(svg, { bg: '#ffffff', fg: '#101010' }), /unmapped CSS var/);
});

test('renderMermaidToFlatSvg produces a well-formed SVG with no unresolved theme vars for a real diagram', async () => {
  const svg = await renderMermaidToFlatSvg(FIXTURE_MMD);

  assert.match(svg, /^<svg[ >]/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.equal(hasUnresolvedThemeVars(svg), false, 'flattened SVG must carry no unresolved var(--...) reference');
});

// BL-260 render-fixture-well-formed-05
test('renderMermaidToPng renders a fixture diagram to a non-empty, well-formed PNG', async () => {
  const png = await renderFixturePngOnce();

  assert.ok(png.length > 0, 'the produced image must be non-empty');
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), 'the produced bytes must be a well-formed PNG (correct magic header)');
});

// BL-260 local-deterministic-02
test('renderMermaidToPng is byte-identical for the same source across repeated calls', async () => {
  const first = await renderFixturePngOnce();
  const second = await renderMermaidToPng(FIXTURE_MMD);

  assert.ok(first.equals(second), 'rendering the same Mermaid source twice must produce byte-identical output');
});

test('renderMermaidToPng differs for different diagram sources (not a constant/stubbed image)', async () => {
  const first = await renderMermaidToPng('flowchart TD\n  A --> B');
  const second = await renderMermaidToPng('flowchart TD\n  X --> Y --> Z');

  assert.ok(!first.equals(second));
});

test('DEFAULT_DIAGRAM_THEME provides bg and fg suitable for a white email background', () => {
  assert.equal(DEFAULT_DIAGRAM_THEME.bg, '#ffffff');
  assert.equal(typeof DEFAULT_DIAGRAM_THEME.fg, 'string');
});

// BL-402: the human found the prior 1600px render blurry on high-DPI
// screens; the fix doubles the resvg rasterization width.
test('DIAGRAM_RENDER_WIDTH is at least 3200 (double the prior 1600)', () => {
  assert.ok(DIAGRAM_RENDER_WIDTH >= 3200, `expected DIAGRAM_RENDER_WIDTH >= 3200, got ${DIAGRAM_RENDER_WIDTH}`);
});

// BL-402 high-dpi-render-width-01
test('renderMermaidToPng renders at least 3200 pixels wide', async () => {
  const png = await renderFixturePngOnce();
  const width = pngWidth(png);

  assert.ok(width >= 3200, `expected the rendered PNG to be at least 3200px wide, got ${width}`);
});
