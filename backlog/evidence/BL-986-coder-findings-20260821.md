# BL-986 — coder findings

The diagnosis in the ticket was exact and the fix followed it. Two things it
could not have known, both found by measuring before writing code.

- **Author**: coder, 2026-08-21.

## Reproduced first

```
FAIL: KNOWN VIOLATION: BL-252 is a recorded violation of the
Scenario-Outline rule (BL-250 is that rule's origin)
  expected: 1
  actual:   0
```

## Finding 1 — the widening had to be scoped, or the origin assertion breaks

The obvious move for the test runner is "stop hardcoding three files, use the
production `rule-source-files`". **That would have failed**, and not in a way
that looks like a mistake: `swarmforge/roles/documenter.prompt` carries a
DIFFERENT standing rule ("One ticket, one doc entry, one handoff") that
legitimately records **BL-250 as a violation** of it. The runner's neighbouring
assertion says BL-250 counts 0 — true for the Scenario-Outline rule it is about,
false across the whole role roster.

Measured, not assumed: across the full production set BL-250 already counts 1,
both before and after this parcel. So the runner reads each of its three
articles **with its own reference/ elaboration** — five files — and the
file-discovery layer is widened and tested separately. The reason is recorded in
the runner itself so the next person does not "simplify" it back.

## Finding 2 — widening alone trades a false zero for a false double

The ticket anticipated this ("deduplicate, or the fix trades an under-count for
an over-count") and it is real, not theoretical. Probing the widened set before
committing to a design found **15 rule blocks present in both an inlined article
and a reference file**, and one carrying live citations
(`BL-257`/`BL-265`, duplicated inside `local-engineering-detailed.prompt`
itself). Without dedup those tickets would have started reporting 2.

`scan-violations` now collapses records identical in rule summary AND violation
citations, keeping the first in the existing deterministic sort — which, because
`articles/…` sorts before `articles/reference/…`, means the surviving record
points at the inlined article rather than the elaboration. Better for a briefing
line, and it does not disturb the sort's stability.

## The declared invariant is a property, not three examples

> "A rule citation counts as a violation record wherever the constitution keeps
> it — moving prose between a boot-inlined article and its reference/
> elaboration never changes the reported violation count."

`swarmforge/scripts/test/bl986_relocation_neutral_property_runner.bb` quantifies
it: for any generated rule set, any per-rule placement (inlined / relocated /
both) and any cited ticket, the counts must equal the all-inlined baseline. Same
seeded-LCG convention as this directory's other `*_property_runner.bb` files
(BL-472: no test.check for `.bb`, so the enforced `.bb` gate is where it lives —
not the JS property lane, which cannot import a Babashka module).

**Generator reach is asserted**, not hoped for: the run fails if any placement —
especially `both`, the one that turns an under-count into an over-count — was
never sampled.

**Non-vacuous in both directions**, shown by breaking each half:

| break | property says |
|---|---|
| dedup removed | `BL-625 2` where the baseline says `1` |
| reference records ignored | `BL-543 0` where the baseline says `1` |

## Verification

| check | result |
|---|---|
| `standing_rule_violations_lib_test_runner.bb` | ALL TESTS PASSED (was 1 FAILURE) |
| `standing_rule_violations_files_test_runner.bb` | ALL TESTS PASSED |
| `bl986_relocation_neutral_property_runner.bb` | ALL PASS, 300 runs |
| BL-337 acceptance | **6/6, exit 0** (read from the exit code, not through `tail`) |
| live CLI `for-ticket BL-252` | `count: 1`, cited from `reference/engineering-detailed.prompt` |
| live CLI `for-ticket BL-250` / `BL-255` | 1 (documenter.prompt's own rule, pre-existing) / 0 |
| downstream consumers | `briefing_email`, `bl902` property, `briefing_generation_schedule`, `banked_briefing`: all pass |

**qa_e2e step 3 and 4, run against the REAL committed articles.** Took the first
citation-bearing rule actually in `engineering.prompt` — the guardrails rule
citing BL-571/572/662/897/954/958/972 — relocated it verbatim into
`reference/engineering-detailed.prompt`, and also placed it in both at once:

```
before (inlined):    {BL-571 1, BL-572 1, BL-662 2, BL-897 1, BL-954 1, BL-958 1, BL-972 1}
after  (relocated):  {BL-571 1, BL-572 1, BL-662 2, BL-897 1, BL-954 1, BL-958 1, BL-972 1}
both   (duplicated): {BL-571 1, BL-572 1, BL-662 2, BL-897 1, BL-954 1, BL-958 1, BL-972 1}
```

Identical. Done on the file contents in memory — the scanner is pure text
parsing, so this is equivalent to editing and reverting, without ever putting
the constitution in a modified state. (`BL-662` is 2 because two distinct rules
genuinely cite it; the point is that it is stably 2 in all three placements.)
