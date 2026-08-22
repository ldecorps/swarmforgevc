/**
 * BL-1014 — readers (the only IO, and it only reads). See ./index.ts for the
 * module's overall design note.
 *
 * Each reader is injected as a seam so the ranking above is drivable with no
 * repository at all, and so a source that is simply not available on this
 * checkout degrades to `available: false` rather than taking the scan down.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { CountedPath, HardeningLedgerRow, SourceReaders } from './types';

/**
 * The ledger is read through its OWN CLI, hardening_debt_ledger_read.bb, and
 * never by parsing the YAML: that ledger's header says so explicitly, and its
 * reader already decodes file_set into an array so no caller re-parses the
 * on-disk row shape. Shelling out is also what keeps this read-only - the
 * reader takes no write path.
 */
export function readHardeningLedger(root: string): HardeningLedgerRow[] {
  const cli = path.join(root, 'swarmforge', 'scripts', 'hardening_debt_ledger_read.bb');
  if (!fs.existsSync(cli)) return [];
  const out = execFileSync('bb', [cli, root], { encoding: 'utf8' });
  const rows = JSON.parse(out);
  return Array.isArray(rows) ? rows : [];
}

export function readBounceLines(root: string): string[] {
  const dir = path.join(root, '.swarmforge', 'bounces');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()                       // deterministic order, never readdir order
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n'));
}

/**
 * crapReport.js READS the existing coverage report and prints; it writes
 * nothing, so running it keeps the scan read-only. It exits non-zero when
 * functions are flagged - that is its gate behaviour, not a failure, so the
 * stdout is taken either way. With no coverage report it exits 1 having
 * printed nothing, which surfaces as an unavailable source rather than as
 * "clean".
 */
export function readCrapReport(root: string): string {
  const script = path.join(root, 'extension', 'scripts', 'crapReport.js');
  if (!fs.existsSync(script)) return '';
  try {
    return execFileSync('node', [script], { cwd: path.join(root, 'extension'), encoding: 'utf8' });
  } catch (err) {
    const e = err as { stdout?: string };
    return typeof e.stdout === 'string' ? e.stdout : '';
  }
}

export function readDuplicationReport(root: string): string {
  const ext = path.join(root, 'extension');
  if (!fs.existsSync(path.join(ext, '.jscpd.json'))) return '';
  try {
    return execFileSync('npx', ['jscpd', '--config', '.jscpd.json', 'src'], {
      cwd: ext,
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { stdout?: string };
    return typeof e.stdout === 'string' ? e.stdout : '';
  }
}

/**
 * Runtime/ops bloat. Thresholds are declared here rather than discovered, so
 * two runs over the same tree agree; the operator's own 2026-08-21 examples
 * (694 rotated handoffd archives, a 797-entry daemon dir) sit well above them.
 */
export const BLOAT_THRESHOLDS: Array<{ rel: string; threshold: number }> = [
  { rel: '.swarmforge/daemon', threshold: 100 },
  { rel: '.swarmforge/handoffs/inbox/completed', threshold: 500 },
  { rel: '.swarmforge/bounces', threshold: 200 },
];

export function readCountedPaths(root: string): CountedPath[] {
  return BLOAT_THRESHOLDS.map(({ rel, threshold }) => {
    const dir = path.join(root, rel);
    const count = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    return { path: rel, count, threshold };
  });
}

export const defaultReaders: SourceReaders = {
  hardeningLedger: readHardeningLedger,
  bounceLines: readBounceLines,
  crapReport: readCrapReport,
  duplicationReport: readDuplicationReport,
  countedPaths: readCountedPaths,
};
