# Article 4.2 false positive: a bounced-then-fixed-then-approved parcel reads as forever-unapproved

- **Escalation subject:** `pipeline-code-on-main-a0b390f7e04cad3e837ce9c8c8ef0688b6da4c3e`
- **Adjudicated:** 2026-10-05T11:30Z by the Operator. Verdict: **FALSE POSITIVE — land is legitimate.**
- **First delivery** of this subject (dedup entry written 2026-10-05T11:23:34Z), not a re-fire.

## Why the escalation fired

`is_qa_ancestor.sh a0b390f7e0` exits 1 with:

```
bounced: a0b390f7e0 has a QA bounce verdict on file (.swarmforge/bounces/2026-10.jsonl)
(recorded as a0b390f7e0) - a bounced parcel never reads as approved (BL-952)
```

The bounce row is real:

```json
{"ticket":"BL-1972","producingRole":"coder","ticketType":"defect",
 "failureClass":"invariant-unencoded","commit":"a0b390f7e0","by":"hardender",
 "at":"2026-10-05T09:37:42.308Z"}
```

## Why the land is nevertheless legitimate

The bounce was **superseded by a fix and two fresh passes** on the same ticket line
(all times UTC):

| UTC | commit | event |
|---|---|---|
| 09:20:25 | `a0b390f7e0` | coder parcel (the escalated sha) |
| 09:34:47 | `95dd76e4e7` | hardender bounce evidence — stale-build check crashes a Stryker sandbox dry run |
| 09:36:18 | — | bounce row mis-recorded against the *evidence* commit `95dd76e4e7` |
| 09:37:42 | — | bounce row recorded against the parcel `a0b390f7e0` |
| 09:38:14 | `0a2e513b91` | `bounce_history` corrected — mis-invoked record-bounce entry dropped |
| 09:39:21 | `6ac9f3995c` | hardender review evidence (1 defect) |
| **10:43:14** | **`c734239556`** | **coder FIX** — skip the stale-build check inside a `.stryker-tmp` sandbox |
| 10:47:26 | `2f09ebc30e` | hardender review pass evidence (**NONE**) |
| 10:49:52 | `83cdde0aa3` | hardender review pass evidence (detail) |
| 11:02:28 | `0e908e61fc` | QA review pass evidence (**NONE**) |
| 11:02:40 | `c905258f89` | QA review pass evidence (detail) |
| 11:03:28 | `d088d44813` | **`Land BL-1972: merge origin/main 24c0c5dd15`** — landed via the lander |
| — | `d3cdae6f5b` | `Close BL-1972: move to done` |

So: bounced -> fixed -> hardender re-passed clean -> QA passed clean -> landed through
the lander -> closed. Nothing bypassed QA.

## The actual defect (systemic, not BL-1972-specific)

`.swarmforge/bounces/*.jsonl` is **append-only with no supersede semantics**. Once a
parcel sha carries a bounce row, BL-952's rule ("a bounced parcel never reads as
approved") makes `is_qa_ancestor.sh` return 1 for that sha **forever** — even after the
defect is fixed on the same ticket line and both hardender and QA record fresh passes.
Consequence: **every bounce -> fix -> land cycle leaves a permanent Article 4.2
escalation that cannot be cleared by either recorded close-out path.**

- **QA's path is blocked by construction.** The prompt's hand-built-land remedy is
  "QA records the land-approval (`is_qa_ancestor.sh <sha>` must exit 0; BL-1405)" — but
  the bounce row is exactly what forces exit 1, so QA cannot make it exit 0.
- **The coordinator's waive path does not silence it.** `babysitter_waive.bb --record`
  (BL-1344) exists, but until **BL-1404** lands the escalation channel ignores waives.
  (`.swarmforge/babysitter/` holds no waive records at all as of this adjudication.)

The ledger *does* already model one escape hatch — a `bounce-correction` row, used by QA
for BL-1951 on 2026-10-04 — but its semantics are "the bounce was a false positive", which
is **not** this case. The bounce here was genuine; it was *remediated*. The missing concept
is a **bounce-superseded** (or bounce-resolved) row that a later clean pass on the same
ticket line writes, which `is_qa_ancestor.sh` then honours.

## Disposition

- No action taken against the land. It is correct and stays on main.
- No code edited (Operator does not edit code).
- One `type:note` sent to the coordinator with these facts; the coordinator owns the
  close-out and the routing of the defect to the specifier.
- Expect this subject to **re-fire** until the supersede semantics exist. Per the standing
  SUP-17 ruling (2026-10-04), Article 4.2 re-fires on sanctioned close-outs are accepted
  noise — do not re-ask the human. On a re-delivery of
  `pipeline-code-on-main-a0b390f7e0...`, read this file and stop; do not re-derive.
