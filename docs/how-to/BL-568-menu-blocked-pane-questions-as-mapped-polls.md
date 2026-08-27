# Answering a menu-blocked pane from its Telegram steering topic

When a role pane is stuck on a Claude Code interactive menu
(`AskUserQuestion` and kin — numbered or checkbox options plus the
"Enter to select … Tab/Arrow … Esc" chrome), you no longer have to ferry
the question by hand or type blindly into the menu from Telegram. Chase
detects the block, the front desk posts a **non-anonymous poll** in that
role's steering topic (BL-425 `role-topic-map.json`), and only your
`poll_answer` drives the pane.

This is separate from BL-466 / BL-483 agent-questions (operator_ask /
Agent Questions topic) and from BL-607 `role_ask.bb` clarifying asks: those
are deliberate ask CLIs. BL-568 covers menus the agent raised **in the
pane** that would otherwise be invisible from the phone.

## What you see

1. Within one chase/sweep cadence after the menu appears, the role topic
   gets either:
   - a native poll whose options mirror the current menu step
     (multi-select mirrored when the menu uses checkboxes), or
   - a **text fallback** naming the RC session when Telegram poll caps
     cannot carry the menu honestly (>10 options, or question/option text
     that cannot truncate usefully under 300 / 100 char limits). No lying
     poll is posted.
2. Vote on the poll (principal only, same BL-425 gate as steers). The
   front desk re-captures the pane, checks the menu fingerprint still
   matches surface time, then injects keystrokes for exactly the voted
   options. A multi-step wizard repeats detect → surface → drive per step.
3. If you elect a free-text-shaped option ("Type something" / "Other" /
   kin), reply in-topic with the text **after** that poll; injection waits
   until the menu is in its text-entry state.

## Ordinary steers while menu-blocked

Do **not** type a normal steer into the topic while a menu poll is live —
it would land in the menu. The front desk suppresses those steers and
posts a BL-566 receipt:

```text
⚠ <role> is menu_blocked — see live poll <hint>
```

(or `… — answer the live menu poll in this topic` when no poll hint is
available). Answer the poll instead. Full receipt table:
[Steering a swarm role from Telegram](BL-566-steer-a-role-from-telegram.md).

## Stale menu or timeout

| Situation | What happens |
|---|---|
| Menu changed or cleared between poll and your vote | No keystrokes; topic gets an explanatory receipt |
| Await window elapses with no vote | Menu left untouched (never auto-answered); topic re-notified at most once |

## What this does not do

- It never picks an option for you — transport only (standing supervision:
  menu = BLOCKED; ask, don't pick).
- It does not answer menus for anyone other than the authorised principal.
- RC deep-links inside the poll message are out of scope (OSC 8 / BL-564
  cluster follow-up).
- Menus from tools other than Claude Code interactive prompts are out of
  scope.

Acceptance: `specs/features/BL-568-menu-blocked-pane-questions-as-mapped-polls.feature`.
