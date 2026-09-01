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
 * This module is the pure assessor: it walks the registry graph and decides
 * which feature files are left unrunnable. It never requires a step file,
 * because requiring the registry executes every handler module and a tree
 * that cannot run is exactly the tree this check is asked about. The two
 * things that made BL-1253's scenarios unrunnable are both statically
 * visible: the registration is a `require` line in the registry, and the lib
 * script is a `path.join(__dirname, 'lib', ...)` reference in the handler.
 *
 * Shared constants and types live in featureHandlerRegistrationTypes.ts.
 * Text-level parsing (require specifiers, sibling-script references, ticket
 * ids) lives in featureHandlerRegistrationText.ts. Turning the Offender list
 * into refusal text lives in featureHandlerRegistrationReport.ts. Callers
 * (check-feature-handler-registration.ts, tests) import each piece from the
 * module that actually defines it rather than through a re-export barrel
 * here - narrower interfaces, and it keeps this file's own dependency graph
 * a one-way fan-out with no cycle back to it.
 */

import { extractRequiredModules, extractSiblingScripts, featureTicketId, handlerDeclaresTicket } from './featureHandlerRegistrationText';
import { REGISTRY_PATH, type Offender, type OffenderKind, type FeatureHandlerTree } from './featureHandlerRegistrationTypes';

/** Order offenders are reported in: the registry first, then what it reaches. */
const KIND_ORDER: OffenderKind[] = [
  'unreadable-step-registry',
  'missing-registry-module',
  'unreadable-handler',
  'unregistered-handler',
  'missing-sibling-script',
];

function offenderKey(offender: Offender): string {
  return [offender.kind, offender.path, offender.feature || '', offender.handler || ''].join(' ');
}

/**
 * One hop of the registry walk: resolves a single required module against
 * the tree and folds it into the shared traversal state. Split out of
 * walkRegistry so each function's own branching stays under the CRAP
 * threshold - this is the per-module decision, walkRegistry is the loop that
 * drives it.
 */
function visitRequiredModule(
  required: string,
  tree: FeatureHandlerTree,
  seen: Set<string>,
  textOf: Map<string, string>,
  queue: string[],
  reachable: Set<string>,
  offenders: Offender[]
): void {
  if (seen.has(required)) {
    return;
  }
  seen.add(required);
  // Existence is asked of the tree itself rather than of a pre-listed set, so
  // a handler kept in a subdirectory of steps/ resolves like any other.
  // Absent and unreadable are one offender: either way the registry cannot be
  // followed, and neither is a pass.
  const requiredText = tree.readFile(required);
  if (requiredText === null) {
    offenders.push({ kind: 'missing-registry-module', path: required });
    return;
  }
  reachable.add(required);
  if (!required.endsWith('.js')) {
    return;
  }
  textOf.set(required, requiredText);
  queue.push(required);
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
      visitRequiredModule(required, tree, seen, textOf, queue, reachable, offenders);
    }
  }
  return { reachable, registryReadable: true };
}

/**
 * A feature whose OWN ticket-named handler exists but is not reachable from
 * the registry carries scenarios the runner will throw on. Split out of
 * assessFeatureHandlerRegistration so each function's own branching stays
 * under the CRAP threshold.
 */
function collectUnregisteredHandlers(
  tree: FeatureHandlerTree,
  handlers: string[],
  reachable: Set<string>,
  offenders: Offender[]
): void {
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
}

/**
 * A registered handler that executes an absent sibling script fails at the
 * step rather than at resolution - the second half of the same incident.
 * Split out of assessFeatureHandlerRegistration for the same CRAP reason as
 * collectUnregisteredHandlers above.
 */
function collectMissingSiblingScripts(
  tree: FeatureHandlerTree,
  scanned: string[],
  libs: Set<string>,
  offenders: Offender[]
): void {
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
}

/** De-duplicates offenders and orders them: the registry first, then what it reaches. */
function dedupeAndSortOffenders(offenders: Offender[]): Offender[] {
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

  collectUnregisteredHandlers(tree, handlers, reachable, offenders);

  // With an unreadable registry nothing is known to be reachable, so every
  // handler in the tree is scanned instead: an unreadable registry must widen
  // the report, never silence it.
  const scanned = registryReadable ? handlers.filter((p) => reachable.has(p)) : handlers;
  collectMissingSiblingScripts(tree, scanned, new Set(tree.libFiles), offenders);

  return dedupeAndSortOffenders(offenders);
}
