/**
 * BL-1082: named-model CLI flag dictionary (value + boolean appliers).
 *
 * Isolated from parse orchestration so mutation-site counts stay tractable
 * and each module keeps a single responsibility.
 */
import type { NamedModelCliArgs } from './namedModelCliArgsTypes';

export type ValueFlagApplier = (args: NamedModelCliArgs, value: string) => void;
export type BoolFlagApplier = (args: NamedModelCliArgs) => void;

export const VALUE_FLAGS: Readonly<Record<string, ValueFlagApplier>> = {
  '--store': (args, value) => {
    args.modelStorePath = value;
  },
  '--repo': (args, value) => {
    args.repoRoot = value;
  },
  '--endpoint': (args, value) => {
    args.endpointUrl = value;
    args.probe = { ...args.probe, endpointUrl: value };
  },
  '--present': (args, value) => {
    args.presentModelIds.push(value);
  },
};

export const BOOL_FLAGS: Readonly<Record<string, BoolFlagApplier>> = {
  '--execute': (args) => {
    args.execute = true;
  },
  '--healthy': (args) => {
    args.probe = { endpointStatus: 'healthy', endpointUrl: args.endpointUrl };
  },
};

export function takeFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
