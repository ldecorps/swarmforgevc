const assert = require('node:assert/strict');

const { PALETTE, ticketColorFor, ticketColorSegments } = require('../out/panel/ticketColors');

// --- ticketColorFor (BL-139 ticket-color-01/03) ---

test('ticketColorFor returns the same color for the same ticket id on repeated calls', () => {
  const first = ticketColorFor('BL-139');
  const second = ticketColorFor('BL-139');
  assert.deepEqual(first, second);
});

test('ticketColorFor returns a color from the palette', () => {
  const color = ticketColorFor('BL-042');
  assert.ok(PALETTE.some((entry) => entry.background === color.background && entry.color === color.color));
});

test('ticketColorFor returns a background and a readable text color', () => {
  const color = ticketColorFor('BL-001');
  assert.ok(typeof color.background === 'string' && color.background.length > 0);
  assert.ok(typeof color.color === 'string' && color.color.length > 0);
});

test('ticketColorFor is stable regardless of what other tickets exist (BL-139 ticket-color-01)', () => {
  // Color is a pure function of the ticket id alone, not of position in some
  // currently-visible set — so a ticket keeps its color as other tickets
  // come and go around it across stage transitions.
  const aloneColor = ticketColorFor('BL-200');
  ticketColorFor('BL-001');
  ticketColorFor('BL-999');
  const stillColor = ticketColorFor('BL-200');
  assert.deepEqual(aloneColor, stillColor);
});

test('ticketColorFor gives different-looking ids different colors most of the time', () => {
  // Not a strict guarantee (palette is finite) but a basic smoke check that
  // the hash actually spreads ids across the palette rather than collapsing
  // everything onto one entry.
  const ids = ['BL-001', 'BL-002', 'BL-003', 'BL-004', 'BL-005', 'BL-006'];
  const colors = new Set(ids.map((id) => ticketColorFor(id).background));
  assert.ok(colors.size > 1, 'expected more than one distinct color across 6 different ticket ids');
});

// --- ticketColorSegments (BL-139 ticket-color-04/05) ---

test('ticketColorSegments returns one segment per held ticket, in numeric id order', () => {
  const segments = ticketColorSegments(['BL-100', 'BL-9', 'BL-30']);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((s) => s.id), ['BL-9', 'BL-30', 'BL-100']);
});

test('ticketColorSegments assigns each segment the same color ticketColorFor would for that id', () => {
  const segments = ticketColorSegments(['BL-7', 'BL-8']);
  assert.deepEqual(segments[0].color, ticketColorFor('BL-7'));
  assert.deepEqual(segments[1].color, ticketColorFor('BL-8'));
});

test('ticketColorSegments dedupes repeated ids', () => {
  const segments = ticketColorSegments(['BL-1', 'BL-1', 'BL-2']);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((s) => s.id), ['BL-1', 'BL-2']);
});

test('ticketColorSegments is deterministic across repeated calls on the same set (BL-139 ticket-color-05)', () => {
  const ids = ['BL-3', 'BL-1', 'BL-2'];
  const first = ticketColorSegments(ids);
  const second = ticketColorSegments([...ids]);
  assert.deepEqual(first, second);
});

test('ticketColorSegments handles a single ticket', () => {
  const segments = ticketColorSegments(['BL-5']);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].id, 'BL-5');
});

test('ticketColorSegments handles an empty list', () => {
  const segments = ticketColorSegments([]);
  assert.deepEqual(segments, []);
});

// --- WCAG AA contrast (BL-139 accessibility constraint: "contrast-safe
// text", "readable in dark and light theme") ---
// The badge/chip text this palette serves renders at 10-11px (see
// .tile-bl-badge / .bl-assigned in webviewHtml.ts) — normal-size text, not
// the 18px+/14px-bold "large text" exception, so the WCAG AA threshold is
// 4.5:1, not the relaxed 3.0:1. This was unverified: entry #808000/'#fff'
// hardener-found at 4.20:1 and fixed to '#808000'/'#000' (5.01:1).

function hexToRgb(hex) {
  const stripped = hex.replace('#', '');
  // The PALETTE's text colors are 3-digit shorthand ('#fff', '#000'); expand
  // to 6 digits first or '#fff' misparses as rgb(0,15,255) instead of white.
  const full = stripped.length === 3 ? stripped.split('').map((c) => c + c).join('') : stripped;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const [rl, gl, bl] = [channel(r), channel(g), channel(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA, hexB) {
  const [lumA, lumB] = [relativeLuminance(hexToRgb(hexA)), relativeLuminance(hexToRgb(hexB))];
  const [hi, lo] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (hi + 0.05) / (lo + 0.05);
}

const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;

test('every palette entry meets WCAG AA contrast (4.5:1) for normal-size badge/chip text', () => {
  for (const entry of PALETTE) {
    const ratio = contrastRatio(entry.background, entry.color);
    assert.ok(
      ratio >= WCAG_AA_NORMAL_TEXT_RATIO,
      `${entry.background}/${entry.color} contrast is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor`
    );
  }
});
