#!/usr/bin/env node
/**
 * BL-249: stamps the PWA service worker's CACHE_NAME with a hash of the
 * shell assets it actually caches, run by the Pages deploy workflow AFTER
 * it assembles _site/ (the served tree) - so a deploy that changes any
 * shell asset yields a different CACHE_NAME (the SW's own activate handler
 * already purges the old cache once CACHE_NAME changes; that logic is
 * untouched, see pwa/sw.js) and a byte-identical shell yields the SAME
 * name (no forced re-download).
 *
 * pwa/sw.js's SHELL_ASSETS array stays the single source of truth for
 * which files matter - this tool parses it out of the real sw.js source
 * (never a separately-maintained duplicate list, which would silently
 * drift) rather than executing sw.js itself (it references browser-only
 * globals like `self`/`caches`, not runnable under Node).
 *
 * GitHub Actions safety (engineering rule / BL-092): the hash is computed
 * entirely here, over real files read by Node - the workflow step that
 * calls this tool needs no ${{ }} expression in its run: body at all.
 *
 * Usage: node stamp-pwa-cache-name.js <site-dir>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { runCliMain } from './swarm-metrics';

export const CACHE_NAME_PLACEHOLDER = '__PWA_CACHE_NAME_PLACEHOLDER__';

// Never executes sw.js - a plain regex over its source text for the one
// array literal this tool needs. Assumes SHELL_ASSETS is declared as a
// single-line array of single-quoted string literals (matching pwa/sw.js's
// existing style); a hand-authored constant this simple is not expected to
// grow more complex than that.
export function extractShellAssetPaths(swJsSource: string): string[] {
  const match = swJsSource.match(/const SHELL_ASSETS = \[([^\]]*)\];/);
  if (!match) {
    throw new Error('could not find a `const SHELL_ASSETS = [...]` array literal in sw.js');
  }
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

// SHELL_ASSETS carries './' (the root request, served as index.html but not
// a distinct file on disk) alongside real relative paths like
// './index.html' - this strips the './' prefix and drops the bare-root
// entry, which has no separate file to hash.
export function toRelativeFilePath(assetPath: string): string | null {
  const stripped = assetPath.replace(/^\.\//, '');
  return stripped === '' ? null : stripped;
}

// Pure: order-sensitive (SHELL_ASSETS' own declared order), matching
// stampPwaCacheName's read order below so the hash is deterministic run to
// run for byte-identical content. Truncated to 12 hex chars - collision-
// irrelevant for a cache-busting key (it only needs to differ when content
// differs), and keeps CACHE_NAME readable in devtools.
export function computeShellContentHash(fileContents: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const content of fileContents) {
    hash.update(content, 'utf8');
  }
  return hash.digest('hex').slice(0, 12);
}

export function deriveCacheName(hash: string): string {
  return `swarmforge-dashboard-${hash}`;
}

export function stampCacheName(swJsSource: string, cacheName: string): string {
  if (!swJsSource.includes(CACHE_NAME_PLACEHOLDER)) {
    throw new Error(`sw.js did not contain the expected placeholder "${CACHE_NAME_PLACEHOLDER}"`);
  }
  return swJsSource.replace(CACHE_NAME_PLACEHOLDER, cacheName);
}

// The one IO-touching entry point: reads sw.js + every real shell asset
// from siteDir (the ALREADY-ASSEMBLED served tree, so the hash covers
// exactly what a browser will fetch), stamps sw.js's CACHE_NAME in place,
// and returns the derived name.
export function stampPwaCacheNameInPlace(siteDir: string): string {
  const swJsPath = path.join(siteDir, 'sw.js');
  const swJsSource = fs.readFileSync(swJsPath, 'utf8');

  const assetPaths = extractShellAssetPaths(swJsSource)
    .map(toRelativeFilePath)
    .filter((p): p is string => p !== null);
  const fileContents = assetPaths.map((assetPath) => fs.readFileSync(path.join(siteDir, assetPath), 'utf8'));

  const cacheName = deriveCacheName(computeShellContentHash(fileContents));
  fs.writeFileSync(swJsPath, stampCacheName(swJsSource, cacheName), 'utf8');
  return cacheName;
}

export function main(): void {
  const siteDir = process.argv[2];
  if (!siteDir) {
    throw new Error('Usage: node stamp-pwa-cache-name.js <site-dir>');
  }
  const cacheName = stampPwaCacheNameInPlace(siteDir);
  process.stdout.write(`Stamped sw.js CACHE_NAME = ${cacheName}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
