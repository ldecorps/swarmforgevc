// BL-609: pure pane font-size step/clamp for the Resident Spy live screen.
// Kept out of the DOM handler so unit tests cover the arithmetic; the HTML
// shell interpolates the same constants into its inline script.

export const PANE_FONT_DEFAULT_PX = 13;
export const PANE_FONT_MIN_PX = 9;
export const PANE_FONT_MAX_PX = 20;
export const PANE_FONT_STEP_PX = 1;
export const PANE_FONT_CROWDED_DELTA_PX = 2;

export function clampPaneFontSizePx(px: number): number {
  if (!Number.isFinite(px)) {
    return PANE_FONT_DEFAULT_PX;
  }
  if (px < PANE_FONT_MIN_PX) {
    return PANE_FONT_MIN_PX;
  }
  if (px > PANE_FONT_MAX_PX) {
    return PANE_FONT_MAX_PX;
  }
  return Math.round(px);
}

export function stepPaneFontSizePx(currentPx: number, direction: 1 | -1): number {
  return clampPaneFontSizePx(clampPaneFontSizePx(currentPx) + direction * PANE_FONT_STEP_PX);
}

export function paneFontSizeAtBound(px: number, bound: 'minimum' | 'maximum'): boolean {
  const clamped = clampPaneFontSizePx(px);
  return bound === 'minimum' ? clamped <= PANE_FONT_MIN_PX : clamped >= PANE_FONT_MAX_PX;
}
