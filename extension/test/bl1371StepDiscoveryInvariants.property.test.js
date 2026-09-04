// BL-1371's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The set of handlers loaded after this change equals or
//                contains the set loaded today, compared as a SET of handler
//                identities and never as a count.
//   invariant 2  A handler file that cannot be loaded fails the run loudly,
//                naming the file; discovery never silently skips what it
//                could not require.
//   invariant 3  Registering a new handler requires editing no file that
//                another ticket also edits.
//
// All three drive the REAL discovery module with an injected directory, which
// is where the whole question lives: the module's only inputs are a directory
// listing and a require, and both are seams it already takes.
//
// Generator reach is asserted, not hoped for (BL-654): every draw's directory
// is BUILT to contain the shapes the invariants quantify over - a throwing
// file for invariant 2 is planted by construction in that lane rather than
// waited for, because a uniformly drawn directory would contain one only
// rarely and the property would pass for the wrong reason.

import assert from 'node:assert/strict';
import fc from 'fast-check';
import path from 'node:path';
import { describe, test } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  HANDLER_FILE_SUFFIX,
  stepHandlerFileNames,
  loadStepHandlerModules,
  registerDiscoveredSteps,
} = require('../../specs/pipeline/steps/discoverStepHandlers');
const { createStepRegistry } = require('../../specs/pipeline/stepRegistry');

const DIR = '/steps';
const RUNS = 300;

const KINDS = ['handler', 'inert', 'throwing', 'nonHandlerName', 'directory'];

const baseName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,10}$/);

/** One directory entry: a name plus how requiring it behaves. */
const entryArb = fc.record({ stem: baseName, kind: fc.constantFrom(...KINDS) });

function materialize(entries) {
  // Names are made unique per kind so a draw of duplicate stems is still a
  // well-formed directory rather than a silently collapsed one.
  const seen = new Set();
  const files = [];
  const dirs = [];
  entries.forEach((entry, i) => {
    const stem = seen.has(entry.stem) ? `${entry.stem}${i}` : entry.stem;
    seen.add(stem);
    if (entry.kind === 'directory') {
      dirs.push({ name: `${stem}${HANDLER_FILE_SUFFIX}`, kind: 'directory' });
      return;
    }
    const name = entry.kind === 'nonHandlerName' ? `${stem}Helper.js` : `${stem}${HANDLER_FILE_SUFFIX}`;
    files.push({ name, kind: entry.kind });
  });
  return { files, dirs };
}

function stubs({ files, dirs }) {
  const byName = new Map(files.map((file) => [file.name, file]));
  const requiredPaths = [];
  const readdir = () => [
    ...files.map((file) => ({ name: file.name, isDirectory: () => false })),
    ...dirs.map((dir) => ({ name: dir.name, isDirectory: () => true })),
  ];
  const requireModule = (full) => {
    requiredPaths.push(full);
    const file = byName.get(path.basename(full));
    if (!file) {
      throw new Error(`the module required a name the directory does not hold: ${full}`);
    }
    if (file.kind === 'throwing') {
      throw new Error(`fixture: ${file.name} cannot be loaded`);
    }
    if (file.kind === 'inert') {
      return { notAHandler: true };
    }
    return {
      registerSteps(registry) {
        registry.define(new RegExp(`^a step from ${file.name}$`), () => {});
      },
    };
  };
  return { readdir, requireModule, requiredPaths };
}

/** Handler identity = the file the steps came from. */
function expectedIdentities({ files }) {
  return new Set(files.filter((file) => file.kind === 'handler').map((file) => file.name));
}

