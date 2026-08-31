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
export function withoutEmbeddedSource(text: string): string {
  return text
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""');
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
