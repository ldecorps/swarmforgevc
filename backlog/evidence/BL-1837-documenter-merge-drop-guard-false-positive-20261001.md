# BL-1837 documenter: same merge_drop_guard_lib.bb false positive as BL-1845

Sending BL-1837's git_handoff (round 2, post QA-bounce rework) is
refused by the same BL-1576 merge-drop gate, on the same
Specification.MD path, for the same root cause already traced and
escalated in full in
`backlog/evidence/BL-1845-documenter-merge-drop-guard-false-positive-20261001.md`
(note sent to specifier, priority 00, 2026-10-01): the gate's
`lines-lost` matcher is text-only, not position-aware, and this file's
repeated `Prior entry —` separator (plus the duplicated BL-1830 entry
body each branch deduped independently) collides with itself whenever
two branches independently fix/reorder the same stale duplicate.

Verified (same method as BL-1845): `grep -c` on every entry's own
opening line in the current Specification.MD — each of BL-1830/1837/
1842/1845/1846 exactly once; entry count (327) matches the expected
sum; `diff` of hardener's unique content against the corresponding
slice of this branch's result — byte-identical. No real content lost.

Not re-escalating separately — the specifier's answer on BL-1845's note
covers this recurrence too; both tickets are held at documenter pending
that reply.

By documenter.
