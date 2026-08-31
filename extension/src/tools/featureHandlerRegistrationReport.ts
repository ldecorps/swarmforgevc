/**
 * BL-1303: presentation for what the feature-handler assessor found.
 *
 * Pulled out of featureHandlerRegistrationCheck.ts: turning an Offender list
 * into human-readable text is a distinct concern from computing that list -
 * the assessor decides WHAT is wrong, this module decides how to SAY it.
 */

import { REGISTRY_PATH, type Offender, type OffenderKind } from './featureHandlerRegistrationTypes';

const KIND_LABEL: Record<OffenderKind, string> = {
  'unreadable-step-registry': 'unreadable step registry',
  'missing-registry-module': 'missing or unreadable registry module',
  'unreadable-handler': 'unreadable handler',
  'unregistered-handler': 'unregistered handler',
  'missing-sibling-script': 'missing sibling script',
};

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
