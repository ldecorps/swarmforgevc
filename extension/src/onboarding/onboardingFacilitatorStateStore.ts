// BL-590 slice 1: durable per-target persistence for the onboarding
// facilitator's prerequisites state machine (onboardingFacilitatorState.ts).
// Follows readRelayOffset/writeRelayOffset's own discipline (BL-381,
// relay-onboarding-negotiation-telegram.ts): try/catch to a safe default on
// read, atomicWrite (temp-file + rename) on write - never a bare
// fs.writeFileSync a crash could leave half-written.
//
// Lives under the SWARM repo's own .swarmforge/, not the target's - unlike
// the negotiation relay (BL-381), the prerequisites phase never clones the
// target, so there is no target-repo .swarmforge/ to write into yet. One
// file per target (keyed by a slug of its repo URL) so concurrent
// onboardings (slice 3) stay distinct.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { OnboardingFacilitatorState } from './onboardingFacilitatorState';

function onboardingStateDir(swarmRepoRoot: string): string {
  return path.join(swarmRepoRoot, '.swarmforge', 'onboarding');
}

// A filesystem-safe, human-recognizable key for a target repo URL - strips
// the scheme and replaces anything that isn't alphanumeric/-/. with '-', so
// two distinct URLs never collide and the resulting filename stays legible
// for operator debugging (e.g. github.com/org/repo).
export function slugifyTargetRepoUrl(targetRepoUrl: string): string {
  const withoutScheme = targetRepoUrl.replace(/^[a-z]+:\/\//i, '').replace(/\.git$/i, '');
  const slug = withoutScheme.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'target';
}

function onboardingStatePath(swarmRepoRoot: string, targetRepoUrl: string): string {
  return path.join(onboardingStateDir(swarmRepoRoot), `${slugifyTargetRepoUrl(targetRepoUrl)}.json`);
}

export function readOnboardingFacilitatorState(swarmRepoRoot: string, targetRepoUrl: string): OnboardingFacilitatorState | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(onboardingStatePath(swarmRepoRoot, targetRepoUrl), 'utf8'));
    return parsed as OnboardingFacilitatorState;
  } catch {
    return undefined;
  }
}

export function writeOnboardingFacilitatorState(swarmRepoRoot: string, state: OnboardingFacilitatorState): void {
  atomicWrite(onboardingStatePath(swarmRepoRoot, state.targetRepoUrl), JSON.stringify(state, null, 2));
}

// Every per-target state file currently on disk - the routing layer uses
// this to find which target (if any) a plain-text reply in the Onboarding
// topic applies to, since slice 1's single-topic-reused design (per the
// specifier's design note) means the topic itself carries no target
// identity of its own.
export function listOnboardingFacilitatorStates(swarmRepoRoot: string): OnboardingFacilitatorState[] {
  const dir = onboardingStateDir(swarmRepoRoot);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as OnboardingFacilitatorState;
      } catch {
        return undefined;
      }
    })
    .filter((state): state is OnboardingFacilitatorState => state !== undefined);
}
