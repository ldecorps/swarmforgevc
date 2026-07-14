const SNIPPET_MAX_LENGTH = 200;

// BL-391: a tmux pane capture is a TERMINAL RENDERING, not a message - it
// carries ANSI/CSI/OSC control sequences (colour, cursor movement, screen
// clears) that mean something to a terminal and nothing to a human reading
// Telegram or a git-committed topic record. Matches the standard CSI grammar
// (ESC [ params intermediate final), OSC sequences (ESC ] ... BEL/ST), and
// the simpler Fe escape forms, plus bare C0 control bytes below 0x20 (other
// than \n/\t, which are real content) - never a Unicode GLYPH like a
// box-drawing character or prompt arrow, which is visible, printable text
// and not an escape code; only invisible control bytes are stripped, so
// ordinary prose (which never contains one) passes through byte-identical.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b(?:[@-Z\\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
// eslint-disable-next-line no-control-regex
const OTHER_CONTROL_BYTES_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function stripTerminalChrome(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '').replace(OTHER_CONTROL_BYTES_PATTERN, '');
}

// Short quote of the detected prompt for the BL-073 email body: the last few
// non-empty lines, trimmed and capped, so the human can recognize the
// question without opening the tile. BL-391: sanitised of terminal chrome
// FIRST - before splitting into lines and before the length cap - so a
// truncated escape sequence can never leak a dangling partial code into the
// output, and the character budget is spent on real content, not invisible
// bytes.
export function extractQuestionSnippet(paneText: string | null | undefined): string {
  if (!paneText) return '';
  const lines = stripTerminalChrome(paneText)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const snippet = lines.slice(-3).join(' ').trim();
  if (snippet.length <= SNIPPET_MAX_LENGTH) {
    return snippet;
  }
  return `${snippet.slice(0, SNIPPET_MAX_LENGTH - 1)}…`;
}

export function detectNeedsHuman(paneText: string | null | undefined): boolean {
  if (!paneText) return false;

  const lines = paneText.split('\n');
  const lastLines = lines.slice(-10).join('\n').toLowerCase();

  // Yes/no questions (higher confidence)
  if (/\(y\/n\)|yes\s*\/\s*no|yes\s*or\s*no/.test(lastLines)) {
    return true;
  }

  // Permission prompts (but exclude normal [auto] idle status)
  if (/permission\s*(required|mode|denied)|approve|allow|deny/.test(lastLines)) {
    return true;
  }

  // Exclude normal [auto] status at idle
  if (/\[auto\]\s*(idle|busy)/.test(lastLines)) {
    return false;
  }

  // Multiple choice or questions
  const lines_trimmed = lines.map(l => l.trim());
  for (let i = lines_trimmed.length - 1; i >= Math.max(0, lines_trimmed.length - 5); i--) {
    const line = lines_trimmed[i];

    // Skip empty lines and the standard input box
    if (!line || /^[❯>]\s*(type|message|\s*)$/.test(line)) {
      continue;
    }

    // Look for choice prompts with numbers, letters, or symbols
    if (/^[❯>]\s+[0-9a-z\(\)\[\]]/.test(line)) {
      return true;
    }

    // Question mark indicates a question (but be careful about exclamation marks in output)
    if (/[?!]$/.test(line) && !/^❯\s*/.test(line)) {
      return true;
    }
  }

  return false;
}
