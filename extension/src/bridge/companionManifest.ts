import * as crypto from 'crypto';
import { readBacklogFolders } from '../panel/backlogReader';
import { DOCS_TREE_SCHEMA_VERSION, readVisionDocs } from '../docs/docsTree';

// BL-866: the bridge-side companion-manifest + package catalog - the
// contract every later offline slice of epic BL-865 reads. A package's
// generation is a content hash of what it is about to serve, computed
// fresh on every request. There is no cache to go stale, so the invariant
// "a served body and the generation it carries always agree" holds
// structurally (same computation, same call), never by separate
// bookkeeping that could drift.

export const COMPANION_PACKAGE_FORMAT = 'json';

interface PackageContent {
  formatVersion: number;
  data: unknown;
}

type PackageRead = { readable: true; content: PackageContent } | { readable: false; reason: string };

interface CompanionPackageDef {
  name: string;
  read: (targetPath: string) => PackageRead;
}

function readBacklogPackage(targetPath: string): PackageRead {
  return { readable: true, content: { formatVersion: 1, data: readBacklogFolders(targetPath) } };
}

// readVisionDocs already degrades a missing/unreadable individual doc to
// "simply absent" (docsTree.ts). Zero docs read back means the whole
// source is unreadable at this target - per the ticket's invariant, that
// must be refused, never served as an empty package.
function readDocsPackage(targetPath: string): PackageRead {
  const vision = readVisionDocs(targetPath);
  if (vision.length === 0) {
    return { readable: false, reason: 'no docs source could be read' };
  }
  return { readable: true, content: { formatVersion: DOCS_TREE_SCHEMA_VERSION, data: { vision } } };
}

const COMPANION_PACKAGES: CompanionPackageDef[] = [
  { name: 'backlog', read: readBacklogPackage },
  { name: 'docs', read: readDocsPackage },
];

function computeGeneration(content: PackageContent): string {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
}

export interface CompanionManifestEntry {
  name: string;
  generation: string;
  format: string;
  formatVersion: number;
}

// Only packages that can actually be read are advertised - invariant "the
// manifest never advertises a package the bridge cannot serve".
export function listCompanionPackages(targetPath: string): CompanionManifestEntry[] {
  const entries: CompanionManifestEntry[] = [];
  for (const pkg of COMPANION_PACKAGES) {
    const result = pkg.read(targetPath);
    if (result.readable) {
      entries.push({
        name: pkg.name,
        generation: computeGeneration(result.content),
        format: COMPANION_PACKAGE_FORMAT,
        formatVersion: result.content.formatVersion,
      });
    }
  }
  return entries;
}

export type CompanionPackageResponse =
  | { status: 'ok'; name: string; generation: string; format: string; formatVersion: number; data: unknown }
  | { status: 'unchanged'; name: string; generation: string }
  | { status: 'unreadable'; name: string; reason: string }
  | { status: 'unknown'; name: string; reason: string };

export function readCompanionPackage(
  targetPath: string,
  name: string,
  requestedGeneration: string | null
): CompanionPackageResponse {
  const pkg = COMPANION_PACKAGES.find((p) => p.name === name);
  if (!pkg) {
    return { status: 'unknown', name, reason: `no package named "${name}"` };
  }
  const result = pkg.read(targetPath);
  if (!result.readable) {
    return { status: 'unreadable', name, reason: result.reason };
  }
  const generation = computeGeneration(result.content);
  if (requestedGeneration !== null && requestedGeneration === generation) {
    return { status: 'unchanged', name, generation };
  }
  return {
    status: 'ok',
    name,
    generation,
    format: COMPANION_PACKAGE_FORMAT,
    formatVersion: result.content.formatVersion,
    data: result.content.data,
  };
}

export function isCompanionManifestPath(url: string): boolean {
  return url.split('?', 1)[0] === '/companion-manifest';
}

const COMPANION_PACKAGE_PATH_PREFIX = '/companion-package/';

export function isCompanionPackagePath(url: string): boolean {
  return url.split('?', 1)[0].startsWith(COMPANION_PACKAGE_PATH_PREFIX);
}

export function parseCompanionPackageRequest(url: string): { name: string; generation: string | null } {
  const [pathOnly, queryString] = url.split('?', 2);
  const name = decodeURIComponent(pathOnly.slice(COMPANION_PACKAGE_PATH_PREFIX.length));
  const params = new URLSearchParams(queryString ?? '');
  return { name, generation: params.get('generation') };
}
