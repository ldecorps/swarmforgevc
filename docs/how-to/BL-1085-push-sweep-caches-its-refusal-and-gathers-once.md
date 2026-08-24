# Push-sweep caches its refusal and gathers the ahead range once (BL-1085)

## The cost this cut

A refusing push-sweep used to re-derive the same verdict every heavy
`handoffd` cycle: the QA gate and the noop-merge gate each walked
`origin/main..main` independently, and nothing was keyed on tip + ahead SHAs.
The verdict was correct; the waste was not.

## What changed

`push_sweep_ahead_range_lib.bb` + `handoffd.bb`'s `ahead-range-facts!`:

1. **One walk per tick** — QA and noop-merge (and the silent-revert ahead-sha
   list) project from a single shared gather.
2. **Refusal cache** — keyed on `main` tip SHA **plus** the ordered ahead-SHA
   vector. An unchanged key replays a previously **complete** gather.
3. **Never tip-only** — incomplete gathers are never stored; tip-is-ancestor
   alone never skips enumeration (BL-952 stays gone).

| Invalidation | Effect |
| --- | --- |
| New commit on local `main` | Fresh enumeration |
| `origin/main` advances (ahead set shrinks) | Fresh enumeration |
| Ahead set reordered at equal length | Fresh enumeration |
| Previous gather incomplete | Fresh enumeration |

## Operator note

Behaviour of refusals (`non-qa-ancestor`, noop-landing-merge, silent-revert)
is unchanged — only how often git is walked for the same stuck tip. Watch
`handoffd` logs for the same refuse reasons; expect fewer ahead-range walks
while the tip is frozen on a refusal.

Acceptance:
`specs/features/BL-1085-push-sweep-caches-its-refusal-and-gathers-once.feature`
(ticket slug: `BL-1085-push-sweep-re-proves-the-same-refusal-every-cycle`).

Related: Spec push-sweep entries (BL-356 / BL-630 / BL-855 / BL-1098 / BL-952).
