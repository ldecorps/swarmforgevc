# BL-1127 model bake-off REDO — Qwen2.5-Coder-14B Q5_K_M (prod) vs Qwen3-Coder-30B-A3B-Instruct Q3_K_M

- stamped: 20261001T045000Z
- host: single RTX 5060 Ti, 16311 MiB VRAM total
- directed by: human, coordinator pane, 2026-10-01 — explicit redo of the
  09-30 bake-off's inconclusive Q3_K_M leg (that attempt timed out at 400s
  when the swarm's own self-healing reloaded iq3 mid-test and contended for
  the GPU; not retried then given time already spent). Previous evidence:
  `backlog/evidence/BL-1127-model-bakeoff-20260930T221102Z.md`.
- method: unchanged from the prior pass — one model GPU-resident at a time
  (confirmed via `nvidia-smi`/`ollama ps` before/after), the production
  `coder@iq3` seat's own model explicitly unloaded first via `ollama stop`
  (not killed — it reloads itself lazily on its next request, the same
  self-healing behavior noted previously, now done deliberately instead of
  fought) to remove contention risk entirely rather than race it. Shared
  problem read against `swarmforge/roles/coder.prompt` as system context via
  a direct Ollama `/api/chat` call (no live pipeline seat touched); staffing
  battery (`local_coder_battery.sh`) run against the model afterward as a
  baseline sanity check.

## Shared problem

Implement `dedupePreserveOrder(items: string[]): string[]` via TDD
(empty/no-dup/dup/single/case-sensitive cases), output test file +
implementation file only. Identical prompt to the 09-30 pass.

## Result

| model | quant | VRAM fit | battery | wall time | verdict |
|---|---|---|---|---|---|
| Qwen2.5-Coder-14B-Instruct (current prod `coder@iq3`) | Q5_K_M | fits fully alone, 13.1/16.3GB used, ~2.9GB headroom (unchanged, not re-measured this pass — see prior evidence) | PASS (prior pass) | 45s (prior pass) | correct, clean TDD output |
| Qwen3-Coder-30B-A3B-Instruct | Q3_K_M | **fits, with partial offload**: 11%/89% CPU/GPU split, 14262 MiB used, 1791 MiB free | **PASS** (`backlog/evidence/BL-1127-coder-battery-ollama-qwen3-coder-30b-q3km:latest-20261001T044947Z.md`) | 43.6s | correct, clean TDD output |

Full chat response (both files, correct and complete):
```typescript
// src/dedupePreserveOrder.test.ts
import { describe, it, expect } from 'vitest';
import { dedupePreserveOrder } from './dedupePreserveOrder';

describe('dedupePreserveOrder', () => {
  it('should return empty array when input is empty', () => {
    expect(dedupePreserveOrder([])).toEqual([]);
  });
  it('should return same array when no duplicates', () => {
    expect(dedupePreserveOrder(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('should remove duplicates while preserving order', () => {
    expect(dedupePreserveOrder(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });
  it('should handle single element array', () => {
    expect(dedupePreserveOrder(['a'])).toEqual(['a']);
  });
  it('should be case sensitive', () => {
    expect(dedupePreserveOrder(['a', 'A', 'a'])).toEqual(['a', 'A']);
  });
  it('should handle multiple duplicates', () => {
    expect(dedupePreserveOrder(['a', 'b', 'c', 'a', 'b', 'd', 'c', 'e'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

// src/dedupePreserveOrder.ts
export function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}
```

## Reading the fit number against the prior pass's criteria

The prior pass disqualified IQ4_XS outright on a 19%/81% CPU/GPU split and
passed iq3 (prod) at a 94%/6% GPU/CPU split (i.e. 6% CPU) under the same
naive-scheduler method. This run's Q3_K_M lands at 11% CPU / 89% GPU —
between those two: a real partial CPU offload, worse than iq3's 6% but
clearly better than IQ4_XS's 19%, and it completed the shared problem and
the staffing battery without issue or a timeout. Call this a genuine,
working partial-fit, not a clean full-GPU fit like the current 14B Q5_K_M
winner's 100%/0% split.

## Caveats (carried from the prior pass, still true)

- This measured ollama's default scheduler/context (32768 here, vs the
  14B's prior run also at default), not either model's tuned production
  launch flags — the same caveat the 09-30 evidence recorded for iq3.
- `coder@iq3`'s live production model was deliberately unloaded
  (`ollama stop`) before this run specifically to avoid the contention
  that sank the 09-30 Q3_K_M attempt. It was left to reload lazily on its
  own next request rather than forced back — confirmed idle (not mid-task)
  in its pane before unloading. No live pipeline seat or in-flight parcel
  was touched.
- GPU returned to 0 MiB used / 16052 MiB free immediately after this test
  (`ollama stop` on the 30B model), so `coder@iq3` resumes from a clean
  GPU exactly as before this probe ran.

## Verdict — no change to the deployed seat

Qwen3-Coder-30B-A3B-Instruct Q3_K_M now has a **confirmed, conclusive
result**: it fits (with partial CPU offload), passes the battery, and
produces correct output — resolving the prior "inconclusive" status. But it
does **not** beat the current production pick on any axis that mattered
before: it is not faster (43.6s vs the 14B's 45s is a statistical wash, not
a win), it does not fit as cleanly (11% CPU offload vs the 14B's 100% GPU /
2.9GB headroom), and it is a larger, more VRAM-constrained model on this
16GB host. **No change recommended** to `coder@iq3`'s deployed model
(`qwen2.5-coder-14b-q5km:latest`, set in `swarmforge/packs/full-forge.conf`,
its worktree copy, and `.swarmforge/launch/coder@iq3.sh` — all already
correct from the prior pass). `coder@2` remains offline, untouched by this
redo, per the standing human directive.
