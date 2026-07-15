# Intake: visual cue on BL topic icons for tickets awaiting human approval

Filed by the coordinator (2026-07-15, immediately after the human approved
BL-421/BL-422/BL-423 via Telegram) — human's own words, appended to the
approval replies: "Also: visual cue on the BL icons that need approval." This
is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## Context (verified against the live code, not from memory)

- The existing per-ticket icon automation is `resolveIconState` /
  `ICON_EMOJI` in `extension/src/concierge/topicIcon.ts` (BL-342, extended by
  BL-417/BL-418): it maps a ticket's FOLDER (done/active/paused) and TYPE
  (feature/defect) to an icon (✅ done, 🦠 defect-in-flight, 🔍 paused, 💡/🎵
  feature-in-flight). Confirm at build time whether this table has changed
  since 2026-07-15.
- `human_approval` is a separate field on the ticket YAML
  (`pending` / `approved`), orthogonal to the folder-based state the icon
  system currently reads — grep confirms `resolveIconState` does not
  currently consult it. A ticket can sit in `backlog/paused/` fully written
  and spec'd, with `human_approval: pending`, indistinguishable by icon from
  any other paused ticket — the human has no glanceable way to see, from the
  topic list, which paused tickets are blocked ONLY on their approval
  (actionable by him right now) versus blocked on something else (a
  dependency, an overlap hold, a deliberate parking note like BL-101).
- Recent concrete instances of this gap: BL-421 sat `human_approval: pending`
  for part of this session before the human approved it; BL-410/BL-416 are
  currently paused waiting on a dependency (BL-409), not on approval — the
  two "why is this paused" reasons look identical in the topic list today.

## What the specifier should scope

Whether/how to add a distinct visual marker (an icon overlay, a title suffix,
or a dedicated glyph within Telegram's free sticker set — same
resolve-or-skip-against-the-live-set posture BL-342/BL-417/BL-418 already
use) specifically for a paused ticket whose `human_approval` is `pending`,
so it reads differently from a paused ticket held for any other reason.
Overlaps the known topic-hook cluster (`topicIcon.ts` / `conciergeTick.ts`) —
note this for coordinator serialization against BL-414/BL-417/BL-418 if it
becomes a real ticket.

Out of scope for this intake note (specifier's call whether to fold in or
split out): anything beyond the icon/visual cue itself — no new approval
workflow, no change to how `human_approval` is set.
