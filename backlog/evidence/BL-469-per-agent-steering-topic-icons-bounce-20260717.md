# BL-469-per-agent-steering-topic-icons — QA bounce 2026-07-17 (2nd bounce)

1. **Failing command**:
   ```
   node -e "
   const { ROLE_TOPIC_ICON } = require('./extension/out/concierge/topicIcon');
   const { EPIC_ICON_POOL } = require('./extension/out/concierge/epicIcon');
   const roleIcons = new Set(Object.values(ROLE_TOPIC_ICON));
   const KNOWN_EPIC_ICON = { 'role-benchmarking': '🎙', 'dynamic-routing': '🎭', 'onboarding-target-repo': '🎬' };
   for (const icon of EPIC_ICON_POOL) if (roleIcons.has(icon)) console.log('POOL COLLISION:', icon);
   for (const [epic, icon] of Object.entries(KNOWN_EPIC_ICON)) if (roleIcons.has(icon)) console.log('FIXED COLLISION:', epic, icon);
   "
   ```

2. **Commit hash checked out and tested**: `494d9b36782eeac82ca560a28aa19853de338e77`
   (QA's merge of the documenter's combined BL-475/BL-477/BL-469 batch commit
   `35da569b7f`; the icon table itself is unchanged since the coder's
   `92633334d1` "BL-469: apply the human-approved Telegram icon remap").

3. **First error excerpt**:
   ```
   POOL COLLISION: 🎬
   POOL COLLISION: 📚
   FIXED COLLISION: onboarding-target-repo 🎬
   ```
   `ROLE_TOPIC_ICON.coordinator` is `🎬`. `extension/src/concierge/epicIcon.ts`
   fixes `KNOWN_EPIC_ICON['onboarding-target-repo'] = '🎬'` (finalised with the
   human 2026-07-16, per that file's own comment) — a deterministic, guaranteed
   collision whenever both the coordinator's per-agent topic and the
   `onboarding-target-repo` epic topic exist, not a probabilistic one.
   `ROLE_TOPIC_ICON.documenter` is `📚`, the LAST entry in
   `EPIC_ICON_POOL` (`🎙🎭🎬🎤🎨🎩🕺💃✍️📚`) — `resolveEpicIcon`'s own fallback
   (`next ?? EPIC_ICON_POOL[EPIC_ICON_POOL.length - 1]`) returns exactly `📚`
   once the pool is exhausted, so any epic created after the 9th pool slot is
   taken collides with the documenter's role-topic icon too.
   Both surfaces are live-wired to the same Telegram forum-topic-icon
   mechanism: `conciergeTick.ts:571` calls `syncTopicIcon` for role topics
   with `ROLE_TOPIC_ICON[target.role]`, and `conciergeTick.ts:732` calls the
   same `syncTopicIcon` for epic topics with `resolveEpicIcon`'s output — so
   this is a real, user-visible icon collision on the actual Telegram surface,
   not merely a data-structure overlap.

4. **Failure class**: `behavior` — the ticket's own FIRM, human-approved
   contract (`human_approval:` block) states: "No collision with any existing
   icon table: the approved mapping (🎬📝🏛💻🧼🧪🔎📚) shares no glyph with
   ICON_EMOJI (✅🦠🎵🔍👀), STANDING_TOPIC_ICON (🎟🛎📋📜), or epic icons
   (🏆⚡️📁)." The `ICON_EMOJI` and `STANDING_TOPIC_ICON` claims are correct
   (independently verified against `extension/src/concierge/topicIcon.ts` —
   no overlap). The epic-icon claim is wrong: `🏆⚡️📁` do not appear anywhere
   in the tree (`grep -rl "🏆|⚡|📁" extension/src pwa` = no matches) — the
   real epic icon set is `epicIcon.ts`'s `EPIC_ICON_POOL` +
   `KNOWN_EPIC_ICON`, which the collision check evidently never consulted,
   and which DOES collide as shown above.

5. **Expected vs observed**: Expected — none of the 8 `ROLE_TOPIC_ICON`
   glyphs collides with any glyph a live epic topic can carry (per the
   ticket's own firm contract). Observed — `coordinator`'s `🎬` is
   identical to the fixed epic icon for `onboarding-target-repo` (guaranteed
   collision, both topics can coexist live today), and `documenter`'s `📚`
   is identical to the epic pool's exhaustion-fallback icon (collision once
   10+ epics exist).

## Independent live-set verification (unaffected by this bounce)
All 8 `ROLE_TOPIC_ICON` glyphs DO independently resolve against Telegram's
live `getForumTopicIconStickers` set (112 stickers, verified 2026-07-17 with
the real bot token — sticker ids match the ticket's documented set exactly).
That part of the prior bounce (`BL-469-bounce-20260717.md`) is fixed and
should not be re-litigated; this is a distinct defect (epic-icon collision,
not live-set absence).

## Note
This commit (`35da569b7f`, documenter forward) bundles three tickets —
BL-475, BL-477, and BL-469 — in one combined architect/hardener batch
(`6a8ee5e1` "BL-475/BL-477/BL-469: hardening pass over the combined architect
batch"). BL-475 and BL-477 were independently verified and are clean (full
unit suite 316/316 files green, BL-462 acceptance 7/7, BL-477 acceptance
4/4, BL-469 acceptance 10/10 — none of the Gherkin scenarios exercise
cross-module icon-collision, which is why this defect passed every existing
test). Because all three tickets share this one commit, the bounce blocks
all three; BL-475's and BL-477's own work does not need to be redone, only
carried forward once the coordinator/documenter/hardener/architect/cleaner
chain re-merges the coder's fix.

The re-entry point is `coder` per protocol. The fix belongs wherever the
icon literals are chosen — either pick 2 replacement role glyphs that clear
BOTH `EPIC_ICON_POOL` and `KNOWN_EPIC_ICON` (re-verify against the live
Telegram set again, per the first bounce's lesson), or drop the "no
collision with epic icons" claim from the ticket's contract if the human
decides the two topic kinds are visually distinguishable by context alone —
that is a specifier/human call, not QA's to make.
