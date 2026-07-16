/**
 * BL-431 (epic BL-429 slice 2 - DIAGNOSE + ESCALATE): reads BL-430's rolling
 * rework signal and, ONLY when the current rate is meaningfully above (not
 * merely equal to) the trailing baseline, emits a ranked suboptimality
 * verdict naming the likely cause and a classified recommended action. A
 * fixed absolute rate threshold is wrong because baselines drift (this is
 * Article 3.5's own reasoning for the coordinator's health-based intake
 * throttle); this reuses the same 2x-baseline relative-creep idiom
 * computeSuiteDuration (BL-078, swarmMetrics.ts) already established for
 * "meaningfully above" elsewhere in this codebase, rather than inventing a
 * second one. No verdict (null) when there is no sample, no baseline to
 * compare against, or the rate is at/below that baseline - never a false
 * alarm on a healthy or not-yet-measurable pipeline.
 */
import { ReworkSignal } from './reworkObservatory';

export type RemediationDisposition = 'auto-tunable' | 'escalate-only';

// The epic's safety contract (BL-429): only this ONE sanctioned knob (the
// coordinator's Article-3.5 intake throttle, moved by the ACT slice BL-432)
// may ever be applied without a human. This is an ALLOWLIST, not a
// denylist, so any remediation this module does not explicitly recognize -
// including a future new remediation type nobody has classified yet -
// defaults to escalate-only rather than silently becoming auto-appliable.
const SAFE_KNOB_REMEDIATIONS = new Set<string>(['lower the intake throttle']);

export function classifyRemediationDisposition(remediation: string): RemediationDisposition {
  return SAFE_KNOB_REMEDIATIONS.has(remediation) ? 'auto-tunable' : 'escalate-only';
}

export const ABOVE_BASELINE_MULTIPLIER = 2;

export interface SuboptimalityVerdict {
  reworkRate: number;
  baselineRate: number;
  topRole: string | null;
  topTicketClass: string | null;
  likelyCause: string;
  recommendedAction: string;
  disposition: RemediationDisposition;
}

const NO_CONCENTRATION_CAUSE = 'no single role or ticket-class dominates';

// Pure: null (no identifiable concentration) when BL-430's own mode-of-
// bounced attribution found neither a dominant role nor ticket-class -
// joins both when both are known, matching acceptance scenario 03 ("names
// that role AND that ticket-class").
function describeLikelyCause(topRole: string | null, topTicketClass: string | null): string | null {
  const parts = [topRole ? `role ${topRole}` : null, topTicketClass ? `ticket-class ${topTicketClass}` : null].filter(
    (v): v is string => v !== null
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

// A concentrated, attributable cause warrants a TARGETED escalation
// (respawn/reroute/code-fix - never auto-applied); with no identifiable
// concentration the generic circuit-breaker response (Article 3.5) is the
// correct, safe default. Exactly one binary branch - no role-vs-ticket-
// class priority ordering to pin, since both are already folded into one
// `likelyCause` string above.
function recommendAction(likelyCause: string | null): string {
  return likelyCause ? `investigate ${likelyCause}` : 'lower the intake throttle';
}

// BL-432 (epic BL-429 slice 3 - ACT): the ONE sanctioned auto-tunable knob
// (Article 3.5's intake throttle) needs a two-level severity, not just the
// binary verdict/no-verdict this module produced for BL-431 - "degraded"
// (drop the effective cap to one) vs "severe" (drop it to zero). Reuses the
// SAME 2x-baseline relative-creep idiom diagnoseReworkSignal already
// established for "meaningfully above baseline" rather than inventing a
// second one, extended with a second, harder threshold: severe means the
// rate has crossed baseline*4 (degraded crossed it once at baseline*2;
// severe means it kept climbing to double that again), never a fixed
// absolute rate (baselines drift, Article 3.5's own reasoning).
export type ThrottleSeverity = 'degraded' | 'severe';

export const SEVERE_BASELINE_MULTIPLIER = ABOVE_BASELINE_MULTIPLIER * 2;

// null whenever there is no verdict at all, OR the verdict's own
// recommendation is escalate-only - a concentrated, attributable cause
// (classifyRemediationDisposition's own allowlist) is NEVER auto-throttled,
// exactly the epic's safety contract (BL-429): only the generic
// no-concentration circuit-breaker response may ever move without a human.
export function classifyThrottleSeverity(verdict: SuboptimalityVerdict | null): ThrottleSeverity | null {
  if (!verdict || verdict.disposition !== 'auto-tunable') {
    return null;
  }
  return verdict.reworkRate > verdict.baselineRate * SEVERE_BASELINE_MULTIPLIER ? 'severe' : 'degraded';
}

// Pure mapping from severity to Article 3.5's own two named caps - never
// invents a third value, never raises: null (no throttle recommended) means
// the caller applies the human-configured cap unchanged.
export function recommendedCapForSeverity(severity: ThrottleSeverity | null): number | null {
  if (severity === 'severe') {
    return 0;
  }
  if (severity === 'degraded') {
    return 1;
  }
  return null;
}

export function diagnoseReworkSignal(signal: ReworkSignal): SuboptimalityVerdict | null {
  if (!signal.hasSample || signal.reworkRate === null || signal.baselineRate === null) {
    return null;
  }
  if (signal.reworkRate <= signal.baselineRate * ABOVE_BASELINE_MULTIPLIER) {
    return null;
  }
  const likelyCause = describeLikelyCause(signal.topRole, signal.topTicketClass);
  const recommendedAction = recommendAction(likelyCause);
  return {
    reworkRate: signal.reworkRate,
    baselineRate: signal.baselineRate,
    topRole: signal.topRole,
    topTicketClass: signal.topTicketClass,
    likelyCause: likelyCause ?? NO_CONCENTRATION_CAUSE,
    recommendedAction,
    disposition: classifyRemediationDisposition(recommendedAction),
  };
}
