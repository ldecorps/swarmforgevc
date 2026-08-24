# Mint-time hygiene refuses a dangling acceptance pointer (BL-1027)

## The gap

Existence of an `acceptance:` feature path was already checked twice — at
promotion (BL-626) and on every pre-QA `git_handoff` (BL-880) — but neither
runs while a ticket sits unpromoted in `paused/`. BL-579, BL-580, and BL-1025
advertised missing feature files for days or weeks with no gate notice.

BL-922 already taught the specifier hygiene gate to catch the block-scalar
hiding a path at mint. This ticket applies the same “catch it here” rule to
a plain single-line pointer that names a file that is not on the working tree.

## What changed

`backlog_hygiene_lib.bb` adds `dangling-acceptance-violation`:

1. Read the `acceptance:` **line tail** (same residue BL-922 / pre-QA see).
2. Ask `acceptance-pointer-gate-lib/applicable?` whether that declaration is
   checkable — **one** predicate shared with BL-880 (no second shape rules).
3. Probe the **working tree** (mint runs before commit; `git cat-file` does
   not transfer).
4. Emit `DANGLING-ACCEPTANCE <id> … "<path>" does not exist on the working tree`.

The specifier hygiene gate and the repo-wide epic/milestone audit both report
the new class. A multi-YAML run names **every** offender in one pass.

Still passes (not this check’s job): absent `acceptance:`, block scalars with
no path, glob-shaped mentions, epic-tracker prose (`none: "tracker only…"`),
and present `.feature` / parked `.feature.draft` files.

## Operator note

When minting or editing paused YAML, run
`swarmforge/scripts/specifier_backlog_hygiene_gate.sh` on the touched files.
If you see `DANGLING-ACCEPTANCE`, create or rename the feature file (or fix
the pointer) before handoff — do not wait for promotion or the first coder
hop.

Promotion (BL-626) and pre-QA pointer (BL-880) gates stay as backstops for
paths that dangle **after** mint.

Acceptance:
`specs/features/BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.feature`

Related: `docs/how-to/BL-531-handoff-refusal-remedies.md` (acceptance-pointer
at handoff time).
