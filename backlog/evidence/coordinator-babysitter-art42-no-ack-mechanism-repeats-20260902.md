# babysitter Article 4.2 finding re-fires with no acknowledge/suppress path — 2026-09-02

## Observed
The exact same babysitter health-sweep alert (pipeline code on `main`
outside QA for `e358e1b46e` and `b71c941a19`) fired three times this
session. Both are already fully investigated and closed — see
[[coordinator-babysitter-bl1330-pipeline-code-sweep-20260902]] and
[[coordinator-bl1330-drop-fully-closed-20260902]]: `e358e1b46e` is QA's
legitimate land, `b71c941a19` was the specifier's Article-1.2-violating
hand-merge, already root-caused and fixed (`3310a24dfb`), with the
systemic guard gap tracked as `BL-1341`.

## Root cause
`.swarmforge/babysitterd/nudge-dedup.json` confirms both finding-keys
(`pipeline-code-on-main-e358e1b46e...`, `pipeline-code-on-main-b71c941a19...`)
DO get dedup-stamped on each nudge — the mechanism is working as designed.
`nudge-cooldown-ms` in `babysitter_check.bb` is a flat 30 minutes
(`(* 30 60 1000)`). There is no separate concept of "investigated and
confirmed legitimate/already-remediated" — only a rolling re-nudge timer.
Since both commits are permanent history on `main`, this specific finding
will keep firing every 30 minutes **forever**, with no way for a
coordinator to durably close it out the way `hotfix-ledger.yaml` lets a
hotfix be `--decide approved|waived`.

## Minimal correct action taken
No further re-investigation (nothing changed since the last two passes).
Sent a `note` (priority `10`, non-blocking — not a fresh operational
emergency) to the specifier flagging this as a process/tooling gap worth
its own ticket: the Article 4.2 CRIT detector needs an
acknowledge/waive path (analogous to the hotfix-ledger's
`--decide approved|waived`) so an already-investigated, already-legitimate
finding stops costing a coordinator turn every 30 minutes indefinitely.
Not minting the ticket myself (Article 1.2/1.1) — routing to the
role that owns spec/ticket authorship.

By coordinator.
