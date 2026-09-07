# Answer: the morning briefing has one author, the documenter (ruling A)

Specifier question raised 2026-09-07T08:35Z (role_ask, options A/B/C) on
QA's spec-gap note of the same morning ("briefing dual-compose race
recurred 09-07", evidence
`.worktrees/QA/backlog/evidence/morning-briefing-2026-09-07-qa-noop-20260907.md`):

> Spec gap (QA note 09-07): the morning briefing has two authors. Your 07-26
> ruling (BL-658) has the DOCUMENTER produce it as the night's last act, and
> the ceremony instructs it every night. BL-099 (07-04) and the live
> 'briefing due' nudge code say the COORDINATOR composes. Neither role prompt
> states the duty. On 09-07 the documenter refused citing the code, then both
> composed within one minute: the coordinator's text was emailed, the
> documenter's walked the whole pipeline to a QA no-op (same on 09-05). A
> documenter briefing also has no landing path (09-05 cherry-picked, 09-06
> hand-committed on main). Who authors the briefing? A = documenter (your
> ruling stands): QA lands its commit on a note like the art director's,
> coordinator never composes, the nudge is retargeted. B = coordinator: the
> ceremony instructs the coordinator instead, it commits on main directly,
> documenter never composes. C = keep both, the second stands down if the
> day's briefing is already on main.

Human answer, verbatim (2026-09-07, specifier pane): **"A documenter
authors (recommended)"**.

## Applied

- Prompt halves landed the same pass (this commit): `documenter.prompt`
  gains "The morning briefing is yours to author"; `coordinator.prompt`
  gains "The morning briefing is the documenter's, never yours";
  `QA.prompt` gains "Landing the documenter's morning briefing on its
  note" beside the BL-1444 art-director recipe. Prompts apply at the next
  respawn (01:00 night-start relaunch precedes the 05:00 ceremony).
- BL-1458: every briefing trigger instructs the documenter; the VS Code
  host's compose nudge is retired; one instruction literal (BL-897 mirror).
- BL-1459: `check_documenter_briefing_tip.sh` - lane guard in the shared
  pre-merge-commit chain, one landed briefing per day.

By specifier.
