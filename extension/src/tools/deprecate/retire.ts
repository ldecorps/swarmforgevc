import {
  DEFAULT_CONF_PATH,
  DEFAULT_INDEX_PATH,
  DEPRECATED_SECTION_HEADING,
} from './types';

function removeConfFlag(confText: string, flag: string): string {
  const re = new RegExp(`^config\\s+${escapeRegExp(flag)}\\b.*\\n?`, 'm');
  return confText.replace(re, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stubPathFor(subject: string): string {
  const safe = subject.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return `docs/deprecated/${safe}.md`;
}

function stubBody(subject: string): string {
  return [
    `# Deprecated: \`${subject}\``,
    '',
    `The conf flag \`${subject}\` was retired by \`/deprecate\`.`,
    'Living how-to and reference docs must not describe this behaviour.',
    '',
  ].join('\n');
}

function ensureDeprecatedIndexLink(indexText: string, stubRel: string): string {
  const linkLine = `- [${stubRel.replace(/^docs\//, '')}](${stubRel.replace(/^docs\//, '')})`;
  if (indexText.includes(DEPRECATED_SECTION_HEADING)) {
    if (indexText.includes(stubRel.replace(/^docs\//, ''))) {
      return indexText;
    }
    return indexText.replace(
      DEPRECATED_SECTION_HEADING,
      `${DEPRECATED_SECTION_HEADING}\n${linkLine}`
    );
  }
  const suffix = indexText.endsWith('\n') ? '' : '\n';
  return `${indexText}${suffix}\n${DEPRECATED_SECTION_HEADING}\n${linkLine}\n`;
}

export const applyRetirement = {
  removeConfFlag,
  stubPathFor,
  stubBody,
  ensureDeprecatedIndexLink,
  DEFAULT_CONF_PATH,
  DEFAULT_INDEX_PATH,
};

export function retireOrphanConfFlag(opts: {
  subject: string;
  readFile: (p: string) => string | null;
  writeFile: (p: string, c: string) => void;
  confPath?: string;
  indexPath?: string;
}): { stubPath: string; indexLinked: true } {
  const confPath = opts.confPath ?? DEFAULT_CONF_PATH;
  const indexPath = opts.indexPath ?? DEFAULT_INDEX_PATH;
  const conf = opts.readFile(confPath);
  if (conf == null) {
    throw new Error(`missing ${confPath}`);
  }
  opts.writeFile(confPath, removeConfFlag(conf, opts.subject));
  const stubPath = stubPathFor(opts.subject);
  opts.writeFile(stubPath, stubBody(opts.subject));
  const index = opts.readFile(indexPath) ?? '# Docs\n';
  opts.writeFile(indexPath, ensureDeprecatedIndexLink(index, stubPath));
  return { stubPath, indexLinked: true };
}
