#!/usr/bin/env node
/**
 * BL-259: the runnable dependency-rule gate the architect runs (replacing
 * the prose "check module boundaries, dependency direction" instruction).
 * Shells to the pinned dependency-cruiser CLI (package.json/lockfile pin
 * the exact version - see .dependency-cruiser.cjs for the ruleset itself,
 * versioned project source, not generated), then hands its JSON output to
 * dependencyGate.ts's pure parseDependencyCruiserOutput/formatBounceNote -
 * this file owns only the real subprocess wiring, never the pass/fail
 * derivation itself.
 *
 * Usage:
 *   node dependency-gate.js                    # full-repo mode: scans src + media
 *   node dependency-gate.js <file> [<file> ...] # per-parcel mode: scans only these
 *
 * Exit code 0 on a clean pass, 1 on any forbidden edge (hard fail) - the
 * architect's own pass/bounce judgment reads this exit code plus the
 * printed bounce note, exactly like the hardener's no-surviving-mutants
 * gate.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DependencyGateResult,
  DependencyViolation,
  parseDependencyCruiserOutput,
  mergeDependencyGateResults,
  scanTextForStorageGlobal,
  renderGateOutcome,
} from '../quality/dependencyGate';
import { runCliMain } from './swarm-metrics';

const EXTENSION_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_CONFIG_PATH = path.join(EXTENSION_ROOT, '.dependency-cruiser.cjs');
const DEFAULT_SCOPE_PATHS = ['src', 'media'];
// Resolved by ABSOLUTE path, not `npx depcruise` - npx resolves a local
// binary by walking up from its OWN cwd, which fails (and falls back to a
// registry lookup of an unrelated package literally named "depcruise") for
// any cwd outside this checkout's own node_modules tree - e.g. an isolated
// fixture directory in a unit test. The pinned binary always lives at this
// exact path regardless of the depcruise subprocess's own cwd (which only
// affects ITS source-file resolution, not this tool's own binary lookup).
const DEPCRUISE_BIN = path.join(EXTENSION_ROOT, 'node_modules', '.bin', 'depcruise');

export interface DependencyGateCliArgs {
  scopePaths: string[];
}

// Pure - full-repo mode (no args) vs per-parcel mode (changed files as
// positional args), matching the ticket's own scope-changed-vs-full-05
// scenario.
export function parseArgs(argv: string[]): DependencyGateCliArgs {
  return { scopePaths: argv.length > 0 ? argv : DEFAULT_SCOPE_PATHS };
}

// Real subprocess wiring, injectable (cwd/configPath) so tests can point
// it at an isolated fixture tree with its own mirrored src/media layout
// and the SAME pinned ruleset, without needing a live run against the
// whole real repo for every test. --output-type json exits 0 REGARDLESS
// of whether violations were found (verified empirically) - the pass/fail
// decision is this wrapper's own, via parseDependencyCruiserOutput below,
// never the subprocess's exit code.
export function runDependencyCruiser(
  scopePaths: string[],
  cwd: string = EXTENSION_ROOT,
  configPath: string = DEFAULT_CONFIG_PATH
): string {
  return execFileSync(DEPCRUISE_BIN, ['--config', configPath, '--output-type', 'json', ...scopePaths], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Real fs walk of every .js file under a media/ scope path - the only
// realistic file type/location for the view-layer localStorage/
// sessionStorage global-usage check (QA bounce 6747a4812d), since
// dependency-cruiser's own import-graph analysis structurally cannot see
// a bare global reference. Non-media scope paths (e.g. 'src', a changed
// src/*.ts file) contribute nothing here - correctly, since the rule only
// ever applied to the view layer.
function walkJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function isMediaScopePath(scopePath: string): boolean {
  return scopePath === 'media' || scopePath.startsWith('media/');
}

// QA bounce (2nd pass, CRAP=6.04): the per-scope-path try/stat/isDirectory/
// endsWith handling, split out of findMediaJsFiles's own loop so each
// function's complexity - and CRAP score - stays low independently.
function mediaJsFilesForScopePath(cwd: string, scopePath: string): string[] {
  const fullPath = path.join(cwd, scopePath);
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return [];
  }
  if (stat.isDirectory()) {
    return walkJsFiles(fullPath).map((f) => path.relative(cwd, f));
  }
  return scopePath.endsWith('.js') ? [scopePath] : [];
}

function findMediaJsFiles(cwd: string, scopePaths: string[]): string[] {
  const results: string[] = [];
  for (const scopePath of scopePaths) {
    if (isMediaScopePath(scopePath)) {
      results.push(...mediaJsFilesForScopePath(cwd, scopePath));
    }
  }
  return results;
}

export function scanMediaFilesForStorageGlobals(cwd: string, scopePaths: string[]): DependencyViolation[] {
  return findMediaJsFiles(cwd, scopePaths)
    .map((relPath) => scanTextForStorageGlobal(relPath, fs.readFileSync(path.join(cwd, relPath), 'utf8')))
    .filter((v): v is DependencyViolation => v !== null);
}

// The full gate: dependency-cruiser's import-graph rules PLUS the
// supplementary global-usage scan, merged into one result - injectable
// (cwd/configPath) for the same reason runDependencyCruiser is.
export function runGate(
  scopePaths: string[],
  cwd: string = EXTENSION_ROOT,
  configPath: string = DEFAULT_CONFIG_PATH
): DependencyGateResult {
  const rawJson = runDependencyCruiser(scopePaths, cwd, configPath);
  const depcruiseResult = parseDependencyCruiserOutput(rawJson);
  const supplementaryViolations = scanMediaFilesForStorageGlobals(cwd, scopePaths);
  return mergeDependencyGateResults(depcruiseResult, supplementaryViolations);
}

export function main(): void {
  const { scopePaths } = parseArgs(process.argv.slice(2));
  const result = runGate(scopePaths);
  const outcome = renderGateOutcome(result);
  console.log(outcome.text);
  process.exitCode = outcome.exitCode;
}

if (require.main === module) {
  runCliMain(main);
}
