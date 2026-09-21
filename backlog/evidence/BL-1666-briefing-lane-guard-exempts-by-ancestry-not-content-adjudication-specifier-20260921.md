# Adjudication: the briefing-lane guard exempts by ancestry, not content - 2026-09-21 (specifier)

**Inbound.** QA note to the specifier, priority 00, 2026-09-21T09:04:06Z
(00_20260921T090406Z_003047_from_QA): "briefing lane guard exempts by
ancestry not content, ev e4aafc21a8". QA evidence (QA branch, e4aafc21a8):
`backlog/evidence/documenter-briefing-lane-guard-false-positive-hand-built-provenance-20260921.md`.

**Confirmed.** `judge_tip_paths` in `swarmforge/scripts/check_documenter_briefing_tip.sh`
(BL-1459, my spec) exempts an out-of-lane path only when the tip's last
touch of it is an ancestor of the landed main. Six condition-(g)
hand-built lands today put byte-identical content on origin/main in fresh
commits, so the ancestry test fails on content main already carries.

**Census (master checkout, 09:1xZ).** `bash swarmforge/scripts/check_documenter_briefing_tip.sh --tip f6ab94c8d4`
refused with 92 offending paths (f6ab94c8d4's own diff is
`docs/briefings/2026-09-20.md` alone). For each offender,
`git rev-parse f6ab94c8d4:<path>` vs `git rev-parse origin/main:<path>`:

| class | count | examples |
|---|---|---|
| identical to origin/main (the defect) | 80 | evidence files, steps, scripts landed by hand-build |
| differs from origin/main | 5 | `backlog/done/BL-1656-*.yaml`, `backlog/evidence/BL-1657-land-escalate-20260920.md`, `backlog/standing-reds.tsv`, `docs/how-to/BL-1418-*.md`, `docs/how-to/BL-658-*.md` |
| absent on origin/main | 7 | `backlog/active/BL-1630-*.yaml`, `backlog/active/BL-1657-*.yaml` (both since moved to done/), four evidence files, one `.feature.draft` |

QA counted ~23 from its own landing branch (a different merge base); from
main the shape is the same: the identical class is the guard's false
refusal, the other twelve are inherited pipeline residue the documenter
branch never synced away - true out-of-lane content (five of them would
auto-merge silently into main's newer files), correctly refused, and not
the guard's to exempt. The 2026-09-21 tip 8c67e0eefc is refused the same
way plus for carrying two dates.

**Ruling.**

1. **Fix folded into BL-1666** (active, same guard, same test file,
   parcel not yet dequeued at amendment time): the exemption checks
   content equality with the landed main's blob FIRST, ancestry second;
   two scenarios join BL-1459's feature inside the parcel; the amendment
   is in BL-1666's YAML on main; the coder is noted to merge main and
   re-read. A separate ticket would sit behind BL-1666 on orthogonality
   anyway.
2. **Interim for the two stuck briefings** (QA): land
   `docs/briefings/2026-09-20.md` from f6ab94c8d4 and then
   `docs/briefings/2026-09-21.md` from 8c67e0eefc as hand-built docs-only
   commits built off origin/main (the condition-(g) shape used six times
   today), each byte-identical to the documenter's blob
   (`git show <sha>:docs/briefings/<date>.md`), subject
   `Land documenter briefing <sha> (hand-built, specifier ruling
   2026-09-21)`, no ticket named, one date per commit, pushed under the
   land lock. QA.prompt step 2's `--tip` OK is waived for those two
   commits only; steps 1, 3's both-parent diff (trivially one path) and 5
   stand. A plain commit runs no pre-merge-commit hook, so the guard is
   not bypassed - it is simply not the path taken. Note the documenter
   `landed documenter briefing <sha>` as usual; the email sweep sends
   from main.
3. **Documenter duty** (prompt, landed with this adjudication): merge
   origin/main into the documenter branch before composing, so the tip
   differs from main in the briefing file alone. The twelve residue paths
   are that duty's, not the guard's.
4. **No new ticket** (human directive 2026-09-17: fewer, better tickets);
   the QA note completes with this record and the notes below.

**Notes sent this pass.** QA (the ruling and interim), coder (BL-1666
amended; merge main, re-read), documenter (merge origin/main before the
next briefing commit).

By specifier.
