#!/usr/bin/env node
/**
 * BL-432 (epic BL-429 slice 3 - ACT, the mandatory wiring slice): turns
 * BL-431's rework diagnosis into a persisted throttle recommendation the
 * coordinator's promotion path can apply as an EFFECTIVE cap = min(configured,
 * recommended) - closing the observe (BL-430) -> diagnose (BL-431) -> act loop
 * Article 3.5 already sanctions but nothing previously automated.
 *
 * Shelled out to from swarmforge/scripts/effective_backlog_depth_cli.bb at
 * EVERY promotion decision (Babashka has no way to import compiled TS) - the
 * same shell-to-node-and-degrade-on-failure pattern handoffd.bb already uses
 * for its other emit-*.js CLIs. Refreshes BL-430's observatory signal then
 * re-diagnoses on every CLI call rather than on a periodic sweep: a
 * promotion decision needs the current diagnosis, not one that might be
 * stale between coordinator wake-ups (or left on disk from months ago).
 *
 * needs_human-style safety contract (BL-429): only a 'lower the intake
 * throttle' verdict (no concentrated, attributable cause - the epic's ONE
 * sanctioned auto-tunable knob) ever produces a non-null recommendation;
 * every escalate-only verdict recommends nothing here, exactly like no
 * verdict at all.
 *
 * Usage: node emit-throttle-recommendation.js <target-repo-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { readReworkSignal } from '../metrics/reworkObservatoryStore';
import { diagnoseReworkSignal, classifyThrottleSeverity, recommendedCapForSeverity, ThrottleSeverity } from '../metrics/reworkDiagnosis';
import { computeStandingRedRecommendation, describeStandingRedSignal, StandingRedRecommendation } from '../metrics/standingRedSignal';
import { atomicWrite, atomicAppend } from '../util/atomicWrite';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';
import { refreshReworkSignal } from './rework-observatory';
import { readEffectiveConfigValue } from '../util/swarmforgeConfig';

export interface EmitThrottleRecommendationArgs {
  targetRepoPath: string;
}

export function parseArgs(argv: string[]): EmitThrottleRecommendationArgs | null {
  const [targetRepoPath] = argv;
  return targetRepoPath ? { targetRepoPath } : null;
}

function coordinatorStateDir(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'coordinator');
}

export function throttleRecommendationPath(targetRepoPath: string): string {
  return path.join(coordinatorStateDir(targetRepoPath), 'throttle-recommendation.json');
}

export function throttleChangeLogPath(targetRepoPath: string): string {
  return path.join(coordinatorStateDir(targetRepoPath), 'throttle-changes.jsonl');
}

export interface ThrottleRecommendation {
  recommendedCap: number | null;
  severity: ThrottleSeverity | null;
  reworkRate: number | null;
  baselineRate: number | null;
  // BL-1429: the standing-red register's own recommendation, folded into
  // recommendedCap below via the lower of the two (never a raise) - kept
  // here so the briefing and coordinator can read WHICH signal is active
  // right now, independent of the change log (which only records
  // TRANSITIONS, not the standing state).
  standingRed: StandingRedRecommendation | null;
  updated_at: string;
  // BL-1981: the EFFECTIVE floor a throttle hold imposes on top of the
  // raw recommendedCap above - null when no episode is open, or once a
  // release has lifted it. backlog_depth_lib.bb folds this in via the SAME
  // never-raise min() recommendedCap already uses, never by overwriting
  // recommendedCap itself: recommendedCap stays the raw, honest signal
  // (BL-1429's own "the recommendation is withdrawn" contract, unchanged).
  heldCap: number | null;
  episode: ThrottleEpisode | null;
  // BL-1874: set only when THIS run's own refreshReworkSignal threw (a
  // write failure under .swarmforge/telemetry, a full disk, a git
  // failure, ...) - names the failure so the operator-facing recommendation
  // itself says why the rework half below is empty, rather than leaving a
  // reader to guess whether "no rework signal" means "none observed" or
  // "couldn't check". Null on an ordinary successful refresh.
  refreshFailureReason: string | null;
}

export interface ThrottleEpisodeAnswer {
  kind: 'release' | 'keep';
  // Only present for 'keep' - the cap the human chose to hold at.
  value?: number;
  by: string;
  at: string;
  reason?: string;
}

// BL-1981: Article 3.5's amendment - a cleared signal no longer restores
// the cap by itself; the human does, via release-intake-throttle.js. One
// episode spans from the first run whose OWN fresh recommendation lowers
// the cap (never a stale on-disk one, BL-432 scenario 06/BL-1874) until a
// RELEASE answer's cap has actually been restored (the raw signal cleared
// too) - a KEEP answer never closes the episode on its own (requirement 5:
// "stops the episode reading as awaiting release, so nobody asks again",
// never "the hold goes away").
export interface ThrottleEpisode {
  openedAtIso: string;
  // Human-readable phrase naming what opened it (describeStandingRedSignal's
  // own wording, or a generic rework-diagnosis phrase) - purely for the
  // coordinator/human-facing report; never re-derives the binding-cause
  // comparison describeChangeReason below already owns.
  openingSignal: string;
  configuredCapAtOpen: number;
  // The LOWEST cap this episode has reached across every tick, including
  // after the signal clears (invariant 2: a severe 0 that eases to a
  // degraded 1 stays at 0).
  lowestCapReached: number;
  // Set the first time the raw recommendation clears (goes null) while
  // this episode is open; null while the signal is still live.
  clearedAtIso: string | null;
  answer: ThrottleEpisodeAnswer | null;
  // BL-1982: set once effective_backlog_depth_cli.bb (bb side) raises the
  // release question for this episode - role_ask.bb's own pending
  // marker's asked_at_ms at ask time, compared against the live marker
  // before consuming an answer. Written and read only by the bb CLI; kept
  // here so TS readers (release-intake-throttle.ts, tests) see it typed.
  // undefined/absent means no question has been raised for this episode
  // yet (invariant 1: at most one per episode).
  releaseAskedAtMs?: number;
  // BL-1982: a typed reply that was neither "Release the cap" nor "Keep
  // the throttle" - kept on the episode for a person to act on with the
  // release CLI by hand; the cap stays held and the episode still reads
  // awaiting release. undefined/absent means no such reply is on file.
  releaseReply?: string;
}

// Article 3.5's own "never raise" rule, applied across BL-432's rework
// signal and BL-1429's standing-red signal: null means "no constraint from
// this signal", so it never wins against a real number from the other one.
function minRecommendedCap(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.min(a, b);
}

// Pure given the signal - the SAME diagnose -> classify -> map pipeline
// reworkDiagnosis.ts's own exports already establish, composed here once
// rather than re-derived at each call site (this CLI's main() and its own
// tests both need the identical composition). heldCap/episode are left
// null here: this function knows nothing of prior ticks' episode state -
// emitThrottleRecommendation below folds those in from disk.
export function computeThrottleRecommendation(
  targetRepoPath: string,
  nowMs: number = Date.now(),
  // BL-1874: set when this tick's own refresh threw - the persisted
  // signal on disk is then whatever an EARLIER run left behind, never
  // this run's, so it must not be read at all (never trusted as current).
  reworkRefreshFailure: string | null = null
): ThrottleRecommendation {
  const signal = reworkRefreshFailure ? null : readReworkSignal(targetRepoPath);
  const verdict = signal ? diagnoseReworkSignal(signal) : null;
  const severity = classifyThrottleSeverity(verdict);
  const reworkCap = recommendedCapForSeverity(severity);
  const standingRed = computeStandingRedRecommendation(targetRepoPath);
  return {
    recommendedCap: minRecommendedCap(reworkCap, standingRed?.recommendedCap ?? null),
    severity,
    reworkRate: verdict?.reworkRate ?? null,
    baselineRate: verdict?.baselineRate ?? null,
    standingRed,
    updated_at: new Date(nowMs).toISOString(),
    heldCap: null,
    episode: null,
    refreshFailureReason: reworkRefreshFailure,
  };
}

// BL-1981: mirrors backlog_depth_lib.bb's own default-max-depth (5) and
// conf-file-path resolution (readEffectiveConfigValue already ports the
// identity-overridden-pack-conf lookup) - needed here only to name
// configuredCapAtOpen/the release target in the episode report; the
// EFFECTIVE fold against the live active-depth cap still happens once,
// on the bb side, via read-max-depth.
const DEFAULT_CONFIGURED_CAP = 5;

function readConfiguredCap(targetRepoPath: string): number {
  const raw = readEffectiveConfigValue(targetRepoPath, 'active_backlog_max_depth');
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_CONFIGURED_CAP;
}

// Human-readable phrase naming what is CURRENTLY binding rec's own
// recommendedCap - used only to label a freshly OPENED episode; never the
// same comparison describeChangeReason's clearing branch makes against the
// PRIOR tick (a different question: what was binding a moment ago).
function bindingSignalName(rec: ThrottleRecommendation): string {
  const reworkCap = recommendedCapForSeverity(rec.severity);
  const standingCap = rec.standingRed?.recommendedCap ?? null;
  if (standingCap !== null && (reworkCap === null || standingCap <= reworkCap)) {
    return describeStandingRedSignal(rec.standingRed!.signal);
  }
  return rec.severity === 'severe' ? 'a severe rework diagnosis' : 'a degraded rework diagnosis';
}

// Pure: the episode state machine (BL-1981). rawCap is THIS tick's fresh
// recommendedCap (never a stale on-disk value - BL-432 scenario 06/BL-1874
// already guarantee computeThrottleRecommendation itself never trusts
// one, so an episode can only ever open off a genuinely live signal).
export function updateThrottleEpisode(
  prior: ThrottleEpisode | null,
  rawCap: number | null,
  configuredCap: number,
  nowIso: string,
  rec: ThrottleRecommendation,
  // BL-1874 (QA bounce D1): true when THIS tick's null rawCap comes from a
  // failed refresh (computeThrottleRecommendation forces it null rather
  // than trust a stale on-disk signal), never a genuine clear. A failed
  // refresh must leave an open episode exactly as it was - not stamp
  // clearedAtIso and not close a release - since "we could not check"
  // is not "the signal is gone"; treating it as a clear raised BL-1982's
  // human-release question on a diagnosis that never actually cleared.
  reworkRefreshFailure: boolean = false
): ThrottleEpisode | null {
  // A RELEASED episode closes once the raw signal it was answering has
  // actually withdrawn - requirement 5: "the episode closes once that
  // recommendation is withdrawn".
  if (prior && prior.answer?.kind === 'release' && rawCap === null && !reworkRefreshFailure) {
    return null;
  }

  if (!prior) {
    if (rawCap !== null && rawCap < configuredCap) {
      return {
        openedAtIso: nowIso,
        openingSignal: bindingSignalName(rec),
        configuredCapAtOpen: configuredCap,
        lowestCapReached: rawCap,
        clearedAtIso: null,
        answer: null,
      };
    }
    return null;
  }

  let episode = prior;
  if (rawCap !== null) {
    // Invariant 2: the lowest cap this episode ever reached, across every
    // severity change - a severe 0 that eases to a degraded 1 stays at 0.
    // BL-2034: a live tick re-trips the signal - the episode is LIVE again,
    // not "awaiting release", so the first clear's instant is stale and
    // must be reset (a later clear re-stamps it).
    episode = { ...episode, lowestCapReached: Math.min(episode.lowestCapReached, rawCap), clearedAtIso: null };
  } else if (!episode.clearedAtIso && !reworkRefreshFailure) {
    episode = { ...episode, clearedAtIso: nowIso };
  }
  return episode;
}

// Pure: the EFFECTIVE floor an open episode imposes right now - null once
// a release has lifted the hold (the live signal alone governs from then
// on), the human-chosen value for a keep, or the lowest cap reached so far
// while unanswered.
export function heldCapForEpisode(episode: ThrottleEpisode | null): number | null {
  if (!episode) {
    return null;
  }
  if (episode.answer?.kind === 'release') {
    return null;
  }
  if (episode.answer?.kind === 'keep') {
    return episode.answer.value ?? null;
  }
  return episode.lowestCapReached;
}

function readPriorRecommendation(targetRepoPath: string): ThrottleRecommendation | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetRepoPath), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface ThrottleChangeLogEntry {
  ts: string;
  from: number | null;
  to: number | null;
  reason: string;
}

// BL-1429: names whichever signal is actually responsible for the CURRENT
// recommendedCap (the more restrictive of rework/standing-red, ties
// naming standing-red since both apply at cap 1 either way), or - when
// recommendedCap just became null - whichever signal was actually BINDING
// in the PRIOR recommendation, since that is what just cleared.
//
// Architect bounce (2026-09-05): the clearing branch used to credit
// standing-red whenever `prior.standingRed` was merely PRESENT, without
// checking it was ever the binding (lower) cap - so a severe rework
// diagnosis (cap 0) that was the true cause, clearing alongside a
// co-active but non-binding standing-red signal (cap 1), got misattributed
// to the standing-red signal. The clearing branch now runs the SAME
// "which was actually binding" comparison the active branch already does,
// against the prior tick's own caps. A clearing with no known prior cause
// (the pre-BL-1429 shape: rework severity cleared, no standing-red block
// at all, or standing-red present but never binding) keeps the original
// generic wording unchanged.
// BL-1981: the clearing branch no longer says "restoring the configured
// cap" for an episode still open and unanswered - Article 3.5's amendment
// means a cleared signal holds, it does not restore itself. The WHICH-
// SIGNAL-CLEARED naming (the architect-bounce fix above) is preserved
// verbatim, just wrapped in the new "held" wording when a hold applies;
// an episode that has already closed (answered-and-withdrawn) or never
// opened falls through to the original restoring wording unchanged.
// BL-1874 (QA bounce D1), extracted by the hardener to keep
// describeChangeReason's own complexity from rising further on top of its
// pre-existing debt: a failed refresh's null cap is not a clear - name the
// failure, never "rework diagnosis cleared" (which would read as the real
// signal having gone away and wrongly raise BL-1982's human-release
// question on a diagnosis that never actually cleared).
function describeRefreshFailureReason(refreshFailureReason: string, episode: ThrottleEpisode | null): string {
  if (episode && episode.answer === null) {
    return `held at ${episode.lowestCapReached} - refresh failed, not a clear (${refreshFailureReason})`;
  }
  return `refresh failed, rework signal unknown this tick (${refreshFailureReason})`;
}

function describeChangeReason(rec: ThrottleRecommendation, prior: ThrottleRecommendation | null, episode: ThrottleEpisode | null): string {
  if (rec.recommendedCap !== null) {
    const reworkCap = recommendedCapForSeverity(rec.severity);
    const standingCap = rec.standingRed?.recommendedCap ?? null;
    if (standingCap !== null && (reworkCap === null || standingCap <= reworkCap)) {
      return `standing-red register signal (${describeStandingRedSignal(rec.standingRed!.signal)}) - stabilizing to one`;
    }
    if (rec.severity === 'severe') {
      return `severe rework diagnosis (rate ${rec.reworkRate} vs baseline ${rec.baselineRate}) - freezing intake`;
    }
    return `degraded rework diagnosis (rate ${rec.reworkRate} vs baseline ${rec.baselineRate}) - stabilizing to one`;
  }
  if (rec.refreshFailureReason) {
    return describeRefreshFailureReason(rec.refreshFailureReason, episode);
  }
  const clearedPhrase = (() => {
    if (prior) {
      const priorReworkCap = recommendedCapForSeverity(prior.severity);
      const priorStandingCap = prior.standingRed?.recommendedCap ?? null;
      if (priorStandingCap !== null && (priorReworkCap === null || priorStandingCap <= priorReworkCap)) {
        return `${describeStandingRedSignal(prior.standingRed!.signal)} cleared`;
      }
    }
    return 'rework diagnosis cleared';
  })();
  if (episode && episode.answer === null) {
    return `held at ${episode.lowestCapReached} for a human release (${clearedPhrase})`;
  }
  return `${clearedPhrase} - restoring the configured cap`;
}

// Acceptance scenario 05: every CHANGE to the recommended cap is logged - a
// call whose recommendation is unchanged from the last persisted one (the
// common case: most ticks are steady-state) writes no log line at all, only
// the recommendation file itself (idempotent refresh, never spam). The FIRST
// ever call (no persisted file yet) compares against null, matching "no
// recommendation" - so a swarm that has never thrown a diagnosis logs
// nothing on its very first tick either.
export function emitThrottleRecommendation(
  targetRepoPath: string,
  nowMs: number = Date.now(),
  reworkRefreshFailure: string | null = null
): ThrottleRecommendation {
  const recommendation = computeThrottleRecommendation(targetRepoPath, nowMs, reworkRefreshFailure);
  const prior = readPriorRecommendation(targetRepoPath);
  const priorCap = prior?.recommendedCap ?? null;
  const configuredCap = readConfiguredCap(targetRepoPath);
  const episode = updateThrottleEpisode(
    prior?.episode ?? null,
    recommendation.recommendedCap,
    configuredCap,
    recommendation.updated_at,
    recommendation,
    recommendation.refreshFailureReason !== null
  );
  const fullRecommendation: ThrottleRecommendation = {
    ...recommendation,
    heldCap: heldCapForEpisode(episode),
    episode,
  };
  if (priorCap !== recommendation.recommendedCap) {
    const entry: ThrottleChangeLogEntry = {
      ts: recommendation.updated_at,
      from: priorCap,
      to: recommendation.recommendedCap,
      reason: describeChangeReason(recommendation, prior, episode),
    };
    atomicAppend(throttleChangeLogPath(targetRepoPath), JSON.stringify(entry) + '\n');
  }
  atomicWrite(throttleRecommendationPath(targetRepoPath), JSON.stringify(fullRecommendation));
  return fullRecommendation;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node emit-throttle-recommendation.js <target-repo-path>\n',
  async (args) => {
    // Refresh before diagnose: computeThrottleRecommendation still reads the
    // persisted signal (so in-process unit tests can inject fixtures), but
    // the live CLI never trusts a snapshot that nothing else has rewritten.
    //
    // BL-1874: a throwing refresh (a write failure under
    // .swarmforge/telemetry, a full disk, a git failure, ...) must still
    // end in a published recommendation - the rework half empty, never an
    // older run's cap - rather than exiting 1 before anything is written,
    // which left effective_backlog_depth_cli.bb reading whatever an
    // earlier run's file still said (BL-1869 probe c). The failure is
    // reported to stderr here, since a non-zero exit (the bb wrapper's own
    // reporting path) no longer happens for this cause.
    let reworkRefreshFailure: string | null = null;
    try {
      refreshReworkSignal(args.targetRepoPath);
    } catch (err) {
      reworkRefreshFailure = err instanceof Error ? err.message : String(err);
      console.error(`emit-throttle-recommendation: rework signal refresh failed, publishing without it: ${reworkRefreshFailure}`);
    }
    printJsonToStdout(emitThrottleRecommendation(args.targetRepoPath, Date.now(), reworkRefreshFailure));
  }
);

if (require.main === module) {
  runCliMain(main);
}
