# BL-989 hardener pass — portable grep tab anchors — 20260825

**QA bounce tip:** `f9dfc20806` (missing hardener stage on documenter `6c1a9dc25e`)
**Product rematch:** `6c1a9dc25e` onto live `origin/main`
**Task:** `BL-989-grep-dash-p-is-gnu-only-breaks-on-macos-bsd-grep`

## Tip purity

`git reset --hard origin/main` → rematch BL-989 (+ batch sibling BL-1143).
Authorize **BL-989 paths** (shared tip also carries BL-1143/BL-1142 dep).

## Product surface

Three shell helpers: portable `printf '^…\t'` tab anchors instead of
GNU `grep -P`. Tree sweep excludes hardener `*mutation_sweep.sh` (mutants
encode the antipattern by design).

## Gates

| Gate | Result |
|------|--------|
| `test_role_lifecycle_cli.sh` | ALL CHECKS PASSED |
| `bl989PortableGrepTabAnchor.property.test.js` | 3/3 |
| APS BL-343 feature | 7/7 |
| Soft Gherkin BL-1143 (batch) | inapplicable — not a pass |
| Surgical (7) | killed=7 survived=0 skipped=0 |
| BL-149 | lifecycle helper `run` |

## Soft → surgical (BL-638)

No Outline on the BL-989-owned surface; hand surgical restores GNU `-P` /
drops tab anchors. Survivors killed by property + lifecycle.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-989 only for this
parcel (batch sibling BL-1143 forwarded separately).

By hardender.
