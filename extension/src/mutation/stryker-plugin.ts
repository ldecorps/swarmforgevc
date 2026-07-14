// Referenced from extension/stryker.config.json's "plugins" array (compiled
// to out/mutation/stryker-plugin.js). Registers MutationProgressReporter
// under the reporter name "mutation-progress", listed alongside
// "clear-text"/"progress" in that config's "reporters" array.

import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { MutationProgressReporter } from './mutationProgressReporter';

export const strykerPlugins = [declareClassPlugin(PluginKind.Reporter, 'mutation-progress', MutationProgressReporter)];
