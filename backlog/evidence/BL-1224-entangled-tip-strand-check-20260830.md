# Strand check — QA note "BL-1224 landed tip-pure again (BL-1241), coder branch entangled w/ BL-1235"

**Disposition:** nothing stranded, **no ticket minted**. Second application of the
procedure recorded in `BL-1243-entangled-tip-strand-check-20260830.md`.

## This one looked worse than BL-1243's and was not

Unlike BL-1243 — where the `abandoned_commits` turned out to be ancestors of
`main` — all four here are genuinely unreachable:

| commit | on `main` | on `origin/main` |
|---|---|---|
| `0de070faad` (documenter: how-to + Specification.MD) | NO | NO |
| `c7f2a3b667` (documenter re-pass evidence) | NO | NO |
| `1ddc283639` (QA bounce evidence) | NO | NO |
| `729d88f798` (architect merge) | NO | NO |

That is the expected result of a tip-pure rebuild: it severs descent by design.
Unreachable SHAs are not the question. **Content is.**

## Content check — all of it landed

The replay preserved every byte:

- `docs/how-to/BL-993-operator-runtime-watch.md` — blob at `0de070faad` is
  **byte-identical** to the blob on `main` (same object hash).
- `docs/reference/Specification.MD` — likewise byte-identical, and its BL-1224
  entry is present.
- `backlog/evidence/BL-1224-documenter-repass-20260830.md`,
  `BL-1224-bounce-20260830.md`, `BL-1224-architect-review-20260830.md` — all
  three on `main`.

So the documenter pass, the bounce record and the architect review all survived;
only the commits carrying them were superseded.

## Why this check is not optional

`b86ef5e28` — *"land the original bounce evidence file, referenced by
bounce_history but dropped from the earlier tip-pure rebuild"* — is the same
remedy dropping a file that a ticket referenced. The replay is "only this
ticket's own paths", and what counts as *its own* is a judgement made by hand.
Comparing blob hashes, not commit reachability, is what distinguishes a correct
rebuild from a lossy one.

`main...origin/main` was `0 0` at check time, so no lag confounded the reads.
