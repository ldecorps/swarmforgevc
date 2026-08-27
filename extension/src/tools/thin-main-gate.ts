#!/usr/bin/env node
/**
 * BL-534: thin-main gate CLI. Keeps main() a thin exported wrapper for
 * files under extension/src/tools/. Pure pass/fail lives in
 * quality/thinMainGate.ts — this file is the thin CLI wrapper (dogfood).
 *
 * Usage:
 *   node thin-main-gate.js                         # full-repo tools tree
 *   node thin-main-gate.js <file> [<file> ...]     # parcel mode
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  ThinMainMode,
  evaluateThinMainSources,
  parseAllowlist,
} from '../quality/thinMainGate';
import { runCliMain } from './swarm-metrics';

const EXTENSION_ROOT = path.join(__dirname, '..', '..');
const ALLOWLIST_BASENAME = 'thin-main-allowlist.txt';

export interface ThinMainCliArgs {
  mode: ThinMainMode;
  paths: string[];
}

export function parseArgs(argv: string[]): ThinMainCliArgs {
  if (argv.length === 0) {
    return { mode: 'full', paths: [] };
  }
  return { mode: 'parcel', paths: argv };
}

function isPathUnder(root: string, filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

export function resolveScanFiles(args: ThinMainCliArgs, extensionRoot: string = EXTENSION_ROOT): string[] {
  const toolsRoot = path.join(extensionRoot, 'src', 'tools');
  if (args.mode === 'full') {
    return walkTsFiles(toolsRoot);
  }
  return args.paths.map((p) => path.resolve(p)).filter((p) => isPathUnder(toolsRoot, p));
}

export function loadAllowlist(extensionRoot: string = EXTENSION_ROOT): Set<string> {
  const allowPath = path.join(extensionRoot, ALLOWLIST_BASENAME);
  if (!fs.existsSync(allowPath)) {
    return new Set();
  }
  return parseAllowlist(fs.readFileSync(allowPath, 'utf8'));
}

export function runThinMainGate(args: ThinMainCliArgs, extensionRoot: string = EXTENSION_ROOT): {
  text: string;
  exitCode: number;
} {
  const files = resolveScanFiles(args, extensionRoot).map((filePath) => ({
    filePath,
    sourceText: fs.readFileSync(filePath, 'utf8'),
  }));
  const allowlist = args.mode === 'full' ? loadAllowlist(extensionRoot) : new Set<string>();
  const result = evaluateThinMainSources(files, args.mode, allowlist);
  return { text: result.report, exitCode: result.exitCode };
}

export function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outcome = runThinMainGate(args);
  if (outcome.text) {
    console.log(outcome.text);
  }
  process.exitCode = outcome.exitCode;
}

if (require.main === module) {
  runCliMain(main);
}
