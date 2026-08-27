Feature: Channel provisioning follows a group-to-supergroup migration instead of latching the dead id

# BL-444 (bug): first real run of provision-onboarding-telegram-channel against FES, 2026-07-15. The
# human created a basic group and added the bot (id -5274683022), then enabled Topics as the CLI's own
# instructions direct - Telegram silently UPGRADED it to a supergroup with a NEW id (-1003886489685) and
# emitted migrate_to_chat_id updates. decideChannelDetection (telegramChannelProvisioning.ts) takes the
# FIRST chat any update carries, and the queue still began with the pre-migration group's updates, so
# every re-run latched the DEAD id and failed forever: first "400: the chat is not a forum" (pre-Topics),
# then "400: group chat was upgraded to a supergroup chat" (post-migration). The celebrated idempotency
# does not converge here - it re-fails identically each run. Provisioning only succeeded after manual
# getUpdates?offset= surgery. Because the CLI's own emitted steps ("create a group ... THEN enable
# Topics") CAUSE this migration, every future onboarding hits it - it is the documented happy path.
#
# Scope (verify at build time): extension/src/onboarding/telegramChannelProvisioning.ts -
# decideChannelDetection (honor migration signals; prefer the migrated-to id) and the getUpdates offset
# handling (advance past consumed updates on success). BL-380 is the parent feature.

# BL-444 provisioning-follows-supergroup-migration-01
Scenario: Detection selects the migrated supergroup id, not the pre-migration group id
  Given the update queue contains a basic group's updates followed by its migration to a supergroup
  When channel detection runs
  Then the detected chat id is the migrated-to supergroup id
  And not the pre-migration group id

# BL-444 provisioning-follows-supergroup-migration-02
Scenario: A "upgraded to a supergroup" error carrying the new id is followed as a redirect
  Given creating the forum topic returns "group chat was upgraded to a supergroup chat" with a migrate-to id
  When provisioning handles that error
  Then it retargets the new supergroup id
  And it does not treat the upgrade as a terminal failure

# BL-444 provisioning-follows-supergroup-migration-03
Scenario: The confirm offset advances past consumed updates after a successful provisioning
  Given provisioning has succeeded against the migrated supergroup
  When the confirm offset is persisted
  Then it is advanced past the updates already consumed
  And a later re-run does not re-observe the stale pre-migration updates

# BL-444 provisioning-follows-supergroup-migration-04
Scenario: A re-run after the migration is idempotent and does not re-fail on the dead id
  Given a prior run already detected the migrated supergroup
  When provisioning runs again
  Then it detects the same live supergroup id
  And it does not fail on the pre-migration group id
