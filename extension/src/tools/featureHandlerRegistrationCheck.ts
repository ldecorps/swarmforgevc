/**
 * BL-1303: a feature file on `main` must resolve to a runnable step handler.
 *
 * specs/pipeline/runtime.js THROWS on any scenario whose steps no registered
 * handler matches, so a feature file can land carrying scenarios that cannot
 * run, and the failure surfaces later - to whichever role next runs the
 * suite, against a parcel that did not cause it. Nothing refused that state
 * at the moment it was created.
 *
 * Observed 2026-08-30 on BL-1253: a QA bounce-revert correctly removed a
 * handler, its lib script and its specs/pipeline/steps/index.js registration
 * together; a later merge resurrected the handler file and the feature file
 * but neither the registration nor the lib. `main` then carried 8 scenarios
 * that all failed with "no step handler matched".
 *
 * This module is the pure assessor. It decides from the TEXT of the tree -
 * it never requires a step file, because requiring the registry executes
 * every handler module and a tree that cannot run is exactly the tree this
 * check is asked about. The two things that made BL-1253's scenarios
 * unrunnable are both statically visible: the registration is a `require`
 * line in the registry, and the lib script is a `path.join(__dirname,
 * 'lib', ...)` reference in the handler.
 *
 * IO (listing the tree, reading files, the branch check) stays in
 * check-feature-handler-registration.ts and the shell guard.
 */

export const REGISTRY_PATH = 'specs/pipeline/steps/index.js';
export const STEPS_DIR = 'specs/pipeline/steps';
export const LIB_DIR = 'specs/pipeline/steps/lib';
export const FEATURES_DIR = 'specs/features';

export type OffenderKind =
  | 'unreadable-step-registry'
  | 'missing-registry-module'
  | 'unregistered-handler'
  | 'unreadable-handler'
  | 'missing-sibling-script';

export type Offender = {
  kind: OffenderKind;
  /** The artifact the refusal is about, repo-relative. */
  path: string;
  /** The feature file left unrunnable by it, when one is implicated. */
  feature?: string;
  /** The registered handler reaching for a missing sibling. */
  handler?: string;
};

export type FeatureHandlerTree = {
  /** Repo-relative paths under specs/features/ ending in .feature. */
  featureFiles: string[];
  /** Repo-relative paths of the top-level specs/pipeline/steps/*.js files. */
  stepFiles: string[];
  /** Repo-relative paths of everything under specs/pipeline/steps/lib/. */
  libFiles: string[];
  /** Text of a repo-relative path, or null when absent or unreadable. */
  readFile(relativePath: string): string | null;
};

/** Order offenders are reported in: the registry first, then what it reaches. */
const KIND_ORDER: OffenderKind[] = [
  'unreadable-step-registry',
  'missing-registry-module',
  'unreadable-handler',
  'unregistered-handler',
  'missing-sibling-script',
];

const KIND_LABEL: Record<OffenderKind, string> = {
  'unreadable-step-registry': 'unreadable step registry',
  'missing-registry-module': 'missing or unreadable registry module',
  'unreadable-handler': 'unreadable handler',
  'unregistered-handler': 'unregistered handler',
  'missing-sibling-script': 'missing sibling script',
};

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

/**
 * Every step file reachable from the registry by `require`, transitively - a
 * handler pulled in by another step file is registered just as truly as one
 * named in index.js. Unresolvable and unreadable hops are collected as
 * offenders rather than skipped: a registry that cannot be followed is
 * refused, never waved through.
 */
function walkRegistry(
  tree: FeatureHandlerTree,
  offenders: Offender[]
): { reachable: Set<string>; registryReadable: boolean } {
  const reachable = new Set<string>();
  const registryText = tree.readFile(REGISTRY_PATH);
  if (registryText === null) {
    offenders.push({ kind: 'unreadable-step-registry', path: REGISTRY_PATH });
    return { reachable, registryReadable: false };
  }

  const queue: string[] = [REGISTRY_PATH];
  const seen = new Set<string>([REGISTRY_PATH]);
  const textOf = new Map<string, string>([[REGISTRY_PATH, registryText]]);

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const text = textOf.get(current) as string;
    for (const required of extractRequiredModules(text, current)) {
      if (seen.has(required)) {
        continue;
      }
      seen.add(required);
      // Existence is asked of the tree itself rather than of a pre-listed
      // set, so a handler kept in a subdirectory of steps/ resolves like any
      // other. Absent and unreadable are one offender: either way the
      // registry cannot be followed, and neither is a pass.
      const requiredText = tree.readFile(required);
      if (requiredText === null) {
        offenders.push({ kind: 'missing-registry-module', path: required });
        continue;
      }
      reachable.add(required);
      if (!required.endsWith('.js')) {
        continue;
      }
      textOf.set(required, requiredText);
      queue.push(required);
    }
  }
  return { reachable, registryReadable: true };
}

