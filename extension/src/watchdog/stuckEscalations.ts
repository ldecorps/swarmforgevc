/**
 * Roles escalated by the stuck-in-process chaser (BL-067): chases exhausted
 * with no recovery. The chaser writes this registry; SwarmPanel reads it each
 * poll and surfaces the needs-human red border on the role's tile. Kept as a
 * host-side singleton so detection works with or without the panel open.
 */
const escalatedRoles = new Set<string>();

export function setStuckEscalation(role: string, escalated: boolean): void {
  if (escalated) {
    escalatedRoles.add(role);
  } else {
    escalatedRoles.delete(role);
  }
}

export function escalatedStuckRoles(): string[] {
  return [...escalatedRoles];
}

export function clearStuckEscalations(): void {
  escalatedRoles.clear();
}
