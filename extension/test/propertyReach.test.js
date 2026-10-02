'use strict';

// BL-1877: property_reach.js's reach rules, each on its own mkdtemp
// fixture tree (never the live checkout).

const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const { computeReach, literalSpecifiers } = require('../../swarmforge/scripts/property_reach.js');

function tree(files) {
  const root = mkTmpDir('property-reach-');
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return root;
}

const BASE = {
  'extension/vitest.properties.config.mjs': "export default { setupFiles: ['./test/helpers/setup.js'] };\n",
  'extension/test/helpers/setup.js': '\n',
  'extension/src/a.ts': 'x\n',
  'extension/out/a.js': '\n',
  'extension/src/b.ts': 'x\n',
  'extension/out/b.js': "require('./a');\n",
};

function reach(files, staged) {
  const root = tree({ ...BASE, ...files });
  const r = computeReach(root, staged);
  return r === null ? null : r.map((p) => path.relative(path.join(root, 'extension'), p)).sort();
}

describe('property_reach computeReach (BL-1877)', () => {
  it('a staged property file reaches itself', () => {
    expect(reach({ 'extension/test/p.property.test.js': '\n' }, ['extension/test/p.property.test.js'])).toEqual([
      'test/p.property.test.js',
    ]);
  });

  it('a property file outside extension/test answers ALL', () => {
    expect(reach({}, ['specs/x.property.test.js'])).toBeNull();
  });

  it('follows the literal require graph transitively, through out/ and helpers', () => {
    const files = {
      'extension/test/helpers/h.js': "require('../../out/b');\n",
      'extension/test/direct.property.test.js': "require('../out/a');\n",
      'extension/test/viaHelper.property.test.js': "require('./helpers/h');\n",
      'extension/test/unrelated.property.test.js': "require('fast-check');\n",
    };
    expect(reach(files, ['extension/src/a.ts'])).toEqual([
      'test/direct.property.test.js',
      'test/viaHelper.property.test.js',
    ]);
  });

  it('a file naming a reached out/ module with its extension is reached (a spawned CLI)', () => {
    const files = { 'extension/test/cli.property.test.js': "const CLI = path.join(OUT, 'b.js');\n" };
    expect(reach(files, ['extension/src/a.ts'])).toEqual(['test/cli.property.test.js']);
  });

  it('a whole-line comment naming the module does not reach', () => {
    const files = { 'extension/test/prose.property.test.js': "// runs 'a.js' somewhere\n" };
    expect(reach(files, ['extension/src/a.ts'])).toEqual([]);
  });

  it('a script naming the module reaches a property file that names the script (one more hop)', () => {
    const files = {
      'swarmforge/scripts/runner.bb': '(p/sh "node" "out/a.js")\n',
      'extension/test/viaScript.property.test.js': "execFileSync('bb', [path.join(S, 'runner.bb')]);\n",
    };
    expect(reach(files, ['extension/src/a.ts'])).toEqual(['test/viaScript.property.test.js']);
  });

  it('a non-literal requirer naming the module bare is reached; a literal-only file is not', () => {
    const files = {
      'extension/test/built.property.test.js': "const m = require(path.join(OUT, 'a'));\n",
      'extension/test/literal.property.test.js': "const s = 'a';\n",
    };
    expect(reach(files, ['extension/src/a.ts'])).toEqual(['test/built.property.test.js']);
  });

  it('a step-registry loader is reached when the change reaches a step handler', () => {
    const files = {
      'specs/pipeline/steps/xSteps.js': "require('../../../extension/out/a');\n",
      'extension/test/loader.property.test.js': "const r = require(registryPath); // stepRegistry\nconst x = 'stepRegistry';\n",
    };
    expect(reach(files, ['extension/src/a.ts'])).toEqual(['test/loader.property.test.js']);
  });

  it.each([
    ['a non-.ts path under extension/src', ['extension/src/x.json']],
    ['a .d.ts file', ['extension/src/a.d.ts']],
    ['a path outside extension/src', ['extension/test/helpers/h.js']],
    ['a deleted module', ['extension/src/gone.ts']],
  ])('%s answers ALL', (_label, staged) => {
    expect(reach({ 'extension/src/x.json': '{}', 'extension/src/a.d.ts': '' }, staged)).toBeNull();
  });

  it('a module with no compiled out/ file answers ALL', () => {
    expect(reach({ 'extension/src/c.ts': 'x\n' }, ['extension/src/c.ts'])).toBeNull();
  });

  it("a change reaching the lane's setup file answers ALL", () => {
    expect(reach({ 'extension/test/helpers/setup.js': "require('../../out/a');\n" }, ['extension/src/a.ts'])).toBeNull();
  });

  it('literalSpecifiers keeps relative specifiers only', () => {
    expect(literalSpecifiers("require('./x'); require('fs'); import y from '../y';")).toEqual(['./x', '../y']);
  });
});
