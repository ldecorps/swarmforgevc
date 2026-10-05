'use strict';

// BL-1972: a unit test run on a stale extension/out/ must stop before any
// test, naming the stale source file and `npm run compile`.
//
// Background: a direct `npx vitest run` on an uncompiled worktree ran the
// suite against whatever out/ happened to hold and produced a false
// BL-1951 bounce - the verdict was about stale compiled code, not about the
// code under test. The fix is a vitest globalSetup entry (wired into
// vitest.config.mjs's globalSetup, inherited by vitest.stryker.config.mjs's
// `...cfg.test` spread, so the Stryker sandbox run is covered too): it runs
// BEFORE any worker is spawned, in the main process, and a throw there
// stops the run before a single test executes.
//
// Invariant (FIRM): the check stops ONLY when a source under extension/src
// is newer than its compiled file under extension/out, or its compiled file
// is missing. It NEVER stops a run whose out/ was compiled after the
// sources - a fresh build (npm test's own `npm run compile` step, or a
// Stryker sandbox that compiled before mutating) passes clean.
//
// The pure core (staleSourceFiles) takes source/compiled paths plus an
// injected stat fn, so the unit test drives it on fake times without
// touching the real tree; the globalSetup entry (assertBuildIsFresh) calls
// it with the real fs. The source->compiled mapping is read from
// extension/tsconfig.json (rootDir/outDir), never hard-coded.
const fs = require('node:fs');
const path = require('node:path');

// tsconfig.json is JSONC (TypeScript allows // comments); JSON.parse alone
// would choke on them. Strip whole-line and trailing // comments outside
// string literals, then parse.
function parseTsconfigJson(text) {
  let out = '';
  let inString = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        i += 1;
        if (i < text.length) out += text[i];
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      if (i < text.length) out += text[i];
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

// Reads rootDir/outDir from extension/tsconfig.json (resolved relative to
// the extension root this file sits under) and maps each source file under
// rootDir to its compiled path under outDir. Returns [{ source, compiled }].
function sourceToCompiledPairs(extensionRoot) {
  const tsconfigPath = path.join(extensionRoot, 'tsconfig.json');
  const tsconfig = parseTsconfigJson(fs.readFileSync(tsconfigPath, 'utf8'));
  const rootDir = path.join(extensionRoot, tsconfig.compilerOptions.rootDir);
  const outDir = path.join(extensionRoot, tsconfig.compilerOptions.outDir);
  const pairs = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // .d.ts declaration files are type-only: tsc emits no JS for them, so
      // they have no compiled counterpart and are never stale.
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      const rel = path.relative(rootDir, full);
      // tsc emits .js for .ts sources.
      const compiledRel = rel.slice(0, -'.ts'.length) + '.js';
      pairs.push({ source: full, compiled: path.join(outDir, compiledRel) });
    }
  };
  walk(rootDir);
  return pairs;
}

// Pure: given [{ source, compiled }] pairs and a stat fn (injected so the
// unit test can drive it on fake times), returns the source files that are
// stale - their source mtime is strictly newer than the compiled mtime, or
// the compiled file is missing (stat throws). A compiled file that is the
// same age or newer than its source is fresh: the run proceeds.
function staleSourceFiles(pairs, statFn) {
  const stale = [];
  for (const { source, compiled } of pairs) {
    let sourceMtime;
    try {
      sourceMtime = statFn(source).mtimeMs;
    } catch {
      continue; // a source that vanished between listing and stat is not stale
    }
    let compiledMtime;
    try {
      compiledMtime = statFn(compiled).mtimeMs;
    } catch {
      stale.push(source); // compiled missing: the source is stale
      continue;
    }
    if (sourceMtime > compiledMtime) {
      stale.push(source);
    }
  }
  return stale;
}

// The globalSetup entry: runs the check against the real fs and throws an
// Error naming every stale/missing source file and `npm run compile` when
// the build is stale; returns nothing when fresh. Runs once in the main
// process before any worker, so a throw stops the run before any test.
//
// `statFn` is injectable (defaults to fs.statSync) so the acceptance step
// handlers can drive the SAME entry against a fixture tree with controlled
// mtimes rather than the real extension/out/.
function assertBuildIsFresh(extensionRoot = path.join(__dirname, '..', '..'), statFn = (p) => fs.statSync(p)) {
  const pairs = sourceToCompiledPairs(extensionRoot);
  const stale = staleSourceFiles(pairs, statFn);
  if (stale.length > 0) {
    const names = stale.map((s) => path.relative(extensionRoot, s)).join(', ');
    throw new Error(
      `[stale-build-guard] extension/out/ is stale: ${names} is newer than its compiled file (or the compiled file is missing). Run \`npm run compile\` before running tests.`
    );
  }
}

module.exports = { parseTsconfigJson, sourceToCompiledPairs, staleSourceFiles, assertBuildIsFresh };
