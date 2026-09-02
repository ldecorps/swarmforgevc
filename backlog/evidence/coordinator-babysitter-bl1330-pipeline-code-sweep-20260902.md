# babysitter Article 4.2 sweep: e358e1b46e + b71c941a19 — 2026-09-02

## Sweep finding
Babysitter health sweep flagged both commits as pipeline code landed on
`main` outside QA (Article 4.2/BL-247):
- `e358e1b46e` "BL-1330: restore content dropped by human merge b71c941a19"
- `b71c941a19` "BL-1339: mint — BL-1334's land-approval record never reaches a reader"

Both touch `specs/pipeline/steps/bl1330SwarmStampBobAnthropicStartingCastSteps.js`,
`specs/pipeline/steps/index.js`, `specs/pipeline/steps/lib/bl1330QwenRemapPredicateCli.zsh`.

## e358e1b46e — false positive, legitimate QA land
`git log -1 --format=%B e358e1b46e` ends `By QA.` with a distinct
Claude-Session from mine. This is QA's own remediation commit, restoring
content it had already approved once (see
[[coordinator-bl1330-restored-build-freshness-blocked-20260902]]). QA is
the integration owner (Article 1.8) and is authorized to land pipeline
code. Not a violation.

## b71c941a19 — CORRECTS my earlier evidence: this was the SPECIFIER, not a human
My earlier evidence
([[coordinator-bl1330-content-dropped-by-human-merge-b71c941a19-20260902]])
concluded this was "authored directly by a human (`t <t@t>`), not by the
swarm's own reconcile daemon or by me" — that conclusion was **wrong**.
`t <t@t>` is the shared git identity every role commits as in this repo
(coordinator, specifier, coder, QA — all of them); it is not evidence of a
human hand on the keyboard. Reading the actual commit body (not just
`git log --stat`) shows:

```
By specifier.
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RuZaesDFdaX3ygsfRurgYf
```

This was the **specifier's own commit**, minting BL-1339. It is a MERGE
commit (parents `0132715d1e` — specifier's own prior main tip carrying only
the BL-1339 mint — and `0a5bffe057` — origin/main's tip at the time,
carrying BL-1330's just-landed content). The merge result:
- vs `0132715d1e` (first parent): adds only BL-1339's 2 mint files — looks
  like an unremarkable mint from that side.
- vs `0a5bffe057` (second parent): DROPS 510 insertions / 984 deletions
  worth of `0a5bffe057`-unique content wholesale — all six BL-1330 evidence
  files, both BL-1330 step-handler files, the `index.js` require line, and
  reverts `backlog/topics/BL-1334.json`'s content back a version — while
  keeping `backlog/paused/...record-lands-where-the-predicate-reads.yaml`
  net-unchanged (deleted then re-added identically). The merge behaved as
  if `0a5bffe057`'s unique changes were discarded outright, not as an
  ordinary three-way merge would.

## Why this matters
Article 1.2 is explicit: the specifier "Writes specifications and
prompt/constitution files only; never merges, closes tickets, or
integrates." Whatever produced this merge commit (a manual `git merge
origin/main` before committing the mint, most likely, though the exact
command isn't in the commit body) is exactly the operation Article 1.2
forbids the specifier from doing — and it caused the real content-loss
incident already reported and now remediated by QA. This is a process
defect in the specifier's own commit flow, not (as I previously reported)
a one-off human keyboard event.

## Minimal correct action taken
- Corrected the record here rather than leaving the earlier mis-attributed
  evidence uncorrected.
- Sent a `note` (priority `00`) to the specifier: their own commit
  `b71c941a19` was a merge (forbidden by Article 1.2) that dropped
  BL-1330's already-landed content; asking them to identify what in their
  flow performed the merge and avoid repeating it. Not filing this as a
  ticket myself — it's the specifier's own process to correct, and they
  are best placed to know what command sequence produced it.
- No further remediation needed on the content itself — QA's `e358e1b46e`
  already restored it and is confirmed correct.

By coordinator.
