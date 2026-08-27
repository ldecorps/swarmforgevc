#!/usr/bin/env node
/**
 * BL-1174: /deprecate CLI — dry ranks; confirm retires one; check wraps BL-1173.
 *
 * Usage:
 *   node deprecate.js <project-root> dry
 *   node deprecate.js <project-root> confirm
 *   node deprecate.js <project-root> check <BL-id>
 *   node deprecate.js <project-root> --seat-tier hard dry
 */
import * as fs from 'fs';
import * as path from 'path';

import { deprecateCheck } from '../deprecate-check';
import { makeArgsGuardedMain, runCliMain } from '../swarm-metrics';
import { renderDeprecateReport } from './report';
import { runDeprecate } from './run';
import { scanOrphanConfFlags } from './scan';
import type { DeprecateMode, SeatTier } from './types';

export interface ParsedDeprecateArgs {
  root: string;
  mode: DeprecateMode | 'check';
  seatTier: SeatTier | undefined;
  checkId?: string;
}

function parseSeatTier(raw: string | undefined): SeatTier | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  if (t === 'hard' || t === 'easy' || t === 'weak') return t;
  return undefined;
}

export function parseDeprecateArgs(argv: string[]): ParsedDeprecateArgs | null {
  const args = [...argv];
  let seatTier: SeatTier | undefined;
  const seatIdx = args.indexOf('--seat-tier');
  if (seatIdx >= 0) {
    seatTier = parseSeatTier(args[seatIdx + 1]);
    args.splice(seatIdx, 2);
  }
  const root = args[0];
  const cmd = (args[1] ?? '').toLowerCase();
  if (!root || !cmd) return null;
  if (cmd === 'dry' || cmd === 'confirm') {
    return { root, mode: cmd, seatTier };
  }
  if (cmd === 'check') {
    const checkId = args[2];
    if (!checkId) return null;
    return { root, mode: 'check', seatTier, checkId };
  }
  return null;
}

function fsIo(root: string) {
  return {
    writeFile: (rel: string, content: string) => {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    },
    readFile: (rel: string) => {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) return null;
      return fs.readFileSync(full, 'utf8');
    },
  };
}

export function runDeprecateCli(parsed: ParsedDeprecateArgs): string {
  if (parsed.mode === 'check') {
    const d = deprecateCheck(parsed.root, parsed.checkId!);
    return JSON.stringify(d);
  }
  const io = fsIo(parsed.root);
  const result = runDeprecate({
    mode: parsed.mode,
    seatTier: parsed.seatTier,
    signals: scanOrphanConfFlags(parsed.root),
    ...io,
  });
  return renderDeprecateReport(result);
}

export const main = makeArgsGuardedMain(
  parseDeprecateArgs,
  'Usage: deprecate.js <root> dry|confirm|check <BL-id> [--seat-tier hard|easy|weak]\n',
  async (parsed) => {
    process.stdout.write(`${runDeprecateCli(parsed)}\n`);
  }
);

if (require.main === module) {
  runCliMain(main);
}
