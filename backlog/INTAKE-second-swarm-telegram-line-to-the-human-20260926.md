# INTAKE — a second swarm must reach the human on its own Telegram from day one

Source: human via Claude Code, 2026-09-26: "gbh swarm needs me but it's not
surfacing anything on telegram. Onboarding should at a minimum create a topic
for the coordinator to use" and "can you fix the onboarding process to not do
the same mistake next time?"

## What happened (gpu-bargain-hunter, 2026-09-26)

GBH's coordinator was blocked on a human-only action: BL-022, a
not-applicable freshness gate that refuses every promotion because
`deprecate-check.js` is missing there. The request lived only in its tmux
pane. The human never saw it.

## Already fixed (operator hotfix, human-authorised)

- **e5a03ee6c7** (ledger 17c759242c, needs a stamp ticket):
  `provision-onboarding-telegram-channel.js` also opens a **Coordinator**
  topic and records it in the target's `.swarmforge/operator/role-topic-map.json`.
  It is idempotent and prints `coordinatorTopicId`. The tutorial now says
  `<swarm-name>` must equal the target's `config swarm_name`.
- **In GBH only** (its own repo, 38edcba / 9dde7e8 / its HEAD):
  - `swarmforge/scripts/notify_human.sh` (post to the Coordinator topic);
  - `human_replies.sh` (read the principal's replies there; one-time offset);
  - a coordinator.prompt rule to use both;
  - fleet dir renamed `gpu-bargain-hunter` → `GpuBargainHunter`.
  - Stopgap until BL-1757's front desk runs there.

- **6cef9b7ecd** (ledger 619590679f, needs a stamp ticket): the engine now
  ships `swarmforge/scripts/notify_human.sh` (message, or `--poll` for a
  multiple-choice ruling, at the human's ask) and `human_replies.sh`
  (messages + poll votes, `--peek`, refuses while a front desk runs). Both read
  creds from `~/.swarmforge/fleet/<swarm_name>/telegram.json` only.
  `test_notify_human_and_replies.sh` covers this (16 checks, fake Bot API).
  GBH now runs these engine copies (its 20950f6).

## Still wanted — the specifier to mint (check BL-1755..1759 first)

1. **Cross-swarm credential leak.** Every agent and daemon of a second swarm
   is launched through zsh. zsh sources `~/.zshenv`, which exports the
   PRIMARY swarm's `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`. Verified by hash
   on GBH's handoffd and coordinator: they carry swarmforgevc's token and chat
   `-1004415865297`, not GBH's own.
   - Every env-reading sender (`coordinator_activity_feed_post.bb`,
     `role_ask` paths, anything using `TELEGRAM_*`) would post a second
     swarm's messages into swarmforgevc's group. Nothing has leaked yet, only
     because nothing in GBH posts through env today.
   - Wanted: a non-primary swarm's launch scripts export its own fleet creds
     AFTER the shell profile is sourced, or env senders resolve through
     `fleet_telegram_creds_lib` the way the front desk does.
2. **Starter kit (BL-1758)**: the scripts already ship with the engine. What
   the kit must add is the coordinator.prompt rule, which is what makes a new
   coordinator use them. See GBH's `swarmforge/roles/coordinator.prompt`
   (notify when blocked; for multiple choice, send the context and then
   `--poll`; read `human_replies.sh` on every wake while a question is open).
   Until a front desk runs, that line is the only way a new swarm's
   coordinator can reach the human.
3. **Fleet dir naming.** The fleet dir must be keyed by the target's
   `swarm_name`. GBH's was keyed by its repo slug because `swarm_name` was set
   after provisioning.
   - Wanted: onboarding writes `swarm_name` into the target's pack BEFORE
     provisioning, from the same value.
   - Or: the provisioner reads it from the target instead of taking a free
     argument.

## Open question for the specifier to ask the human

Should the reply path be a stopgap per target (like GBH's `human_replies.sh`),
or should a target's coordinator topic go through swarmforgevc's own front desk
only (BL-1757) — with no Telegram reading at all until that lands?

## Specifier progress (2026-09-26, partial drain; do not re-mint)

- e5a03ee6c7's stamp -> BL-1774 (ledger linked); item 1 -> BL-1775;
  item 3 -> BL-1776, plus BL-1758 amended to write `config swarm_name`
  (commits c4898624d6, 5ee56cd6cf, 22cc0b3bf4).
- The open question was asked on the specifier's Telegram topic
  (role_ask, options A stopgap / B front desk only). Waiting on it:
  6cef9b7ecd's stamp, and item 2 (the coordinator rule, which lands in
  `swarmforge/starter-kit/roles/coordinator.prompt`). This file moves to
  `backlog/archive/` once both are done.
