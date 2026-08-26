/**
 * BL-1087: detect docs that name a swarmforge/packs/*.conf the tree does
 * not have. The illustrative placeholder `swarmforge/packs/NAME.conf`
 * (and any other ALL-CAPS pack stem used the same way) is not drift —
 * it documents pack naming, not a real pack.
 *
 * `docs/reference/Specification.MD` is the shipped-work historical log:
 * it may still name a removed pack when recording that the pack shipped
 * and was later withdrawn (BL-1087 scenario 03). That file is excluded
 * from the drift walk by path role, not by a list of pack names.
 */
export type NamedPackRef = {
  /** Posix path as written in the doc, e.g. swarmforge/packs/foo.conf */
  namedPath: string;
  /** Basename stem without .conf, e.g. foo or NAME */
  stem: string;
};

export type DocSource = {
  /** Repo-relative posix path, e.g. docs/how-to/foo.md — optional for synthetic corpora */
  relativePath?: string;
  text: string;
};

const PACK_CONF_RE = /swarmforge\/packs\/([A-Za-z0-9_.-]+)\.conf/g;

const SHIPPED_WORK_LOG = 'docs/reference/Specification.MD';

/** A stem of only uppercase letters/digits/underscores is a metasyntactic placeholder. */
export function isIllustrativePackPlaceholder(stem: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(stem);
}

export function isShippedWorkLog(relativePath: string | undefined): boolean {
  if (!relativePath) return false;
  const norm = relativePath.split('\\').join('/');
  return norm === SHIPPED_WORK_LOG || norm.endsWith(`/${SHIPPED_WORK_LOG}`);
}

export function extractNamedPackConfs(docText: string): NamedPackRef[] {
  const out: NamedPackRef[] = [];
  const seen = new Set<string>();
  PACK_CONF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PACK_CONF_RE.exec(docText)) !== null) {
    const stem = m[1];
    const namedPath = `swarmforge/packs/${stem}.conf`;
    if (seen.has(namedPath)) continue;
    seen.add(namedPath);
    out.push({ namedPath, stem });
  }
  return out;
}

function asDocSources(docs: readonly DocSource[] | readonly string[]): DocSource[] {
  return docs.map((d) => (typeof d === 'string' ? { text: d } : d));
}

function toPathSet(paths: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return paths instanceof Set ? paths : new Set(paths);
}

/** True when the named pack is a real (non-placeholder) path missing from the tree. */
function isMissingRealPack(ref: NamedPackRef, existing: ReadonlySet<string>): boolean {
  return !isIllustrativePackPlaceholder(ref.stem) && !existing.has(ref.namedPath);
}

function collectAbsentPacks(
  doc: DocSource,
  existing: ReadonlySet<string>,
  absent: Set<string>
): void {
  if (isShippedWorkLog(doc.relativePath)) return;
  for (const ref of extractNamedPackConfs(doc.text)) {
    if (isMissingRealPack(ref, existing)) absent.add(ref.namedPath);
  }
}

/**
 * Among pack confs named in docs, return those absent from the tree and
 * not illustrative placeholders. Skips the shipped-work log by path.
 */
export function findAbsentNamedPackConfs(
  docs: readonly DocSource[] | readonly string[],
  existingPackPaths: ReadonlySet<string> | readonly string[]
): string[] {
  const existing = toPathSet(existingPackPaths);
  const absent = new Set<string>();
  for (const doc of asDocSources(docs)) {
    collectAbsentPacks(doc, existing, absent);
  }
  return [...absent].sort();
}
