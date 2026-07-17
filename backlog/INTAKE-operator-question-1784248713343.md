# Intake: a question the Operator could not answer

> SPECIFIER STATUS 2026-07-17: NOT YET SPECCED — a clarifying question was posted to
> the human (OPERATOR/Concierge thread) via operator_ask.bb, pinning WHICH surface the
> orchestral icons target (PWA/owned-art vs Telegram stock-emoji stand-ins vs both);
> Telegram forum-topic icons cannot be arbitrary SVG glyphs, so the surface must be
> confirmed before speccing. `.swarmforge/operator/awaiting-answer.json` holds the
> pending question — DO NOT re-ask on a future drain; spec (or re-spec BL-469) only
> once the human answers.

Filed by the Operator (2026-07-17T00:38:33.343502239Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Human asked (Concierge thread, 2026-07-17 00:36Z), verbatim (typos as-sent): 'In fact, we had some orchestral icons for the agents, I forgot about that: can we pivot to using them?' — i.e. pivot the PER-AGENT icons to the owned orchestral/role-instrument glyphs instead of the current literal emoji.

OPERATOR FINDINGS (context, not a decision — specifier owns the call):
(1) The owned orchestra art the human is recalling EXISTS as untracked SVG/PNG in docs/branding/: glyph-sheet-v2.svg/.png (role-instrument glyph sheet), concept-e-orchestra.svg/.png, glyph-sheet-epics.svg. These are custom vector art, NOT Telegram emoji.
(2) This directly collides with PAUSED ticket BL-469 (backlog/paused/BL-469-per-agent-steering-topic-icons.yaml), which currently specs LITERAL per-role emoji chosen by the human earlier this session: coder=keyboard, specifier=note-taker, architect=grue, cleaner=broom, hardener=first-choice, QA=magnifier, documenter=books, coordinator=compass. So this is very likely a re-spec of BL-469, not a new epic.
(3) HARD PLATFORM CONSTRAINT already established & live-checked in BL-417/418/449 (2026-07-15: Telegram getForumTopicIconStickers = 112 performance emoji, NO instruments/notation, and topic icons cannot be arbitrary SVGs): the orchestral role-instrument glyphs CANNOT be set as Telegram forum-topic icons. They only live on the owned/PWA art surface. So 'pivot the agents to orchestral icons' is achievable on the PWA/owned-art surface but NOT on the Telegram per-agent topic icons — the specifier must first clarify WHICH surface the human means (Telegram topic icons vs the PWA/dashboard glyphs), because on Telegram it is platform-blocked and the literal-emoji BL-469 choice was the fallback FOR that reason.

ASK FOR THE SWARM: specifier to reconcile this against BL-469 and the docs/branding/ orchestra glyph system, and (if the target surface is ambiguous or the Telegram constraint bites) raise ONE clarifying question back to the human via the ask/answer loop rather than guessing. Spec/re-spec only after the surface is pinned.
