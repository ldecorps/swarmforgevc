# BL-1052 / BL-1053 — the supersede lost the race, and the branch nearly hid it

Reported by: coder · 2026-08-23 · found while merging QA's BL-1069+BL-713 merge-up

## What happened

On 2026-08-22 the specifier sent a priority-00 note (timestamp
`20260822T223533Z`) saying BL-1052 and BL-1053 had been reframed at `8accd9287`
from *"staff a seat with the qwen-code cloud CLI"* to *"download a model, run it
on this host, staff a seat with it"*. Both respecced tickets carry
`human_approval: pending`, and their `approval_context` says explicitly that
coder work already started against the qwen-code-only shape **must not continue
under that contract**.

At 23:54 the same day I reverted the three qwen-code-only commits out of
`swarmforge-coder` in `1a94f143b`. That was correct at the time, and I checked
it: none of `8ad89d6fe`, `876df1f9f` or `1696fb41f` were ancestors of `main`, so
the coder branch was the only place the work existed.

It was not the only place. The same three commits were **already in flight down
the pipeline**, and they landed on `main` while I was reverting them off the
branch behind them:

| commit | ticket | route onto `main` |
|---|---|---|
| `8ad89d6fe` | BL-1052 | `464b4f473` cleaner → `ed0ea0ab6` architect → … → `main` |
| `876df1f9f` | BL-1053 | `b29581c27` cleaner → `0c3227e8b` architect → … → `main` |
| `1696fb41f` | BL-1053 | same chain |

All three are ancestors of `main` as of this report. `986ea5211` (cleaner's
`agent-for-provider` dedupe in `model_factory_lib.bb`) sits on top of them, so
the superseded shape has since been *refactored* on `main` as well.

## Why this needed a report and not a quiet fix

Once the content is on `main`, the constitution's rule inverts. "A bounce must be
reverted out of the bouncing branch" carries the explicit exception:

> **EXCEPTION: already an ancestor of `main` → do NOT revert**; report the breach.

Left alone, my revert would have ridden every future forward off this branch as
a *silent deletion of landed work* — no conflict marker, no diff against the
sender's tip to show for it. That is exactly the BL-571 / BL-954 / BL-958 shape.
It surfaced here only because the QA merge-up got diffed against **both**
parents, per the Guardrails rule; the merge itself reported "Merge made by the
'ort' strategy" and nothing else.

So I restored the content (`2e126ce29`, reverting my own `1a94f143b`) and
merged `main`. Every restored path was compared against `main`'s **content**,
not by ancestry — all match.

## Verification after restoring

| check | result |
|---|---|
| `extension` unit suite | 8537 passed / 477 files, exit 0 |
| `test_qwen_code_seat.sh` | ALL PASS |
| `test_qwen_code_ancillary_family.sh` | ALL PASS |
| `bl1053_qwen_provider_routing_test_runner.bb` | ALL PASS |
| `bl1052_qwen_code_seat_property_runner.bb` | ALL PROPERTIES HELD (200 map / 40 launch runs) |
| `bl1053_provider_routing_property_runner.bb` | ALL PROPERTIES HELD (300 runs) |
| merge diffed against both parents | no `main` content dropped |

## The open question — for the specifier and coordinator, not for me

**The qwen-code-only work is on `main` and the tickets that asked for it no
longer do.** I am not resolving that on a role branch. It needs a disposition:

1. **Keep it.** The reframed BL-1052/BL-1053 describe a local-model path; the
   shipped qwen-code seat may stand on its own as the cloud-CLI arm, in which
   case it wants a ticket of its own to be described by. BL-1077 (a documented
   qwen credential name is honored) is still paused and still assumes it.
2. **Remove it.** Then removal is a normal ticket through the normal pipeline —
   spec, gates, the lot — not a branch quietly diverging from `main`.

Either way the reframed BL-1052/BL-1053 stay `human_approval: pending` and I
have started nothing against them.

## The process gap worth a ticket on its own

A supersede note reaches **one role — whoever the specifier believes holds the
parcel**. It does not reach the copies of that work already moving down the
pipeline. Here the note found the coder and missed four downstream stages, and
the superseded work shipped past all of them. Article 3's "Amending An In-Flight
Ticket's Spec" assumes a single holder; a ticket whose commits have already been
forwarded has several, and nothing today tells the ones in front.
