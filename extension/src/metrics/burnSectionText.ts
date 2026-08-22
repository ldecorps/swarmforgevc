// BL-619: pure formatting layer turning burnProjection.ts's BurnSectionResult
// into the text the briefing actually sends - kept separate from the
// decision logic (composeBurnSection) the same way briefing-digest-line.ts
// separates its own pure formatMergedBlockedDigest from its impure main().
//
// warning-leads-briefing-01/04: only the 'warn' kind produces leadingText -
// the ONLY case the briefing prepends above the coordinator-authored body
// and marks the subject. Every other kind (ok/no-anchor/malformed) produces
// appendedText - a single line joining the existing appended-section list,
// unchanged shape from every sibling *-briefing-line CLI.
import { BurnSectionResult } from './burnProjection';

export const USAGE_ANCHOR_COMMAND = 'node extension/out/tools/usage-anchor.js record <pct>';

export interface BurnSectionText {
  kind: BurnSectionResult['kind'];
  leadingText: string | null;
  appendedText: string | null;
  subjectMarker: boolean;
  warning?: string;
}

function formatRate(ratePctPerDay: number): string {
  return `${ratePctPerDay.toFixed(1)}%/day`;
}

function formatTokensPerHour(tokensPerHour: number): string {
  return `${Math.round(tokensPerHour)} tokens/hr`;
}

export function formatBurnSectionText(result: BurnSectionResult, anchorScope: string): BurnSectionText {
  switch (result.kind) {
    case 'warn': {
      const runOutLabel = new Date(result.runOutAtMs).toISOString();
      const leadingText = [
        `TOKEN BURN WARNING (${anchorScope}): projected to exhaust the weekly quota by ${runOutLabel}, before the next weekly reset.`,
        `Projected rate: ~${formatRate(result.ratePctPerDay)}, from the last recorded usage anchor.`,
        'Choose one: the human pauses usage, or the swarm throttles - via a control pause ' +
          '(.swarmforge/operator/control-pause.json), the nightly cooldown window, or a lowered active_backlog_max_depth.',
      ].join('\n');
      return { kind: 'warn', leadingText, appendedText: null, subjectMarker: true };
    }
    case 'ok': {
      const appendedText = `Token burn: on track (~${formatRate(result.ratePctPerDay)} from the last recorded anchor) - projected to stay within the weekly quota until the next reset.`;
      return { kind: 'ok', leadingText: null, appendedText, subjectMarker: false };
    }
    case 'no-anchor': {
      const appendedText =
        `Token burn: local rate ~${formatTokensPerHour(result.localBurnRateTokensPerHour)}. ` +
        `Account-level projection unavailable - no usage anchor recorded this week. Record one: ${USAGE_ANCHOR_COMMAND}.`;
      return { kind: 'no-anchor', leadingText: null, appendedText, subjectMarker: false };
    }
    case 'malformed': {
      const appendedText =
        `Token burn: local rate ~${formatTokensPerHour(result.localBurnRateTokensPerHour)}. ` +
        `Account-level projection unavailable - weekly reset schedule is misconfigured (${result.warning}).`;
      return { kind: 'malformed', leadingText: null, appendedText, subjectMarker: false, warning: result.warning };
    }
  }
}
