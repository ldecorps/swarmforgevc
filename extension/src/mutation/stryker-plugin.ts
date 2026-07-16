// Referenced from extension/stryker.config.json's "plugins" array (compiled
// to out/mutation/stryker-plugin.js). Registers MutationProgressReporter
// under the reporter name "mutation-progress", listed alongside
// "clear-text"/"progress" in that config's "reporters" array.
//
// BL-447: also registers EntrypointBoilerplateIgnorer as a PluginKind.Ignore
// plugin - the live wiring for the pure classifyMutantLocation decision
// (entrypointBoilerplateIgnorer.ts), so the require.main entrypoint guard
// and generated __esModule boilerplate are excluded from every mutation run
// automatically, never a per-file hand-annotation.

import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { MutationProgressReporter } from './mutationProgressReporter';
import { EntrypointBoilerplateIgnorer } from './entrypointBoilerplateIgnorer';

export const strykerPlugins = [
  declareClassPlugin(PluginKind.Reporter, 'mutation-progress', MutationProgressReporter),
  declareClassPlugin(PluginKind.Ignore, 'entrypoint-boilerplate', EntrypointBoilerplateIgnorer),
];
