# BL-1266: The Reference-Freshness Guard's Ref Selection Is Per Path

BL-1237 made the pre-turn reference-freshness guard (`ready_for_next.bb`,
backed by `reference_freshness_lib.bb`) direction-aware, but left the guard
picking a single comparison ref — `main` or `origin/main` — by comparing
**whole-repository** ahead-counts (`freshest-main-ref`). That is a proxy for
a different question than the one the guard actually needs answered: "which
ref holds the newer copy of each of these thirteen `articles/reference/*`
files?" `origin/main` can be 200 commits ahead of local `main` without
touching `reference/` at all, while local `main` carries the one commit
that did — and QA lands by pushing straight to `origin/main`, while the
specifier commits directly to local `main`, so the two refs disagreeing is
this repo's steady state (`6`/`213` at mint time), not an edge case.

## The two failure modes this produced

- **Fail-open** (the one that matters): if `origin/main` wins the
  whole-repo count but local `main` carries a reference amendment
  `origin/main` doesn't, the guard reads `origin/main`'s stale copy. A
  worktree that has genuinely never merged the amendment matches that stale
  copy byte-for-byte and is waved through — the exact drift BL-640 exists
  to refuse, passing silently.
- **Fail-closed with the wrong remedy**: same setup, but the worktree HAS
  merged the amendment. Its content differs from the picked ref's copy; if
  the two refs' commits for that path have diverged, the ancestry probe
  fails and the turn is refused — naming `origin/main` when the missing
  content was actually on local `main` (or vice versa). This is what
  blocked the specifier seat pre-dispatch on 2026-08-29.

## The fix: stop picking a ref, ask every ref per path

`freshest-main-ref` is gone — no caller is left for a single "which ref
wins" answer. `reference_freshness_lib.bb` gained
`stale-paths-multi-ref`/`fresh-multi-ref?`/`staleness-report-multi-ref`,
still pure decision logic with no `sh` calls:

- `refs-shas`: `{ref-name -> {rel-path -> sha}}` — one map per ref that
  carries the reference dir (`ready_for_next.bb`'s `candidate-refs` always
  includes `"main"`, and adds `"origin/main"` only when that ref actually
  resolves — a repo with no remote, like the guard's own unit fixtures, is
  judged against local `main` alone, unchanged).
- `worktree-has-ref-amendment?`: `{[ref-name rel-path] -> boolean}` — the
  same BL-1237 ancestry answer, now keyed per `(ref, path)` pair instead of
  per path against one pre-selected ref.
- A path is fresh only once **every** ref that carries it is satisfied —
  one ref agreeing never excuses a different ref's amendment being missing.
- The refusal (`staleness-report-multi-ref`) names each stale path together
  with the **specific ref** whose amendment is missing, and its remedy
  merges exactly the refs actually needed — never a blanket "merge main"
  when the missing content is on `origin/main`.

`ready_for_next.bb`'s `enforce-reference-freshness-guard!` gathers the
per-ref content and ancestry facts (`ref-reference-shas`,
`path-ancestry-absorbed?`, run once per differing `(ref, path)` pair) and
passes plain maps into the pure lib functions — the same pure/IO split
BL-1237 established.

## What this does not change

- BL-1237's direction-awareness (ahead is not stale) — unaffected; this
  ticket only changes which ref(s) the ancestry question is asked of. See
  [BL-1237](BL-1237-reference-freshness-guard-is-direction-aware.md).
- BL-640's original refuse-on-genuine-drift behavior — unweakened; a
  worktree missing an amendment on any carrying ref still refuses.
- The `main`/`origin/main` divergence itself (BL-891) — the guard must be
  correct while the two diverge; closing that gap is out of scope here.

## Acceptance

`specs/features/BL-1266-reference-freshness-ref-selection-is-per-path.feature`,
driven by `specs/pipeline/steps/bl1266ReferenceFreshnessRefSelectionSteps.js`.
Property coverage:
`swarmforge/scripts/test/bl1266_reference_freshness_ref_selection_property_runner.bb`.
