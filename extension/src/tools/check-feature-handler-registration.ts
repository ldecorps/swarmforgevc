/**
 * BL-1303: CLI for the feature-handler registration guard.
 *
 * Thin wrapper over featureHandlerRegistrationCheck's pure assessor: it lists
 * the tree, reads files, prints the refusal, and returns the exit status. The
 * branch decision (this guard is silent off `main`) stays in the shell guard,
 * swarmforge/scripts/check_feature_handler_registration.sh, which is the
 * member of the commit-guard chain.
 *
 * Usage: node check-feature-handler-registration.js <repo-root>
 *   Exit 0: no offender, or nothing to check.
 *   Exit 1: at least one feature file could not run in this tree - every
 *           offender named in the one refusal.
 *   Exit 2: the CLI was called wrong (no repo root).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { assessFeatureHandlerRegistration } from './featureHandlerRegistrationCheck';
import { formatFeatureHandlerRefusal } from './featureHandlerRegistrationReport';
import { FeatureHandlerTree, FEATURES_DIR, LIB_DIR, STEPS_DIR } from './featureHandlerRegistrationTypes';

export type CheckIo = {
  /** Names directly in a repo-relative directory; [] when it does not exist. */
  listDir(relativeDir: string): string[];
  /** Text of a repo-relative file, or null when absent or unreadable. */
  readFile(relativePath: string): string | null;
  write(text: string): void;
};

export function createFsIo(repoRoot: string): CheckIo {
  return {
    listDir(relativeDir) {
      try {
        return fs
          .readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
          .filter((entry) => entry.isFile() || entry.isSymbolicLink())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    readFile(relativePath) {
      try {
        return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      } catch {
        return null;
      }
    },
    write(text) {
      process.stderr.write(text);
    },
  };
}

export function readTree(io: CheckIo): FeatureHandlerTree {
  return {
    featureFiles: io
      .listDir(FEATURES_DIR)
      .filter((name) => name.endsWith('.feature'))
      .map((name) => `${FEATURES_DIR}/${name}`),
    stepFiles: io
      .listDir(STEPS_DIR)
      .filter((name) => name.endsWith('.js'))
      .map((name) => `${STEPS_DIR}/${name}`),
    libFiles: io.listDir(LIB_DIR).map((name) => `${LIB_DIR}/${name}`),
    readFile: io.readFile,
  };
}

export function checkFeatureHandlerRegistration(io: CheckIo): number {
  const offenders = assessFeatureHandlerRegistration(readTree(io));
  if (offenders.length === 0) {
    return 0;
  }
  io.write(`${formatFeatureHandlerRefusal(offenders)}\n`);
  return 1;
}

export function main(argv: string[], makeIo: (repoRoot: string) => CheckIo = createFsIo): number {
  const repoRoot = argv[0];
  if (!repoRoot) {
    process.stderr.write('usage: check-feature-handler-registration.js <repo-root>\n');
    return 2;
  }
  return checkFeatureHandlerRegistration(makeIo(repoRoot));
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
