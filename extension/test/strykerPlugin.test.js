const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { strykerPlugins } = require('../out/mutation/stryker-plugin');
const { EntrypointBoilerplateIgnorer } = require('../out/mutation/entrypointBoilerplateIgnorer');

// BL-447: a pure predicate with zero live callers is a dark feature
// (engineering.prompt wiring rule) - this proves EntrypointBoilerplateIgnorer
// is actually registered in the array extension/stryker.config.json's own
// appendPlugins loads, not merely defined and never wired in.
test('BL-447: strykerPlugins registers EntrypointBoilerplateIgnorer as an Ignore-kind plugin', () => {
  const ignorePlugin = strykerPlugins.find((p) => p.kind === 'Ignore');
  assert.ok(ignorePlugin, `expected an Ignore-kind plugin among: ${JSON.stringify(strykerPlugins.map((p) => p.kind))}`);
  assert.equal(ignorePlugin.name, 'entrypoint-boilerplate');
  assert.equal(ignorePlugin.injectableClass, EntrypointBoilerplateIgnorer);
});

test('BL-447: the pre-existing Reporter plugin is untouched by adding the Ignorer', () => {
  const reporterPlugin = strykerPlugins.find((p) => p.kind === 'Reporter');
  assert.ok(reporterPlugin);
  assert.equal(reporterPlugin.name, 'mutation-progress');
});

// BL-447 (cleaner): registering an Ignore-kind plugin in strykerPlugins only makes it
// AVAILABLE - Stryker only ever calls shouldIgnore on plugins named in the separate
// `ignorers` config array (`options.ignorers.map(name => pluginCreator.create(...))` in
// @stryker-mutator/core's mutant-instrumenter-executor). Without this exact name present
// there too, EntrypointBoilerplateIgnorer is registered but never invoked and every
// boilerplate mutant it exists to exclude still gets created and reported - confirmed by a
// real scoped run against this file: 0 "Ignored" mutants and all 130 candidates still
// created before this config line was added. This test pins the registration name and the
// config activation name to the SAME source of truth so they cannot drift apart silently.
test('BL-447: stryker.config.json actually activates the registered Ignore plugin by name', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../stryker.config.json'), 'utf8'));
  const ignorePlugin = strykerPlugins.find((p) => p.kind === 'Ignore');
  assert.ok(Array.isArray(config.ignorers), 'stryker.config.json must declare an ignorers array');
  assert.ok(
    config.ignorers.includes(ignorePlugin.name),
    `expected config.ignorers ${JSON.stringify(config.ignorers)} to include the registered plugin name "${ignorePlugin.name}"`
  );
});