function offenderKey(offender: Offender): string {
  return [offender.kind, offender.path, offender.feature || '', offender.handler || ''].join(' ');
}

/**
 * Every reason a feature file in this tree could not run, in ONE pass.
 *
 * Article 4.4's shape applied in a gate: a check that stopped at the first
 * offender would reproduce the one-defect-at-a-time loop that rule exists to
 * prevent, so every branch below collects and none returns early.
 */
export function assessFeatureHandlerRegistration(tree: FeatureHandlerTree): Offender[] {
  const offenders: Offender[] = [];
  const { reachable, registryReadable } = walkRegistry(tree, offenders);

  const handlers = tree.stepFiles.filter((p) => p !== REGISTRY_PATH);

  // A feature whose OWN ticket-named handler exists but is not reachable from
  // the registry carries scenarios the runner will throw on.
  for (const feature of tree.featureFiles) {
    const ticketId = featureTicketId(feature);
    if (!ticketId) {
      continue;
    }
    const own = handlers.filter((handler) => handlerDeclaresTicket(handler, ticketId));
    // ONE reachable handler is enough: a ticket may keep a focused entry
    // module beside its real handler (steps/bl623Only.js requires
    // steps/bl623RoutingSkipTrailSteps.js), and only the one index.js names
    // is ever reachable. The feature is unrunnable when NONE of them is.
    if (own.length === 0 || own.some((handler) => reachable.has(handler))) {
      continue;
    }
    for (const handler of own) {
      offenders.push({ kind: 'unregistered-handler', path: handler, feature });
    }
  }

  // A registered handler that executes an absent sibling script fails at the
  // step rather than at resolution - the second half of the same incident.
  // With an unreadable registry nothing is known to be reachable, so every
  // handler in the tree is scanned instead: an unreadable registry must widen
  // the report, never silence it.
  const scanned = registryReadable ? handlers.filter((p) => reachable.has(p)) : handlers;
  const libs = new Set(tree.libFiles);
  for (const handler of scanned) {
    const text = tree.readFile(handler);
    if (text === null) {
      offenders.push({ kind: 'unreadable-handler', path: handler });
      continue;
    }
    for (const script of extractSiblingScripts(text)) {
      if (!libs.has(script)) {
        offenders.push({ kind: 'missing-sibling-script', path: script, handler });
      }
    }
  }

  const deduped = new Map<string, Offender>();
  for (const offender of offenders) {
    const key = offenderKey(offender);
    if (!deduped.has(key)) {
      deduped.set(key, offender);
    }
  }
  return [...deduped.values()].sort((a, b) => {
    const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    return byKind !== 0 ? byKind : offenderKey(a).localeCompare(offenderKey(b));
  });
}

export function describeOffender(offender: Offender): string {
  const label = KIND_LABEL[offender.kind];
  if (offender.kind === 'unregistered-handler') {
    return `${label}: ${offender.path} (offending feature file: ${offender.feature})`;
  }
  if (offender.kind === 'missing-sibling-script') {
    return `${label}: ${offender.path} (executed by ${offender.handler})`;
  }
  if (offender.kind === 'missing-registry-module') {
    return `${label}: ${offender.path} (required by ${REGISTRY_PATH})`;
  }
  return `${label}: ${offender.path}`;
}

export function formatFeatureHandlerRefusal(offenders: Offender[]): string {
  if (offenders.length === 0) {
    return '';
  }
  const lines = [
    'Commit refused: a feature file would reach `main` with no runnable step handler.',
    '',
  ];
  for (const offender of offenders) {
    lines.push(`  - ${describeOffender(offender)}`);
  }
  lines.push(
    '',
    `${offenders.length} offending artifact(s) reported - this pass names every one of them, so there is no second violation waiting for your next attempt (Article 4.4).`,
    `Remedy: register the handler in ${REGISTRY_PATH}, restore the sibling script it executes, or retire the feature file with them. specs/pipeline/runtime.js throws on any scenario no registered handler matches, so this tree would fail for whichever role runs the suite next.`
  );
  return lines.join('\n');
}
