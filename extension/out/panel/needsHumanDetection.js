"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractQuestionSnippet = extractQuestionSnippet;
exports.detectNeedsHuman = detectNeedsHuman;
const SNIPPET_MAX_LENGTH = 200;
// Short quote of the detected prompt for the BL-073 email body: the last few
// non-empty lines, trimmed and capped, so the human can recognize the
// question without opening the tile.
function extractQuestionSnippet(paneText) {
    if (!paneText)
        return '';
    const lines = paneText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const snippet = lines.slice(-3).join(' ').trim();
    if (snippet.length <= SNIPPET_MAX_LENGTH) {
        return snippet;
    }
    return `${snippet.slice(0, SNIPPET_MAX_LENGTH - 1)}…`;
}
function detectNeedsHuman(paneText) {
    if (!paneText)
        return false;
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
//# sourceMappingURL=needsHumanDetection.js.map