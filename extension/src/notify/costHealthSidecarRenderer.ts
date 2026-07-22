import { TrendResult } from '../metrics/trend';
import { LlmCostHorizon, LLM_COST_HORIZONS_MS, LlmCostRollupGroup } from '../metrics/llmCostLedger';
import { chooseCostTrendAxisScale, OriginCostTrendSeries } from '../metrics/llmCostTrendSeries';
import {
  CostHealthSidecar,
  AgentDailyCost,
  ExpensiveTicket,
  CostPerTicketSummary,
  ReliabilityCounts,
  ResourceAnomaly,
} from './costHealthSidecar';

function trendArrow(trend: TrendResult): string {
  if (trend.direction === 'up') {
    return '↑';
  }
  if (trend.direction === 'down') {
    return '↓';
  }
  if (trend.direction === 'flat') {
    return '→';
  }
  return '';
}

function originLabel(keyRecord: Record<string, string | null>): string {
  return Object.values(keyRecord).filter((v) => v !== null).join('/') || 'unknown origin';
}

function renderAgentLines(agents: AgentDailyCost[]): string[] {
  return agents.map((agent) => {
    const costText = agent.costUsd !== null ? `$${agent.costUsd.value.toFixed(2)} ${trendArrow(agent.costUsd.trend)}` : 'no priced usage';
    return `- ${agent.role}: ${agent.tokens.value} tokens ${trendArrow(agent.tokens.trend)}, ${costText}`;
  });
}

function renderExpensiveTicketLines(tickets: ExpensiveTicket[]): string[] {
  if (tickets.length === 0) {
    return [];
  }
  return ['', '**Top expensive tickets to date:**', ...tickets.map((t) => `- ${t.ticketId}: $${t.costUsd.toFixed(2)}`)];
}

function renderCostPerTicketLines(costPerTicket: CostPerTicketSummary | undefined): string[] {
  if (!costPerTicket || costPerTicket.average === null) {
    return [];
  }
  const excludedNote = costPerTicket.excludedCount > 0 ? `, ${costPerTicket.excludedCount} delivered ticket(s) excluded (no priced usage)` : '';
  return [
    '',
    `**Average cost/ticket:** $${costPerTicket.average.value.toFixed(2)} ${trendArrow(costPerTicket.average.trend)} ` +
      `(over ${costPerTicket.sampleCount} delivered ticket(s)${excludedNote})`,
    `_${costPerTicket.basis}_`,
  ];
}

function renderTopExpensiveOriginsLines(byHorizon: Record<LlmCostHorizon, LlmCostRollupGroup[]> | undefined): string[] {
  if (!byHorizon) {
    return [];
  }
  const lines: string[] = ['', '**Top expensive origins:**'];
  for (const horizon of Object.keys(LLM_COST_HORIZONS_MS) as LlmCostHorizon[]) {
    const groups = byHorizon[horizon];
    if (!groups || groups.length === 0) {
      continue;
    }
    lines.push(`- ${horizon}:`);
    for (const group of groups) {
      const label = originLabel(group.key);
      const unknownNote = group.unknownCostCount > 0 ? ` (${group.unknownCostCount} unpriced)` : '';
      lines.push(`  - ${label}: $${group.costUsd.toFixed(2)}${unknownNote}`);
    }
  }
  return lines.length > 2 ? lines : [];
}

export function renderCostTrendChartLines(series: OriginCostTrendSeries[]): string[] {
  if (series.length === 0) {
    return [];
  }
  const scale = chooseCostTrendAxisScale(series);
  const lines: string[] = ['', `**Cost trend (7d, ${scale} scale):**`];
  for (const s of series) {
    const label = originLabel(s.key);
    const points = s.buckets.map((b) => b.costUsd.toFixed(2)).join(' -> ');
    lines.push(`- ${label}: ${points}`);
  }
  return lines;
}

function renderFlowBalanceLine(flow: CostHealthSidecar['flowBalance']): string {
  return (
    `**Flow balance:** specced ${flow.speccedPerDay.value}/day ${trendArrow(flow.speccedPerDay.trend)}, ` +
    `closed ${flow.closedPerDay.value}/day ${trendArrow(flow.closedPerDay.trend)}`
  );
}

function renderReliabilityLine(rel: ReliabilityCounts): string {
  return (
    `**Reliability:** ${rel.chases.value} chases ${trendArrow(rel.chases.trend)}, ` +
    `${rel.nudges.value} nudges ${trendArrow(rel.nudges.trend)}, ` +
    `${rel.respawns.value} respawns ${trendArrow(rel.respawns.trend)}, ` +
    `${rel.failedDeliveries.value} failed deliveries ${trendArrow(rel.failedDeliveries.trend)}`
  );
}

function renderAnomalyLines(anomalies: ResourceAnomaly[], samplesObserved: boolean): string[] {
  if (anomalies.length > 0) {
    return [
      '',
      '**Resource anomalies:**',
      ...anomalies.map((a) => {
        const mb = Math.round(a.rssBytes / (1024 * 1024));
        return `- ${a.role}: ${mb}MB ${trendArrow(a.rssTrend)}, ${a.cpuPercent.toFixed(1)}% cpu ${trendArrow(a.cpuTrend)}`;
      }),
    ];
  }
  if (samplesObserved) {
    return ['', '**Resource anomalies:** none found.'];
  }
  return [];
}

export function renderCostHealthSection(sidecar: CostHealthSidecar | null): string {
  if (!sidecar) {
    return '';
  }
  const lines: string[] = [
    '## Cost & Health',
    '',
    '**Per-agent tokens/cost today:**',
    ...renderAgentLines(sidecar.agents),
    ...renderExpensiveTicketLines(sidecar.topExpensiveTickets),
    ...renderCostPerTicketLines(sidecar.costPerTicket),
    ...renderTopExpensiveOriginsLines(sidecar.topExpensiveOriginsByHorizon),
    ...renderCostTrendChartLines(sidecar.originCostTrendSeries ?? []),
    '',
    renderFlowBalanceLine(sidecar.flowBalance),
    '',
    renderReliabilityLine(sidecar.reliability),
    ...renderAnomalyLines(sidecar.resourceAnomalies, sidecar.resourceSamplesObserved === true),
  ];
  return lines.join('\n');
}
