// BL-1371: the step registry discovers handlers from their own files.
//
// BL-1038-EXEMPT: one case enumerates the REAL steps directory because that is
// the question invariant 1 asks - whether every handler file the project ships
// is discovered. A pinned fixture cannot answer it: it would prove discovery
// works on a directory nobody runs. The cost is a single readdir of one
// directory, no recursion and no file reads.
//
// Unit lane for specs/pipeline/steps/discoverStepHandlers.js (fs injected for
// every other case) plus the two consequences of the change that live in
// this package: the BL-1303 registration guard now reads reachability from
// discovery, and the JS/TS suffix constants must agree (BL-897).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
const { assessFeatureHandlerRegistration } = require('../out/tools/featureHandlerRegistrationCheck');
const { HANDLER_FILE_SUFFIX: TS_HANDLER_FILE_SUFFIX, REGISTRY_PATH, STEPS_DIR } = require('../out/tools/featureHandlerRegistrationTypes');

/** readdir stub in the `withFileTypes: true` shape the module asks for. */
function dirEntries(names, directories = []) {
  return () => [
    ...names.map((name) => ({ name, isDirectory: () => false })),
    ...directories.map((name) => ({ name, isDirectory: () => true })),
  ];
}

describe('BL-1371 step handler discovery', () => {
  test('discovers every *Steps.js file in the directory, sorted, and nothing else', () => {
    const readdir = dirEntries(
      ['bZebraSteps.js', 'aAlphaSteps.js', 'index.js', 'discoverStepHandlers.js', 'bl623Only.js', 'notes.md'],
      ['lib']
    );
    expect(stepHandlerFileNames('/steps', { readdir })).toEqual(['aAlphaSteps.js', 'bZebraSteps.js']);
  });

  test('a subdirectory whose name ends in the suffix is not a handler', () => {
    const readdir = dirEntries(['realSteps.js'], ['looksLikeSteps.js']);
    expect(stepHandlerFileNames('/steps', { readdir })).toEqual(['realSteps.js']);
  });

  test('loads only the files that export a registerSteps function', () => {
    const readdir = dirEntries(['aSteps.js', 'bSteps.js', 'cSteps.js']);
    const modules = {
      [path.join('/steps', 'aSteps.js')]: { registerSteps() {} },
      [path.join('/steps', 'bSteps.js')]: { somethingElse: true },
      [path.join('/steps', 'cSteps.js')]: { registerSteps: 'not a function' },
    };
    const loaded = loadStepHandlerModules('/steps', { readdir, requireModule: (p) => modules[p] });
    expect(loaded.map((entry) => entry.name)).toEqual(['aSteps.js']);
  });

  test('a file that throws when required fails the load, naming the file and keeping the cause', () => {
    const readdir = dirEntries(['badSteps.js', 'goodSteps.js']);
    const requireModule = (p) => {
      if (p.endsWith('badSteps.js')) {
        throw new Error('kaboom from the fixture');
      }
      return { registerSteps() {} };
    };
    expect(() => loadStepHandlerModules('/steps', { readdir, requireModule })).toThrow(/badSteps\.js/);
    expect(() => loadStepHandlerModules('/steps', { readdir, requireModule })).toThrow(/kaboom from the fixture/);
  });

  test('one unloadable handler registers NOTHING - the load completes before any registration', () => {
    const readdir = dirEntries(['aSteps.js', 'zBadSteps.js']);
    const requireModule = (p) => {
      if (p.endsWith('zBadSteps.js')) {
        throw new Error('kaboom');
      }
      return {
        registerSteps(registry) {
          registry.define(/^a step$/, () => {});
        },
      };
    };
    const registry = createStepRegistry();
    expect(() => registerDiscoveredSteps(registry, '/steps', { readdir, requireModule })).toThrow(/zBadSteps\.js/);
    expect(registry.listDefinitions()).toEqual([]);
  });

  test('registers discovered handlers in name order', () => {
    const readdir = dirEntries(['bSteps.js', 'aSteps.js']);
    const seen = [];
    const requireModule = (p) => ({
      registerSteps() {
        seen.push(path.basename(p));
      },
    });
    registerDiscoveredSteps(createStepRegistry(), '/steps', { readdir, requireModule });
    expect(seen).toEqual(['aSteps.js', 'bSteps.js']);
  });

  test('the real steps directory: every *Steps.js file on disk is discovered', () => {
    const dir = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps');
    const onDisk = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.isDirectory() && entry.name.endsWith(HANDLER_FILE_SUFFIX))
      .map((entry) => entry.name)
      .sort();
    expect(stepHandlerFileNames(dir)).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(900);
  });

  // BL-897: the same rule is stated in two languages - the JS discovery module
  // and the TS registration guard - so a test pins the literals against each
  // other rather than trusting them to be kept in step by hand.
  test('the JS and TS handler-suffix constants agree', () => {
    expect(TS_HANDLER_FILE_SUFFIX).toBe(HANDLER_FILE_SUFFIX);
  });
});

describe('BL-1303 registration guard, under discovery (BL-1371)', () => {
  const feature = 'specs/features/BL-9999-a-thing.feature';
  const handler = `${STEPS_DIR}/bl9999AThingSteps.js`;

  const DISCOVERY = `${STEPS_DIR}/discoverStepHandlers.js`;

  function tree(named, extra = {}) {
    const files = {
      [REGISTRY_PATH]: "require('./discoverStepHandlers');",
      [DISCOVERY]: '// the discovery module the registry requires\n',
      ...named,
    };
    return {
      featureFiles: [feature],
      stepFiles: Object.keys(files).filter((p) => p.startsWith(`${STEPS_DIR}/`)),
      libFiles: [],
      readFile: (p) => (p in files ? files[p] : null),
      ...extra,
    };
  }

  test('a handler file present in the steps directory is registered by existing', () => {
    const offenders = assessFeatureHandlerRegistration(
      tree({ [handler]: '// BL-9999 handler\n' })
    );
    expect(offenders).toEqual([]);
  });

  test('a handler whose name is not discovered is still reported unregistered', () => {
    const stray = `${STEPS_DIR}/bl9999AThingHandler.js`;
    const offenders = assessFeatureHandlerRegistration(
      tree({ [stray]: '// BL-9999 handler\n' })
    );
    expect(offenders).toEqual([{ kind: 'unregistered-handler', path: stray, feature }]);
  });

  test('a discovered handler reaching for an absent sibling script is still an offender', () => {
    const offenders = assessFeatureHandlerRegistration(
      tree({ [handler]: "// BL-9999\nconst s = path.join(__dirname, 'lib', 'bl9999Cli.sh');\n" })
    );
    expect(offenders).toEqual([
      { kind: 'missing-sibling-script', path: `${STEPS_DIR}/lib/bl9999Cli.sh`, handler },
    ]);
  });
});
