Feature: A swarm resolves its Telegram creds from its own fleet creds file, keyed by swarm_name

# BL-436 (feature, epic BL-435 slice 1): Telegram separation is the FES second-swarm epic's first
# proof-point. The one-bot-per-target rule is already settled and structurally enforced (a shared token
# gives 409 Conflict + a shared global offset = silent message theft), but the isolation is fragile at
# the LAUNCH boundary: a second supervisor launched from a shell that already exported the primary's
# TELEGRAM_BOT_TOKEN silently inherits it. Make the token a property of the SWARM, not of whatever shell
# launched it. Per-swarm creds live at ~/.swarmforge/fleet/<swarm_name>/telegram.json =
# { botToken, chatId, bridgePort } (under host $HOME, never in the target working tree - secrets rule).
#
# front_desk_supervisor.bb today resolves creds from ambient env (System/getenv "TELEGRAM_BOT_TOKEN" /
# "TELEGRAM_CHAT_ID", ~lines 277-279) and BRIDGE_PORT (~line 123). It should resolve by its own
# swarm_name from the creds file instead, FALLING BACK to env for the primary swarm so nothing existing
# breaks. provision-onboarding-telegram-channel writes this file on group-detection (a small change to
# its persistence target).
#
# Scope (verify at build time): swarmforge/scripts/front_desk_supervisor.bb (creds + bridge-port
# resolution by swarm_name, env fallback for primary), the creds-file schema/reader, and
# extension/src/tools/provision-onboarding-telegram-channel.ts /
# extension/src/onboarding/telegramChannelProvisioning.ts persist target. Confirm the live source of the
# swarm's swarm_name (SWARM_NAME env / launch identity) at build time.

# BL-436 per-swarm-telegram-creds-01
Scenario: A non-primary swarm resolves its bot token and chat id from its fleet creds file
  Given a fleet creds file exists for swarm "fes" with a bot token and chat id
  When the front-desk supervisor for swarm "fes" resolves its Telegram creds
  Then the token and chat id come from the fleet creds file
  And not from the ambient environment

# BL-436 per-swarm-telegram-creds-02
Scenario: The primary swarm with no creds file falls back to the environment
  Given no fleet creds file exists for swarm "primary"
  And the environment provides a bot token and chat id
  When the front-desk supervisor for swarm "primary" resolves its Telegram creds
  Then the token and chat id come from the environment

# BL-436 per-swarm-telegram-creds-03
Scenario: A creds file overrides an inherited primary token exported into the launching shell
  Given a fleet creds file exists for swarm "fes" with its own bot token
  And the launching shell exported the primary swarm's bot token into the environment
  When the front-desk supervisor for swarm "fes" resolves its Telegram creds
  Then it uses the creds file's token
  And it does not inherit the exported primary token

# BL-436 per-swarm-telegram-creds-04
Scenario: The bridge port is read from the creds file for a non-primary swarm
  Given a fleet creds file exists for swarm "fes" with a bridge port
  When the front-desk stack for swarm "fes" resolves its bridge port
  Then the bridge port comes from the creds file

# BL-436 per-swarm-telegram-creds-05
Scenario: Channel provisioning writes the creds file on successful group detection
  Given channel provisioning detects the group for swarm "fes"
  When it persists the channel
  Then it writes botToken, chatId, and bridgePort to swarm "fes"'s fleet creds file
