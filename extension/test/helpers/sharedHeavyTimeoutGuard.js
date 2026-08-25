'use strict';

// BL-932: pure, source-text based checks for the shared heavy-subprocess
// timeout invariants - never executed/imported-and-run against the target
// files, same rationale as workerPoolConfigGuard.js (works without a
// compiled out/, never triggers a file's own side effects). Used by both
// the BL-932 property test (which fuzzes these against synthetic source
// text) and bl932SharedHeavyTimeoutSteps.js (which applies them to the real
// property-lane files) - one checker, two callers, per BL-871's own split.
const CONSTANT_NAME = 'SUBPROCESS_HEAVY_TIMEOUT_MS';
const HELPER_MODULE_BASENAME = 'subprocessHeavyTimeout';

// A hand-copied declaration looks like `const SUBPROCESS_HEAVY_TIMEOUT_MS =
// <number>;` - a bare numeric literal, never sourced from the shared
// helper module.
function declaresLocalConstant(sourceText) {
  return new RegExp(`const\\s+${CONSTANT_NAME}\\s*=\\s*\\d`).test(sourceText);
}

function importsSharedHeavyTimeout(sourceText) {
  return sourceText.includes(HELPER_MODULE_BASENAME) && sourceText.includes(CONSTANT_NAME);
}

function usesSharedHeavyTimeoutOnly(sourceText) {
  return importsSharedHeavyTimeout(sourceText) && !declaresLocalConstant(sourceText);
}

// Finds the matching close bracket for the bracket at openIdx (source[openIdx]
// must be openCh), skipping over string/template literal contents so a
// bracket character inside a string never miscounts depth.
function findMatchingClose(source, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Splits the raw text between a call's outer parens into its top-level,
// comma-separated arguments - respecting nested (), {}, [] and
// string/template literals, so a comma inside a function body or object
// literal never splits one argument in two.
function splitTopLevelArgs(argListText) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argListText.length; i++) {
    const ch = argListText[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < argListText.length && argListText[i] !== quote) {
        if (argListText[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(argListText.slice(start, i));
      start = i + 1;
    }
  }
  const last = argListText.slice(start);
  if (last.trim().length > 0) args.push(last);
  return args.map((a) => a.trim());
}

// Finds the top-level `test(...)` call (a property file in this ticket's
// scope has exactly one) and returns its arguments, split at the top level.
// Returns null if no top-level `test(` call is found.
function findTestCallArgs(source) {
  const m = /(?:^|\n)test\(/.exec(source);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = findMatchingClose(source, openIdx, '(', ')');
  if (closeIdx === -1) return null;
  return splitTopLevelArgs(source.slice(openIdx + 1, closeIdx));
}

// The OUTER per-test timeout: test()'s third argument, if present - raw
// trimmed source text (e.g. "SUBPROCESS_HEAVY_TIMEOUT_MS" or "240000"),
// left unresolved (a caller that needs a number knows how to resolve an
// identifier against its own imports). undefined when the call carries
// only the name and the function.
function outerTimeoutArgText(source) {
  const args = findTestCallArgs(source);
  return args && args.length >= 3 ? args[2] : undefined;
}

// The INNER spawnSync/spawn subprocess timeout - the `timeout: <n>` option
// key, which a naive grep for "timeout" also matches (BL-932's own
// documented "grep trap"). Distinct from outerTimeoutArgText by
// construction: this looks for the OPTION KEY's value, that looks at the
// call's own top-level third argument position - neither can accidentally
// match the other's shape.
function innerSpawnTimeoutMs(source) {
  const m = /\btimeout\s*:\s*(\d+)/.exec(source);
  return m ? Number(m[1]) : undefined;
}

module.exports = {
  CONSTANT_NAME,
  HELPER_MODULE_BASENAME,
  declaresLocalConstant,
  importsSharedHeavyTimeout,
  usesSharedHeavyTimeoutOnly,
  findTestCallArgs,
  outerTimeoutArgText,
  innerSpawnTimeoutMs,
  splitTopLevelArgs,
};
