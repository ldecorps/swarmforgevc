// BL-070: tiles retain scrollback memory beyond the visible pane rows.
//
// Root cause (verified against a live-shaped fixture — alternate-screen
// pane, tmux history_size stays 0, pane_height ~7 — before writing any
// code): the Claude CLI TUI runs in tmux's ALTERNATE screen, and tmux keeps
// NO scrollback for the alternate screen, so `capture-pane -S -N` (the
// BL-028 fix) can only ever return the currently-visible rows regardless of
// N. Tiles used to "have memory" only because BL-052 hadn't shrunk panes
// yet — the visible alt-screen band itself held ~200 lines. BL-052 (fit
// pane to visible tile height) shrank panes to ~7 rows, which silently
// capped the entire retrievable transcript at the visible band; the
// BL-028 fix stayed wired (a no-op) so its own regression test kept
// passing while the actual behavior died.
//
// Fix: the retained transcript is reconstructed on the HOST side by diffing
// successive small captures — tmux never has to remember anything. Each
// capture's trailing FOOTER (status line, divider, input prompt — see
// detectFooterLineCount, a TS port of media/panel.js's own detector, kept
// behaviorally identical since both must agree on where content ends and
// the live status band begins) is treated as always-current, never
// accumulated; only the CONTENT lines above it are diffed against the
// previous capture's content lines and any genuinely new lines are
// appended to a per-role bounded history buffer.

// Ported from media/panel.js's detectFooterLineCount — the host and webview
// run in different JS environments with no shared module system, so this is
// intentionally duplicated; keep the two in sync if either changes.
export function detectFooterLineCount(text: string): number {
  if (!text) return 0;

  const lines = text.split('\n');
  let footerStart = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    if (i === lines.length - 1 && trimmed === '') {
      continue;
    }

    if (/^[❯>](\s|$)/.test(trimmed)) {
      footerStart = i;
      break;
    }
  }

  if (footerStart === -1) {
    return 0;
  }

  let footerEnd = footerStart;
  for (let i = footerStart - 1; i >= Math.max(0, footerStart - 5); i--) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    if (trimmed === '') {
      continue;
    }

    if (/^\[.+\]|\[auto\]|\[.*permission/.test(trimmed)) {
      footerEnd = i;
      continue;
    }

    if (/^esc\s+to|^.*interrupt|^.*break/i.test(trimmed)) {
      footerEnd = i;
      continue;
    }

    if (trimmed.length > 40 || !/^[[\-*@]/.test(trimmed)) {
      break;
    }
  }

  return lines.length - footerEnd;
}

// The largest k (0 <= k <= min(oldLines.length, newLines.length)) such that
// the LAST k lines of oldLines equal the FIRST k lines of newLines — how
// much of the new capture's top overlaps with the old capture's bottom,
// i.e. content that's still visible, just scrolled. Only ever called on
// footer-stripped content lines, so a volatile status/spinner line never
// breaks the alignment.
export function findOverlap(oldLines: string[], newLines: string[]): number {
  const maxK = Math.min(oldLines.length, newLines.length);
  for (let k = maxK; k > 0; k--) {
    const oldTail = oldLines.slice(oldLines.length - k);
    const newHead = newLines.slice(0, k);
    if (oldTail.every((line, i) => line === newHead[i])) {
      return k;
    }
  }
  return 0;
}

export interface PaneHistoryResult {
  // Updated content-only history, bounded to maxHistoryLines.
  history: string[];
  // history + this capture's current footer, ready to display.
  displayText: string;
  // This capture's content-only lines, to pass back in as
  // previousContentLines on the next call.
  contentLines: string[];
}

export function accumulatePaneHistory(
  previousContentLines: string[] | null,
  history: string[],
  rawCaptureText: string,
  maxHistoryLines: number
): PaneHistoryResult {
  const rawLines = rawCaptureText.split('\n');
  const footerCount = detectFooterLineCount(rawCaptureText);
  const contentLines = footerCount > 0 ? rawLines.slice(0, rawLines.length - footerCount) : rawLines.slice();
  const footerLines = footerCount > 0 ? rawLines.slice(rawLines.length - footerCount) : [];

  const appended =
    previousContentLines === null
      ? contentLines
      : contentLines.slice(findOverlap(previousContentLines, contentLines));

  const boundedHistory = [...history, ...appended].slice(-maxHistoryLines);
  const displayText = [...boundedHistory, ...footerLines].join('\n');

  return { history: boundedHistory, displayText, contentLines };
}
