'use strict';

// BL-914: parses test(...) call sites from a JS test file's raw source text
// well enough to answer "does THIS named test declare a trailing numeric
// timeout argument, and what is it". String/template-literal and comment
// aware - both appear inside the very test names and comments this
// ticket's own edits contain (e.g. one test's own name carries parentheses
// and an escaped quote), so a naive substring/regex scan would mis-count
// depth on this exact file. Not a full JS parser: only (){}[] nesting plus
// string/comment skipping, which is what a `test(name, fn[, timeoutMs])`
// call site actually needs.

function skipStringLiteral(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

function skipWhitespaceAndComments(text, i) {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    return i;
  }
}

// Returns { end, text } - end is the index AFTER the matching close bracket
// for the opening bracket at openIdx; text is everything between them
// (exclusive), string/comment contents never counted as structure.
function scanBalanced(text, openIdx) {
  let depth = 0;
  const start = openIdx + 1;
  let i = openIdx;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipStringLiteral(text, i) - 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      depth++;
    } else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        return { end: i + 1, text: text.slice(start, i) };
      }
    }
  }
  return { end: text.length, text: text.slice(start) };
}

// Splits argsText into top-level comma-separated arguments, never splitting
// on a comma inside a nested bracket, string, or comment.
function splitTopLevelArgs(argsText) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipStringLiteral(argsText, i) - 1;
      continue;
    }
    if (c === '/' && argsText[i + 1] === '/') {
      while (i < argsText.length && argsText[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && argsText[i + 1] === '*') {
      i += 2;
      while (i < argsText.length && !(argsText[i] === '*' && argsText[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      depth++;
    } else if (c === ')' || c === '}' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(argsText.slice(start, i));
      start = i + 1;
    }
  }
  args.push(argsText.slice(start));
  return args.map((a) => a.trim()).filter((a) => a.length > 0);
}

function extractStringLiteralValue(text) {
  const i = skipWhitespaceAndComments(text, 0);
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return null;
  }
  const end = skipStringLiteral(text, i);
  const raw = text.slice(i + 1, end - 1);
  return raw.replace(/\\(.)/g, '$1');
}

// Pure: given a test file's raw source, returns [{ name, timeoutMs }] for
// every top-level `test(name, fn[, timeoutMs])` call site found - never
// test.each/test.skip/describe, which this ticket's three files don't use.
// timeoutMs is null when no trailing bare-number argument is present (the
// deprecated `{ timeout }` object form is deliberately NOT recognized here
// - this ticket's own invariant requires the non-deprecated bare-number
// form, so a lingering object form should read as "no timeout declared").
function parseTestTimeouts(sourceText) {
  const calls = [];
  const callRegex = /(?:^|[^.\w])test\s*\(/g;
  let match;
  while ((match = callRegex.exec(sourceText))) {
    const openIdx = match.index + match[0].length - 1;
    const { end, text: argsText } = scanBalanced(sourceText, openIdx);
    const args = splitTopLevelArgs(argsText);
    callRegex.lastIndex = end;
    if (args.length === 0) {
      continue;
    }
    const name = extractStringLiteralValue(args[0]);
    if (name === null) {
      continue;
    }
    let timeoutMs = null;
    if (args.length >= 3) {
      const trailing = args[args.length - 1].trim();
      if (/^\d+$/.test(trailing)) {
        timeoutMs = Number(trailing);
      }
    }
    calls.push({ name, timeoutMs });
  }
  return calls;
}

module.exports = { parseTestTimeouts };
