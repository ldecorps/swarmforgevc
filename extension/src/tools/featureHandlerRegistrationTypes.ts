/**
 * BL-1303: the shared vocabulary for the feature-handler registration guard.
 *
 * Paths and types with no logic of their own, kept separate so the modules
 * that DO have logic (featureHandlerRegistrationText.ts, ...Check.ts,
 * ...Report.ts) can each depend on this one without depending on each other -
 * this is the leaf of that graph.
 */

export const REGISTRY_PATH = 'specs/pipeline/steps/index.js';
export const STEPS_DIR = 'specs/pipeline/steps';
/**
 * BL-1371: the discovery predicate specs/pipeline/steps/index.js registers by.
 * A top-level file in STEPS_DIR whose name ends here IS registered - there is
 * no list to be absent from. Mirrors that module's own HANDLER_SUFFIX; a test
 * asserts the two literals agree rather than trusting the comment.
 */
export const HANDLER_SUFFIX = 'Steps.js';
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
