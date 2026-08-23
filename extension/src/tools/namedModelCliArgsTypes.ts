/**
 * BL-1082: named-model CLI shared argument types.
 */
import {
  DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  type NamedModelEndpointProbe,
} from '../swarm/modelServing';

export type NamedModelCommand = 'pull' | 'serve' | 'status' | 'help';

export interface NamedModelCliArgs {
  command: NamedModelCommand;
  modelId: string;
  repoRoot?: string;
  modelStorePath?: string;
  endpointUrl: string;
  execute: boolean;
  presentModelIds: string[];
  availableModelIds?: string[];
  probe: NamedModelEndpointProbe;
}

export const KNOWN_COMMANDS = new Set<NamedModelCommand>(['pull', 'serve', 'status', 'help']);

export function defaultNamedModelArgs(): NamedModelCliArgs {
  return {
    command: 'help',
    modelId: '',
    endpointUrl: DEFAULT_NAMED_MODEL_ENDPOINT_URL,
    execute: false,
    presentModelIds: [],
    probe: { endpointStatus: 'missing', endpointUrl: DEFAULT_NAMED_MODEL_ENDPOINT_URL },
  };
}
