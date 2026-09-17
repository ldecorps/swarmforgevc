/**
 * BL-1303: text-level parsing the feature-handler assessor relies on.
 *
 * Pulled out of featureHandlerRegistrationCheck.ts: these functions read the
 * TEXT of a file and extract references from it (a require specifier, a
 * sibling-script path, a ticket id from a filename) - a distinct concern from
 * walking the registry graph those references describe, or from reporting
 * what the walk found.
 */

import { LIB_DIR } from './featureHandlerRegistrationTypes';

function basename(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1];
}

function withJsExtension(name: string): string {
  return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.js`;
}

/**
 * Blanks out double-quoted strings and template literals before a scan.
 *
 * Step files embed FIXTURE SOURCE as string literals - bl1209's detector
 * fixture writes `"const { mkTmpDir } = require('./helpers/tmpDir');"` into a
 * temp file. That is a require in some other tree, not in this one, and
 * reading it as a registry hop reports a module that was never meant to exist
 * here. Real requires and real lib references in this codebase are written
 * with single quotes, so blanking the other two quoting forms separates the
 * code from the source it carries. A reference hidden in a double-quoted
 * string is therefore not scanned - it can only make this check MISS an
 * offender, never invent one.
 */
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'throw', 'void', 'delete', 'yield', 'await',
]);
const REGEX_AFTER_CHAR = new Set(['(', '[', '{', '}', ',', ';', '=', ':', '?', '!', '&', '|', '+', '-', '*', '%', '<', '>', '~', '^']);

export function withoutEmbeddedSource(text: string): string {
  // ONE left-to-right scan over comments, regex literals and all three
  // quoting forms (hotfix 2026-09-17, human ruling A). Two sequential regex
  // passes let a single-quoted literal that HOLDS a double quote - `'"'` at
  // bl1607ShippedStepScanBudgetGrowsWithLaneSteps.js line 37 - unpair the
  // double-quote pass for the rest of the file, so a later double-quoted
  // fixture string carrying require('./test/helpers/...') survived blanking,
  // the guard invented a module, and every commit on main was refused. A
  // regex alternation over the three quotes is not enough either: an
  // apostrophe inside a comment ("the lane's") or inside a regex literal
  // (bl1410's /...extension\/test's tmpDir helper$/, its /['"]/ class) opens
  // a phantom single-quoted span. So the scan consumes each token in source
  // order: comments and regex literals are blanked (neither is ever a
  // dependency - two handlers cite require('./blNNNSteps') and
  // require('./helpers/tmpDir') in prose, hidden before only because the old
  // backtick pass happened to blank the code spans around them), template
  // and double-quoted literals are blanked as before, and single-quoted
  // literals are kept verbatim (real requires and lib references are
  // single-quoted). A slash opens a regex only in expression position - after
  // an opening bracket, an operator, a separator or one of REGEX_AFTER_WORD -
  // and reads as division after an identifier, a number, `)` or `]`. Blanking
  // can only make this check MISS an offender, never invent one - the same
  // direction the old passes erred.
  const n = text.length;
  let out = '';
  let i = 0;
  let prevWord = '';
  let prevChar = '';
  let started = false;
  const regexAllowed = (): boolean => {
    if (!started) return true;
    if (prevWord !== '') return REGEX_AFTER_WORD.has(prevWord);
    return REGEX_AFTER_CHAR.has(prevChar);
  };
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const nl = text.indexOf('\n', i);
      const stop = nl === -1 ? n : nl;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? n : close + 2;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let terminated = false;
      while (j < n) {
        const ch = text[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '\n') break;
        if (inClass) {
          if (ch === ']') inClass = false;
        } else if (ch === '[') {
          inClass = true;
        } else if (ch === '/') {
          terminated = true;
          break;
        }
        j += 1;
      }
      if (terminated) {
        let stop = j + 1;
        while (stop < n && /[a-z]/.test(text[stop])) stop += 1;
        out += ' '.repeat(stop - i);
        i = stop;
        started = true;
        prevWord = '';
        prevChar = ')';
        continue;
      }
    }
    if (c === '`' || c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      const stop = Math.min(j + 1, n);
      out += c === "'" ? text.slice(i, stop) : c + c;
      i = stop;
      started = true;
      prevWord = '';
      prevChar = c;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      out += word;
      i = j;
      started = true;
      prevWord = /^[0-9]/.test(word) ? '' : word;
      prevChar = /^[0-9]/.test(word) ? '0' : '';
      continue;
    }
    out += c;
    i += 1;
    if (!/\s/.test(c)) {
      started = true;
      prevWord = '';
      prevChar = c;
    }
  }
  return out;
}

/**
 * Relative `require('./x')` specifiers of one file, resolved against the
 * directory of the file that requires them - a `require('./sibling')` inside
 * steps/lib/ names steps/lib/sibling.js, never steps/sibling.js.
 */
export function extractRequiredModules(text: string, fromFile: string): string[] {
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const found: string[] = [];
  const re = /require\(\s*'(\.\/[^']+)'\s*\)/g;
  const source = withoutEmbeddedSource(text);
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    found.push(`${dir}/${withJsExtension(match[1].slice(2))}`);
  }
  return found;
}

/**
 * Sibling scripts a handler reaches for under specs/pipeline/steps/lib/.
 *
 * Anchored on `__dirname` (or an explicit `specs/pipeline/steps/lib/` path):
 * `path.join(__dirname, 'lib', 'x.sh')` is a reference to THIS directory's
 * lib, while `path.join(TEST_DIR, 'lib', 'tmp_cleanup.sh')` names a lib
 * somewhere else entirely and must not be resolved here. A lib path named in
 * prose is not a reference either, so the quoted forms are the only ones read.
 */
export function extractSiblingScripts(text: string): string[] {
  const found: string[] = [];
  const fromDirname = /__dirname\s*,\s*'lib'\s*,\s*'([^'/]+)'/g;
  const fromStepsPath = /'steps'\s*,\s*'lib'\s*,\s*'([^'/]+)'/g;
  const inline = /'(?:[^']*\/)?specs\/pipeline\/steps\/lib\/([^'/]+)'/g;
  const source = withoutEmbeddedSource(text);
  for (const re of [fromDirname, fromStepsPath, inline]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      found.push(`${LIB_DIR}/${withJsExtension(match[1])}`);
    }
  }
  return found;
}

/** The ticket id a feature file's name declares, e.g. "BL-1253". */
export function featureTicketId(featureFile: string): string | undefined {
  const match = basename(featureFile).match(/^(BL-\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Does this handler file's name declare that ticket? `bl1303...Steps.js`
 * belongs to BL-1303 and never to BL-130 - the digits must end where the
 * ticket's do, or a short ticket id adopts a longer one's handler.
 */
export function handlerDeclaresTicket(stepFile: string, ticketId: string): boolean {
  const digits = ticketId.slice('BL-'.length);
  return new RegExp(`^bl${digits}(?![0-9])`, 'i').test(basename(stepFile));
}
