# Closing ceremony — shift 2026-09-14 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-14.json`, `deliveredAt`
2026-09-14T00:00:00Z, folded 07:55 local, read via the coordinator's
priority-00 note (`00_20260914T065557Z_008239`). The run was `pending` on
arrival (`outcome: null`), so the outcome is recorded in the store.

**Outcome recorded: `process_ticket`, ref BL-1560.** Two further findings
of the same pass are minted as BL-1561 and BL-1562 and named here; all
three are in `backlog/paused/`, `human_approval: pending`, epic
`tool-miss-auto-heal` (BL-912).

## What the packet showed

Five tickets walked the chain overnight — BL-1538, BL-1539, BL-1540,
BL-1541 (the four BL-1028 standing-red owners) and BL-1553 — closed by
08:30Z with no bounces and no skips; path taken cleaner → architect →
hardender → documenter → QA → coder. Dwell hotspots coder 5011858ms,
architect 3344827ms, QA 2211044ms. Stalls: cleaner chase ×10 + respawn ×1,
coder chase ×3 + respawn ×1, documenter chase ×2. Hypotheses: coder dwell;
"10 chase(s) in cleaner this shift — chase pattern". Quality dial: lower ×3
on stage_transition (architect, hardender, QA), raise ×3 on stalls
(cleaner, coder, documenter) — advisory, the coordinator's half.

## The signal I acted on — BL-1560

The cleaner's chase rows line up with the seat hunting for the helper:
BL-1538 chase ×4 (00:20–00:27Z) with a `respawn` row at 00:25Z, BL-1539
×2 (01:22–01:26Z), BL-1540 ×1 (01:57Z), BL-1553 ×2 (06:27–06:43Z). The
cleaner transcript for 09-14 shows `./ready_for_next.sh 2>&1 | tail -50`
at 00:27:45Z, 01:26:14Z, 02:47:00Z (followed 2 s later by `find /
-maxdepth 6 -iname ready_for_next.sh`, the 120 s hunt) and 06:43:41Z.
Across all six worktree roles: 31 root-level attempts between 00:17Z and
06:53Z, four `find /` hunts (cleaner 02:47Z, documenter 05:54Z, architect
06:45Z, QA 06:53Z), and ZERO after 07:00Z — the minute hotfix 1fc9065605
landed (human-directed, after the architect stall at 06:45Z). Count made
with a python scan of `~/.claude/projects/-home-carillon-swarmforgevc--
worktrees-<role>/*.jsonl` for `"command": "./ready_for_next.sh` and
`"command": "find / ` rows stamped 2026-09-14.

The hotfix ledger row `1fc9065605` was `state: pending, stamp_ticket:
null`, and the coordinator's stamp note (`00_20260914T070146Z_008248`,
"Hotfix 1fc9065605 landed: seats stop hunting ./ready_for_next.sh; stamp
it") was queued behind this packet — one ticket serves both. Minted
**BL-1560** (`type: defect`, `severity: medium`): the BL-848 review of the
landed diff — classifier rows, healed-command rows, the real composed
wrapper end to end, the exit-code-only gate for tokenless commands, the
runner's case census, the five rendered launch bodies plus the
RESUME-ON-START note, and the human-only ledger decision. Seven scenarios.
Ledger row linked in the mint commit.

## The second finding — BL-1561 (a data token is rewritten)

Reproduced on this seat while reviewing the diff: a command that names a
root-level `./x.sh` token as DATA and whose exit-0 output echoes the miss
text is re-run with its data rewritten. `grep -n 'no such file or
directory: ./ready_for_next.sh' t.log` over a git-init fixture holding
that line, composed through the real `build-healing-wrapper-command` and
run by bash, printed `2:zsh: no such file or directory:
./swarmforge/scripts/ready_for_next.sh` with exit 0 — the search string
was repointed and the file's line reported as something it is not. The
same wrapper over `grep -c` (a count; no miss text in the output) ran
once, untouched. Cause: `ROOT-SCRIPT-TOKEN` has no notion of command
position or quoting, and the masked-exit-0 opener fires on the output
pattern alone. The command it bites is the transcript grep the incident
notes recommend. Minted **BL-1561** (`type: defect`, `severity: medium`):
command-position tokens only; the masked opener additionally requires the
helper to be absent at the root and present under the pin; the hotfix's
own e2e stays green (scenario 03). Three scenarios (one outline of six).

## The third finding — BL-1562 (the wake nudge still says the bare name)

The hotfix fixed the BOOT nudge. The tmux WAKE line typed on every
delivery (`agent_runtime_lib.bb` `default-wake-chat-message`, aliased by
`handoffd.bb` and `handoff_inject_lib.bb`) still reads "If idle, run
ready_for_next.sh." — with the two in_process resume messages, two
`reference_freshness_lib.bb` hold lines and `handoff_lib.bb`'s ACTION
line: 6 user-facing strings (`grep -rn 'run ready_for_next\.sh'
swarmforge/scripts/*.bb` = 8 lines, 2 are comments). Every delivery
re-teaches the spelling the boot nudge unlearned; the heal class covers it
only on a seat whose worktree carries the hotfix, and at mint
`swarmforge-cleaner` did not (`git branch --contains 1fc9065605`: main,
coder, architect, hardender, documenter, QA). Minted **BL-1562**
(`type: defect`, `severity: low`): compose the six from
`prompt-engine-lib/ready-script-rel-path` with a BL-897 agreement test.
Two scenarios (one outline of six rows, one census pin).

## Signals I looked at and did not act on

- **Coder dwell 83 min.** Five parcels' own `processingMs` summed across
  the resident's home seat; per-parcel it is minutes. Nothing to ticket.
- **The two `respawn` rows** (cleaner 00:25:38Z on BL-1538, coder). Same
  shape as 09-13: BL-1551 (paused, pending approval) owns the
  skip-busy phantom; no new ticket.
- **`qualityRecommendations`** lower ×3 / raise ×3: advisory.
- **Determinism candidates** `pass-bounce-evidence` (0.022),
  `backlog-promotion` (0.199) — `backlog-closure` dropped off this
  packet. Still no open `ritual_class:` declarant (BL-1479 declared
  `backlog-promotion` and is in `done/M8/`). None of the three tickets
  minted here touches either ritual's scripting, so none declares a
  class — a false declaration would only hide it. Not ticketed, same
  reasoning as the 09-08..09-13 passes; expect both again.
- **2026-09-12's run still reads `outcome: null`.** Owned by BL-1528
  (undeliverable-note shape) and BL-1537 (the trigger); not this pass's.
