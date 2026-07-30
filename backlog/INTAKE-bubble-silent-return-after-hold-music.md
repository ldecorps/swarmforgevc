# Raw intake — Bubble returns silent after hold music (no spoken reply)

Status: new intake, not minted. Normal defect, not expedite.

Trigger
- Human via Let's Talk 2026-07-30.
- Pattern: human asks a question; Bubble goes off to think or use tools;
  hold music plays; music stops; Bubble comes back with no spoken answer.
- Human hears silence instead of a reply. Confirmed as a defect, not critical
  enough to expedite.

## Goal

After any working / hold-music interval, Bubble always speaks a short reply
(or an explicit failure line). Silent return after hold music must not happen.

## Problem today

- Hold music correctly signals “working.”
- When work ends, playback can stop without starting reply speech.
- Human cannot tell whether the turn failed, was empty, or is still pending.
- Has happened more than once in live Let's Talk use.

## Likely failure classes to investigate

1) Agent finished with no speakable text (empty or non-voice content).
2) Reply audio was produced but playback never started after hold music stop.
3) Turn ended / session advanced without a final speak step.
4) Error path stops hold music and swallows the user-facing utterance.

## Requested outcome

- Every completed agent turn that used hold music ends with audible speech,
  even if only a short status or error line.
- If speakable text is missing, synthesize a fallback: “I finished that check
  but I have nothing to say yet,” or “I hit an error and could not answer.”
- Never leave the human on silence after hold music ends.
- Prefer a loud, testable handoff: hold-music stop → reply start, with no
  silent gap that reads as “done talking.”

## Acceptance shape to refine

1) After a tool-using turn that plays hold music, reply speech always starts
   when hold music stops (or within a tight bounded gap).
2) If the agent returns empty speakable content, a fallback spoken line plays.
3) If reply playback fails, a distinct spoken or UI failure is surfaced; hold
   music does not just end into silence.
4) Reproduced at least once in Bubble / Let's Talk with evidence of the
   failing branch (empty text vs playback fail vs missing final speak).

## Non-goals

- Not an expedite / ambulance / depth-cap change.
- Not barge-in (separate intake).
- Not redesigning hold-music catalog or volume defaults.

## Related

- Existing voice barge-in intake (interrupt while speaking) — different gap.
- Hold music / reply player path in the Android floating companion.
