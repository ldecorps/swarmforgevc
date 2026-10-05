# BL-2008 QA hold: unowned red (2026-10-05)

parcel: 9a6d7dead4
red: extension/test/bl1300SingleEnforceableBudget.property.test.js

Failing command (qa-gather properties row, one run): `npm run test:properties` from extension/ at 9a6d7dead4.
Verbatim:
```
FAIL  test/bl1300SingleEnforceableBudget.property.test.js > exactly one number is enforceable, and every refusal names it
Error: Property failed after 3 tests
AssertionError: verdict names a second budget 42000: boot_prefix_budget_gate: ok — 42000/44000 chars
```
The parcel does not touch this file (diff: BL-2008 coder evidence only). Register join: absent; no ticket in active/paused/hold or standing-reds.tsv on origin/main names it.

Everything else for BL-2008 at 9a6d7dead4 is green: BL-748 4/4, BL-951 6/6, BL-953 8/8, BL-983 5/5, BL-991 10/10, BL-992 5/5; hotfix 0c1de3028c keeps both invariants (re-send only on AUDIT_REQUIRED|HANDOFF_NOT_QUEUED; BL-983 asserts no seat id outside from_seat); unit, wiring, sibling, register, acceptance rows exit 0.
Parcel waits for an owner (Article 4.2); on release, re-run the gate on 9a6d7dead4.
