import { Resvg } from '@resvg/resvg-js';

// beautiful-mermaid ships ESM-only ("type": "module", no "require" export
// condition) - a plain top-level `import` fails to compile/load from this
// project's CommonJS output (`require('beautiful-mermaid')` throws "No
// 'exports' main defined"). A source-level `import()` doesn't fix this on
// its own: with tsconfig's `"module": "commonjs"`, tsc *downlevels* every
// `import()` back into `require()` (visible in out/diagrams/mermaidRender.js
// as `Promise.resolve().then(() => require('beautiful-mermaid'))`), hitting
// the exact same exports-map error. Routing the call through `new
// Function(...)` hides the `import()` from tsc's static analysis (it only
// sees a string literal at compile time), so it survives into a REAL native
// dynamic import at runtime - Node's own dynamic `import()` can load an ESM
// package from a CommonJS caller regardless of module system. Node caches
// the loaded module per specifier, so repeated calls do not re-load it.
type BeautifulMermaidModule = typeof import('beautiful-mermaid');
const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<BeautifulMermaidModule>;
async function loadBeautifulMermaid(): Promise<BeautifulMermaidModule> {
  return nativeDynamicImport('beautiful-mermaid');
}

// BL-260: renders docs/diagrams/*.mmd (Mermaid) to a PNG suitable for inline
// embedding in the daily briefing email. beautiful-mermaid is a pure-JS/TS
// renderer (elkjs layout, zero DOM/browser dependency) chosen over
// @mermaid-js/mermaid-cli specifically because mmdc requires downloading and
// spawning a headless Chromium (via puppeteer) - heavy, and unusable in this
// project's own build/CI environment where `unzip` isn't installed and the
// browser download cannot be extracted. beautiful-mermaid + resvg together
// have no such dependency: both are pure/native-binding libraries with no
// browser, no network call at render time, and (verified empirically)
// byte-identical output for identical input across separate process runs.
export interface MermaidDiagramTheme {
  bg: string;
  fg: string;
  line?: string;
  accent?: string;
  muted?: string;
  surface?: string;
  border?: string;
}

// beautiful-mermaid's built-in 'github-light' theme, copied as a literal
// (rather than read from THEMES at call time) so this constant stays
// synchronous to use - readable on the white/near-white background most
// email clients render an HTML body against. A version bump of the pinned
// dependency should re-diff THEMES['github-light'] against this literal.
export const DEFAULT_DIAGRAM_THEME: MermaidDiagramTheme = {
  bg: '#ffffff',
  fg: '#1f2328',
  line: '#d1d9e0',
  accent: '#0969da',
  muted: '#59636e',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// CSS `color-mix(in srgb, A p%, B)`: simple per-channel linear interpolation,
// A weighted p%, B weighted the remainder.
function mixInSrgb(hexA: string, pctA: number, hexB: string): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const t = pctA / 100;
  return rgbToHex([a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t)]);
}

// beautiful-mermaid's SVG output paints every element via `var(--_name)` CSS
// custom properties, derived from `bg`/`fg` (plus optional enrichment colors)
// through `color-mix()` in an emitted <style> block - designed for a live
// browser DOM with real CSS cascade (the library's "live theme switching"
// feature). A static SVG rasterizer has no CSS engine and cannot resolve
// nested var()/color-mix(): resvg renders every such fill/stroke as invalid
// (defaulting to solid black or no paint at all), which is silent, not an
// error - confirmed empirically before this fix (BL-260 spike). This mirrors
// the *documented* "Mono Mode" derivation table in beautiful-mermaid's own
// README exactly, tied to the pinned version in package.json; a version bump
// must re-verify this table against the new release's <style> output.
const DERIVED_VAR_NAMES = [
  '_text',
  '_text-sec',
  '_text-muted',
  '_text-faint',
  '_line',
  '_arrow',
  '_node-fill',
  '_node-stroke',
  '_group-fill',
  '_group-hdr',
  '_inner-stroke',
  '_key-badge',
] as const;

function resolveThemeVars(theme: MermaidDiagramTheme): Record<string, string> {
  const { bg, fg } = theme;
  return {
    bg,
    fg,
    _text: fg,
    '_text-sec': theme.muted ?? mixInSrgb(fg, 60, bg),
    '_text-muted': theme.muted ?? mixInSrgb(fg, 40, bg),
    '_text-faint': mixInSrgb(fg, 25, bg),
    _line: theme.line ?? mixInSrgb(fg, 50, bg),
    _arrow: theme.accent ?? mixInSrgb(fg, 85, bg),
    '_node-fill': theme.surface ?? mixInSrgb(fg, 3, bg),
    '_node-stroke': theme.border ?? mixInSrgb(fg, 20, bg),
    '_group-fill': bg,
    '_group-hdr': mixInSrgb(fg, 5, bg),
    '_inner-stroke': mixInSrgb(fg, 12, bg),
    '_key-badge': mixInSrgb(fg, 10, bg),
  };
}

// Replaces every `var(--name)` reference with its resolved literal hex color
// and drops the generated <style> block (which otherwise carries an
// `@import url(fonts.googleapis.com/...)` - an external network reference
// this ticket's reproducibility/privacy constraint (BL-252 spirit) requires
// never depending on). The result is plain SVG presentation attributes only:
// renderable by any static SVG engine and, unlike the raw output, by real
// email clients that support inline SVG too.
export function flattenMermaidThemeVars(svg: string, theme: MermaidDiagramTheme): string {
  const resolved = resolveThemeVars(theme);
  const withColorsResolved = svg.replace(/var\(--([a-zA-Z0-9_-]+)\)/g, (whole, name: string) => {
    if (!(name in resolved)) {
      throw new Error(`beautiful-mermaid emitted an unmapped CSS var --${name}; DERIVED_VAR_NAMES is stale`);
    }
    return resolved[name];
  });
  return withColorsResolved.replace(
    /<style>[\s\S]*?<\/style>/,
    '<style>text { font-family: Helvetica, Arial, sans-serif; }</style>'
  );
}

// True when `svg` no longer references any DERIVED_VAR_NAMES entry that
// flattenMermaidThemeVars would have resolved (used by tests / defensive
// assertions, not by the render path itself).
export function hasUnresolvedThemeVars(svg: string): boolean {
  return DERIVED_VAR_NAMES.some((name) => svg.includes(`var(--${name})`)) || /@import/.test(svg);
}

export async function renderMermaidToFlatSvg(
  source: string,
  theme: MermaidDiagramTheme = DEFAULT_DIAGRAM_THEME
): Promise<string> {
  const { renderMermaidSVG } = await loadBeautifulMermaid();
  const raw = renderMermaidSVG(source, theme);
  return flattenMermaidThemeVars(raw, theme);
}

// Deterministic: identical `source`/`theme` produce a byte-identical PNG
// (verified across separate process invocations, not just repeated
// in-process calls - BL-260 local-deterministic-02). Async only because of
// the ESM interop load above; the render math itself has no I/O or timers.
export async function renderMermaidToPng(
  source: string,
  theme: MermaidDiagramTheme = DEFAULT_DIAGRAM_THEME
): Promise<Buffer> {
  const svg = await renderMermaidToFlatSvg(source, theme);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1600 }, background: 'white' });
  return resvg.render().asPng();
}
