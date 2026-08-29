# Verifying handoffd one-shot flags parse under Babashka

*How-to. Task-oriented: confirm every one-shot `handoffd.bb` CLI flag is
reachable under Babashka streaming eval, and know which commit on `main`
actually balanced `deliver!`.*

BL-636's landing commit (`6a2e4aaf6`) claimed it restored a `deliver!`
close-paren dropped by BL-611 — but that commit's own patch never touches
`handoffd.bb`. BL-728 traces the underlying bug independently of that message
and locks one-shot flags so the class cannot regress silently.

## The bug class

When `swarmforge/scripts/handoffd.bb` has an unbalanced `deliver!`
close-paren, Babashka's streaming eval fails while reading the file:

```text
EOF while reading, expected ) to match (
```

The entire script is unusable — including every one-shot CLI flag whose
`-main` cond branches never become reachable (`--poll-once`, `--sweep-once`,
`--chase-sweep-once`, `--reconcile-sweep-once`, `--startup-notify-only`,
`--print-preferred-rotate-target`).

BL-611 productization (`9bc8de790`) introduced this regression; the durable
fix on current `main` comes from merge `536c16ffb` re-adopting the balanced
`deliver!` tail from the BL-611 port lineage (`5f9a79511`). BL-636 does not
deserve credit for closing it.

Full timeline, commit references, and the BL-636 message audit live in
[`backlog/evidence/BL-728-handoffd-deliver-paren-verification-20260826.md`](../../backlog/evidence/BL-728-handoffd-deliver-paren-verification-20260826.md).

## Quick regression check

From the repo root (or any worktree with the script):

```sh
bash swarmforge/scripts/test/test_handoffd_one_shot_flags_parse.sh
```

Expect `ALL PASS`. The script uses a throwaway fixture root, fake tmux
socket, and `SWARMFORGE_ALLOW_TMP_DAEMON=1` — same discipline as other
`test_handoffd_*_wiring.sh` lanes.

Each one-shot flag must reach `-main` without a Babashka parse failure and
(with log-bearing flags) emit its `*-once done` line in
`.swarmforge/daemon/handoffd.log`.

## Acceptance contract

For the full scenario set (load, paren balance, evidence naming, fix-if-broken
vacuous path):

```sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-728-handoffd-deliver-paren-verification.feature
```

Compile first if step handlers changed (`npm run compile` from
`extension/`).

## Optional live spot-check

On a running swarm root (env permitting):

```sh
bb swarmforge/scripts/handoffd.bb . --poll-once
```

The log should contain `poll-once done` with no parse-phase error.

## Siblings

- [BL-723 pilot review — BL-636 section](BL-723-pilot-tonight-quality-review.md#bl-636) — the discrepancy that filed BL-728.
- [BL-727 pilot acceptance contract gate](BL-727-pilot-acceptance-contract-gate.md) — BL-729's commit-claim check closes the pilot-process half; BL-728 closes the underlying handoffd behaviour verification.
- [babysitterd runbook](BL-611-babysitterd-runbook.md) — BL-611 productization context for the enqueue removal that incidentally re-balanced `deliver!` during QA re-land.
