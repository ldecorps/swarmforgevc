// BL-064: per-item role packs. A ticket may pin a lean subset of the fixed
// pipeline chain (dormant roles skip that parcel entirely); QA and the
// specifier merge step are never skippable. Pure/testable routing decisions
// live here — no live swarm required.

export const PIPELINE_CHAIN: readonly string[] = [
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardender',
  'documenter',
  'QA',
];

const MANDATORY_ROLES = new Set(['QA']);

// The active pack for a parcel: the pinned subset in chain order, deduped,
// with mandatory roles (QA) always present even if a pin omits them. An
// unpinned or empty pin falls back to the full default chain (BL-064
// role-pack-03: right-sizing is opt-in, never silently global).
export function resolveActivePack(pinnedPack?: string[]): string[] {
  if (!pinnedPack || pinnedPack.length === 0) {
    return [...PIPELINE_CHAIN];
  }
  const pinned = new Set(pinnedPack.filter((role) => PIPELINE_CHAIN.includes(role)));
  for (const mandatory of MANDATORY_ROLES) {
    pinned.add(mandatory);
  }
  return PIPELINE_CHAIN.filter((role) => pinned.has(role));
}

// The next role that should receive the parcel after currentRole, skipping
// any dormant roles not in the active pack (BL-064 role-pack-01). Returns
// null once currentRole is the last active stage (QA).
export function nextActiveRole(pack: string[], currentRole: string): string | null {
  const activeSet = new Set(pack);
  const currentIndex = PIPELINE_CHAIN.indexOf(currentRole);
  if (currentIndex === -1) {
    return null;
  }
  for (let i = currentIndex + 1; i < PIPELINE_CHAIN.length; i++) {
    const candidate = PIPELINE_CHAIN[i];
    if (activeSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Chain roles NOT in the active pack for this parcel — the roles that must
// not receive it and whose worktrees should rebase-on-wake next time they do
// receive work (BL-064 role-pack-04).
export function dormantRoles(pack: string[]): string[] {
  const activeSet = new Set(pack);
  return PIPELINE_CHAIN.filter((role) => !activeSet.has(role));
}

// Human-readable routing summary for panel/run-log visibility (BL-064
// role-pack-05), e.g. "coder -> cleaner -> documenter -> QA".
export function describePack(pack: string[]): string {
  return PIPELINE_CHAIN.filter((role) => pack.includes(role)).join(' -> ');
}
