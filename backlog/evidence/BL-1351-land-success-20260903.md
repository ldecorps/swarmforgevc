# BL-1351 — LAND SUCCESS, 20260903

Follows `BL-1351-qa-approval-20260903.md` (full independent verification,
APPROVE, `9c685a0d2e`).

## Same discipline as every land this session

Hand-built the tip-pure commit from BL-1351's own pipeline commits,
net-diffed against `origin/main`. The ticket YAML, topic record, and the
day's briefing doc (`docs/briefings/2026-09-03.md`, incidentally in the
merge but not BL-1351's own — landed separately) were already
identical/landed on `origin/main` and needed no edit.
`docs/reference/Specification.MD`'s changelog-prepend applied by hand,
copied verbatim from `swarmforge-QA`'s own top entry with BL-1344's entry
demoted to "Prior entry —", diffed clean and matched exactly (50 lines
both sides, confirmed before commit).

The first acceptance run in this pass hit a stale `extension/out/` build
in this worktree (predated the source; `streamSnapshot.js` did not exist
in `out/` at all) and produced a false failure — noted in the QA-approval
evidence so it isn't mistaken for a real defect later. `npm run compile`
before every subsequent run fixed it; the tip-pure tree was re-verified
compiled and clean before commit.

## Landed

- Tip-pure commit `f8856bd935` built on `bl1351-landtry` off `origin/main`
  at `aee7842214`. `git diff --cached --stat` confirmed exactly the
  intended 15-file own-paths list before committing (1272 insertions(+),
  2 deletions(-)). `origin/main` had not advanced between building and
  pushing — no rematch needed.
- Pushed: `aee7842214..f8856bd935` to `origin/main`.
- `swarmforge-QA` merged up to `f8856bd935`. No code conflicts (the merge
  pulled in unrelated backlog bookkeeping and two new paused mints,
  BL-1357/BL-1358, from concurrent specifier work).
- `abandoned_commits: [9c685a0d2e]` recorded on the ticket YAML.
- Temp branch `bl1351-landtry` deleted;
  `.swarmforge/land-main.publish.lock` released.

By QA.
