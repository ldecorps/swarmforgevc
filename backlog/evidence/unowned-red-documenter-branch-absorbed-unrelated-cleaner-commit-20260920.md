# Unowned finding: swarmforge-documenter carries an unrelated, unlanded cleaner commit as an ancestor, 2026-09-20

Found live while merging cleaner's BL-1630 bounce commit `8727537263`
into coder: `check_documenter_briefing_tip.sh`'s hook mode (BL-1459,
this session's own ticket) refused the merge wholesale, because
`8727537263` - a cleaner-authored commit with nothing to do with
`docs/briefings/` - turned out to already be `git merge-base
--is-ancestor`-true against `swarmforge-documenter`, despite `8727537263`
not being reachable from `origin/main` or local `main` (it is not landed
anywhere).

Traced the path: `swarmforge-documenter`'s current tip (`1e4188f16e`) ->
first parent `d6ee40aecb` ("Merge main 205bfdef00 into documenter") ->
first parent `6398518814` ("BL-1654: documenter review pass evidence
(NONE)") -> ... -> `8727537263`. The documenter's own first-parent chain
(its own real work, BL-1654) already contains cleaner's unrelated BL-1630
commit, with no merge commit of cleaner's branch anywhere visible in that
walk - it reads as though the documenter's OWN linear commit history
absorbed it directly, not via an ordinary `git merge`.

This is the coder's own worked-around symptom (BL-1459 hotfix,
commit f46bd22ab1: hook mode now requires exact-tip equality, not
ancestry, closing the guard's own exposure) - not a fix for the root
cause, which is this cross-branch entanglement itself. Same shape as
BL-1616's "duplicate seat rework rides every branch" and BL-1655's
"reclaimed claim stays with the seat that held it" - a commit crossing
into a branch it has no business being in, most likely via a tip-pure
land-replay or reclaim mechanism carrying more than intended. Given the
volume of similar incidents this session (BL-1616, BL-1655, coder@2
building BL-1652 twice), this may be a systemic replay/reclaim defect
worth its own investigation rather than a one-off.

`grep -i documenter.*absorb\|branch.*entangle` over backlog/standing-reds.tsv
finds no row (this is not a test failure, so it may not belong in that
register at all - a specifier judgment call).

By coder.
