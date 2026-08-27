/**
 * BL-1174 — /deprecate operator verbs: ranked stale-rule scan, one retirement
 * per confirm, docs/deprecated stubs linked from docs/index.md.
 */
import { runCliMain } from './swarm-metrics';
import { main as deprecateMain } from './deprecate/cli';

export * from './deprecate/types';
export {
  seatAllowsDeprecate,
  seatRefuseReason,
  exceedsEnvelope,
  rankStaleItems,
  adjudicateTop,
} from './deprecate/policy';
export { applyRetirement, retireOrphanConfFlag } from './deprecate/retire';
export { runDeprecate } from './deprecate/run';
export { renderDeprecateReport } from './deprecate/report';
export { parseConfFlagNames, orphanConfSignals, scanOrphanConfFlags } from './deprecate/scan';
export { parseDeprecateArgs, runDeprecateCli, main } from './deprecate/cli';

if (require.main === module) {
  runCliMain(deprecateMain);
}