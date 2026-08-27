/**
 * BL-757: /pilot land orphan-doc check when authored Divio-mode docs were touched.
 * Pure assessment — IO stays in commitClaimGitReader / pilot-acceptance-gate.
 */
import { type OrphanedDoc } from '../docs/docsStructure';
import {
  isAuthoredDivioDocPath,
  modeRelativeFromRepoDocPath,
  orphanDocKey,
} from '../docs/docsOrphanAllowlist';

export const ORPHANED_AUTHORED_DOC_REFUSAL =
  'orphaned authored doc not linked from docs/index.md';

export type OrphanDocsLandMiss = {
  path: string;
  modeRelative: string;
};

export type OrphanDocsLandCheckOutcome =
  | { checked: true; docsTouched: false }
  | { checked: true; docsTouched: true; miss?: OrphanDocsLandMiss }
  | { checked: false };

function touchedAuthoredDocPaths(touchedRelativePaths: string[]): string[] {
  return touchedRelativePaths.filter((p) => isAuthoredDivioDocPath(p));
}

function orphanKeySet(orphans: OrphanedDoc[]): Set<string> {
  return new Set(orphans.map(orphanDocKey));
}

export function assessOrphanDocsLandCheck(input: {
  touchedRelativePaths: string[];
  orphans: OrphanedDoc[];
  allowlist: Set<string>;
}): OrphanDocsLandCheckOutcome {
  const touchedDocs = touchedAuthoredDocPaths(input.touchedRelativePaths);
  if (touchedDocs.length === 0) {
    return { checked: true, docsTouched: false };
  }
  const orphanKeys = orphanKeySet(input.orphans);
  for (const docPath of touchedDocs) {
    const modeRelative = modeRelativeFromRepoDocPath(docPath);
    if (!modeRelative) {
      continue;
    }
    if (!orphanKeys.has(modeRelative)) {
      continue;
    }
    if (input.allowlist.has(modeRelative)) {
      continue;
    }
    return {
      checked: true,
      docsTouched: true,
      miss: { path: docPath.replace(/\\/g, '/'), modeRelative },
    };
  }
  return { checked: true, docsTouched: true };
}
