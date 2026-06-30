import { BacklogItem } from '../panel/backlogReader';

const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;

export function nextEligibleItem(items: BacklogItem[]): BacklogItem | null {
  const doneIds = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));

  const active = items
    .filter((i) => i.status === 'active')
    .sort((a, b) => (a.priority ?? MAX_PRIORITY) - (b.priority ?? MAX_PRIORITY));

  for (const item of active) {
    const blocked = item.dependsOn?.some((dep) => !doneIds.has(dep)) ?? false;
    if (!blocked) {
      return item;
    }
  }

  return null;
}
