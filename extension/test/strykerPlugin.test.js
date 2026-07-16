const assert = require('node:assert/strict');
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
