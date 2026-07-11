const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  flattenMermaidThemeVars,
  hasUnresolvedThemeVars,
  renderMermaidToFlatSvg,
  renderMermaidToPng,
  DEFAULT_DIAGRAM_THEME,
} = require('../out/diagrams/mermaidRender');

const FIXTURE_MMD = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-diagram.mmd'), 'utf8');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  const png = await renderMermaidToPng(FIXTURE_MMD);

  assert.ok(png.length > 0, 'the produced image must be non-empty');
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), 'the produced bytes must be a well-formed PNG (correct magic header)');
});

// BL-260 local-deterministic-02
test('renderMermaidToPng is byte-identical for the same source across repeated calls', async () => {
  const first = await renderMermaidToPng(FIXTURE_MMD);
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
