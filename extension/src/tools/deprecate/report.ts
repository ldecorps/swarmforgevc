import type { DeprecateResult } from './types';

export function renderDeprecateReport(result: DeprecateResult): string {
  if (result.outcome === 'ranked') {
    const lines = result.items.map(
      (it, i) =>
        `${i + 1}. ${it.subject} (recurrence=${it.recurrence}, blast=${it.blastRadius}, ${it.adjudication})`
    );
    return ['deprecate dry — ranked stale items (no mutation):', ...lines].join('\n');
  }
  if (result.outcome === 'retired') {
    return `deprecate: retired ${result.subject}; stub ${result.stubPath}; index linked`;
  }
  if (result.outcome === 'human-ask') {
    return `deprecate: human ask for ${result.subject} — ${result.reason}`;
  }
  if (result.outcome === 'defect') {
    return `deprecate: defect bucket for ${result.subject} — ${result.reason} (ticket not closed)`;
  }
  if (result.outcome === 'nothing-ranked') {
    return 'deprecate: nothing ranked';
  }
  return `deprecate: refused — ${result.reason}`;
}
