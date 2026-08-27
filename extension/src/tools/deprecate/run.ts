import { adjudicateTop, rankStaleItems, seatAllowsDeprecate, seatRefuseReason } from './policy';
import { retireOrphanConfFlag } from './retire';
import type { DeprecateIo, DeprecateResult, StaleItem } from './types';

export function runDeprecate(io: DeprecateIo): DeprecateResult {
  if (!seatAllowsDeprecate(io.seatTier)) {
    return { outcome: 'refused', reason: seatRefuseReason() };
  }
  const items = rankStaleItems(io.signals);
  if (items.length === 0) {
    return { outcome: 'nothing-ranked' };
  }
  if (io.mode === 'dry') {
    return { outcome: 'ranked', dry: true, items };
  }
  return confirmTop(items[0], io);
}

function confirmTop(top: StaleItem, io: DeprecateIo): DeprecateResult {
  const decision = adjudicateTop(top);
  if (decision.action === 'refuse-envelope') {
    return { outcome: 'refused', reason: decision.reason ?? 'oversized' };
  }
  if (decision.action === 'human-ask') {
    return {
      outcome: 'human-ask',
      subject: top.subject,
      reason: decision.reason ?? 'ambiguous',
    };
  }
  if (decision.action === 'defect') {
    return {
      outcome: 'defect',
      subject: top.subject,
      reason: decision.reason ?? 'specifier adjudication',
      closesTicket: false,
    };
  }
  const retired = retireOrphanConfFlag({
    subject: top.subject,
    readFile: io.readFile,
    writeFile: io.writeFile,
    confPath: io.confPath,
    indexPath: io.indexPath,
  });
  return {
    outcome: 'retired',
    subject: top.subject,
    stubPath: retired.stubPath,
    indexLinked: true,
  };
}
