# BL-859: The Boot-Prefix Budget Gate — Understanding the Check

**The boot prefix has a hard cap (51200 chars) but that cap used to be
checked in the wrong place and at the wrong time.** It lived only in
`swarmforge/scripts/test/prompt_engine_test_runner.bb`, which runs during a
parcel's *verification* — so the specifier, who commits constitution/article
growth straight to `main`, never saw the number, and an unrelated parcel's
reviewer, weeks later, saw it as a pre-existing red they were told to ignore.
That happened twice (BL-618 at 53408 chars, BL-858 at 65138), and telling
reviewers to wave through a named red is exactly the condition under which a
real red gets waved through too.

This gate catches the growth at authoring time instead.

## What it checks

`swarmforge/scripts/boot_prefix_budget_gate.sh` measures the boot-inlined
constitution/article text through `prompt_engine_lib`'s own stable-prefix
composer — the same code path every agent's boot prefix is actually built
from, never a second estimate that could drift from it — and compares it
against a **44000-char budget**.

That budget sits *under* the unchanged 51200-char cap on purpose:

| Threshold | Enforced by | When | Purpose |
|---|---|---|---|
| 44000 chars (budget) | `boot_prefix_budget_gate.sh` | At authoring time, run by the specifier | Catches the author before the commit lands |
| 51200 chars (cap) | `prompt_engine_test_runner.bb` | At verification time (the bb test suite) | Backstop for anything that slips past the gate |

The 7200-char band between them absorbs amendments landing between gate
runs. Exit 0 at or under budget, exit 1 above it. A failing run prints the
measured size, the budget, and how many characters must move — for example:

```
boot_prefix_budget_gate: FAIL — measured 46947 chars, budget 44000, move 2947
characters out of the boot-inlined prefix (e.g. to
swarmforge/constitution/articles/reference/) before committing
```

## Who runs it, and when

Per `swarmforge/roles/specifier.prompt`, the specifier runs this gate as a
required step before committing any change to a boot-inlined file:
`swarmforge/constitution.prompt`, a top-level file directly under
`swarmforge/constitution/articles/` (not `reference/`), or
`swarmforge/PIPELINE.md`.

## Remediation on failure

Move equivalent prose out to
`swarmforge/constitution/articles/reference/` (the constitution's existing
directory for long-form, incident-backed elaborations that are read on
demand rather than inlined at boot), or trim it, **in the same commit**.
Never commit over budget and defer the trim to later — that is the exact
failure mode this gate exists to close off.

## What it deliberately does not do

- It does not raise, lower, or remove the 51200 cap — that stays as the
  verification-time backstop.
- It does not do the trimming itself; that is separate, per-amendment work.
- It is not wired as a git hook or CI check — this repo has no hooks
  installed. It follows the same established pattern as
  `specifier_backlog_hygiene_gate.sh` and `gherkin_lint_gate.sh`: a role-run
  gate script named as a required step in that role's own prompt.

## See also

- [Onboarding a New Project — and the Acceptance Contract](../tutorials/Onboarding-New-Project.md) —
  the specifier's other authoring-time gate (`gherkin_lint_gate.sh`), same
  pattern applied to feature files instead of constitution text.