describe('BL-1371 declared invariants', () => {
  test('invariant 1: the loaded handler set is exactly the handler files present, as a SET', () => {
    const coverage = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 12 }), (entries) => {
        const dir = materialize(entries);
        for (const file of dir.files) coverage[file.kind] += 1;
        coverage.directory += dir.dirs.length;
        const { readdir, requireModule } = stubs(dir);
        const unloadable = dir.files.filter((file) => file.kind === 'throwing');
        if (unloadable.length > 0) {
          // Invariant 2's lane owns this shape; here it is enough that the
          // set question is not silently answered on a directory that cannot
          // be loaded at all.
          assert.throws(() => loadStepHandlerModules(DIR, { readdir, requireModule }));
          return;
        }
        const loaded = new Set(loadStepHandlerModules(DIR, { readdir, requireModule }).map((e) => e.name));
        const expected = expectedIdentities(dir);
        // Set comparison in BOTH directions - a count match is not evidence.
        const missing = [...expected].filter((name) => !loaded.has(name));
        const extra = [...loaded].filter((name) => !expected.has(name));
        assert.deepEqual(missing, [], `handlers present but not loaded: ${missing.join(', ')}`);
        assert.deepEqual(extra, [], `loaded something that is not a handler: ${extra.join(', ')}`);
      }),
      { numRuns: RUNS }
    );
    // Asserted reachability floor, never a hoped-for one.
    for (const kind of KINDS) {
      assert.ok(coverage[kind] >= 20, `generator under-reached ${kind}: ${JSON.stringify(coverage)}`);
    }
  });

  test('invariant 2: any unloadable handler fails the load, names the file, and registers nothing', () => {
    let deepestPosition = 0;
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 0, maxLength: 10 }),
        baseName,
        fc.nat(),
        (entries, badStem, where) => {
          const dir = materialize(entries);
          // The throwing file is planted BY CONSTRUCTION, and at a drawn
          // position, so the property also reaches the case where healthy
          // handlers sort before it - the one where a partial registration
          // could otherwise slip through.
          const bad = { name: `${badStem}zzBadSteps.js`, kind: 'throwing' };
          const at = dir.files.length === 0 ? 0 : where % (dir.files.length + 1);
          dir.files.splice(at, 0, bad);
          const sortedNames = dir.files.map((f) => f.name).sort();
          deepestPosition = Math.max(deepestPosition, sortedNames.indexOf(bad.name));
          // Discovery loads in name order and stops at the FIRST file it
          // cannot require, so that is the file the failure must name - which
          // is `bad` unless the draw itself planted an unloadable file
          // sorting ahead of it.
          const firstUnloadable = sortedNames.find(
            (name) => dir.files.find((f) => f.name === name).kind === 'throwing'
          );
          const { readdir, requireModule } = stubs(dir);
          const registry = createStepRegistry();
          assert.throws(
            () => registerDiscoveredSteps(registry, DIR, { readdir, requireModule }),
            (err) => err.message.includes(firstUnloadable),
            `the failure must name ${firstUnloadable}`
          );
          assert.deepEqual(
            registry.listDefinitions(),
            [],
            'a load that failed still registered steps - a scenario could report passing'
          );
        }
      ),
      { numRuns: RUNS }
    );
    assert.ok(deepestPosition >= 3, `the throwing file never sorted after other handlers (max ${deepestPosition})`);
  });

  test('invariant 3: a new handler joins by existing - no other file is read, required or changed', () => {
    let withNeighbours = 0;
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 0, maxLength: 10 }), baseName, (entries, newStem) => {
        const before = materialize(entries);
        // A directory that cannot be loaded at all has nothing to say about
        // whether adding a file edits another one - invariant 2's lane.
        before.files = before.files.filter((file) => file.kind !== 'throwing');
        const beforeStubs = stubs(before);
        const beforeLoaded = new Set(
          loadStepHandlerModules(DIR, beforeStubs).map((e) => e.name)
        );

        const newName = `${newStem}zzNewlyAddedSteps.js`;
        // The ONLY difference between the two directories is one added file:
        // every other entry is carried over byte-identically, which is the
        // "no other file was edited" claim stated as a construction.
        const after = { files: [...before.files, { name: newName, kind: 'handler' }], dirs: before.dirs };
        if (before.files.length > 0) withNeighbours += 1;
        const afterStubs = stubs(after);
        const afterLoaded = new Set(loadStepHandlerModules(DIR, afterStubs).map((e) => e.name));

        assert.ok(afterLoaded.has(newName), 'the newly added handler was not loaded');
        const lost = [...beforeLoaded].filter((name) => !afterLoaded.has(name));
        assert.deepEqual(lost, [], `adding a handler dropped: ${lost.join(', ')}`);
        assert.deepEqual(
          [...afterLoaded].filter((name) => name !== newName).sort(),
          [...beforeLoaded].sort(),
          'adding a handler changed which other handlers load'
        );
        // Nothing outside the steps directory is consulted at all: every
        // require the module made is a file the directory itself listed.
        const listed = new Set(after.files.map((f) => f.name));
        const foreign = afterStubs.requiredPaths.filter((p) => !listed.has(path.basename(p)));
        assert.deepEqual(foreign, [], `discovery required a file outside the directory: ${foreign.join(', ')}`);
      }),
      { numRuns: RUNS }
    );
    assert.ok(withNeighbours >= 50, `the new handler was almost always alone (${withNeighbours} draws with neighbours)`);
  });

  test('invariant 1 (real directory): discovery is stable and complete over the project steps directory', () => {
    const dir = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps');
    const once = stepHandlerFileNames(dir);
    const again = stepHandlerFileNames(dir);
    assert.deepEqual(once, again, 'discovery is not deterministic over the real directory');
    assert.ok(once.length > 900, `the real handler set collapsed to ${once.length}`);
    assert.deepEqual(
      once.filter((name) => !name.endsWith(HANDLER_FILE_SUFFIX)),
      [],
      'discovery returned a name that is not a handler file'
    );
  });
});
