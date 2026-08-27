# BL-425 bounce evidence — 2026-07-16

1. **Failing command**: source-vs-doc comparison (no marker logic exists anywhere
   in the shipped diff):
   ```
   git diff c7a76861..c9c931db5f --stat            # documenter's own commit: docs/Specification.MD only
   git diff c7a76861..c9c931db5f -- extension/src | grep -n "startsWith\|marker\|'!'\|\"!\""
   # => no output: zero marker-handling code anywhere in the feature
   ```
   Confirmed directly in `extension/src/tools/telegramFrontDeskBotCore.ts`'s
   `decideSteeringAction` (lines ~278-294): it checks topic-scope, then the
   principal guard, then returns `{kind:'redirect', role, text}` for ANY
   non-empty text — no `!`/marker branch exists.

2. **Commit hash**: `c9c931db5f24cca004efb39b913b2d2b5ab0a963` (documenter's
   commit, the one cited in the QA handoff).

3. **First error excerpt** (docs/Specification.MD, BL-425 entry):
   > "**Every swarm role now has its own standing Telegram steering topic, and
   > an explicit `!`-marked message in it interrupts that role's live pane
   > (BL-425 slice 1).**" ... "a `!`-prefixed message posted in one interrupts
   > that role's pane on its phone-visible topic."

   vs. the SAME paragraph's own body, three sentences later:
   > "...plus the `!`-prefix mode selector that will make an unmarked message
   > default to QUESTION instead of always resolving to REDIRECT **as it does
   > in this slice**."

   The headline and closing sentence claim a `!` marker is required to
   interrupt; the paragraph's own body — and the code — say the opposite: in
   slice 1, EVERY authorised message in a role topic resolves to REDIRECT,
   marked or not.

4. **Failure class**: `behavior` (documentation misrepresents shipped
   behavior — an intent/description mismatch, not a compile/test failure).

5. **Expected vs observed**: Expected — the doc's headline/closing sentences
   accurately state that slice 1 treats every authorised message in a role
   topic as a redirect (no mode marker exists yet). Observed — those two
   sentences claim an explicit `!` marker gates the redirect, contradicting
   both the shipped code and the same paragraph's own body text. This is
   materially misleading for a DISRUPTIVE, pane-interrupting feature: a human
   reading only the summary could believe an unmarked message is safe/non-
   disruptive in a role topic, when it is not.

All other verification passed: full unit suite green (295 files / 4439 tests,
7.5s), all 8 acceptance scenarios for
`specs/features/BL-425-per-agent-telegram-steering-topics.feature` passed,
lineage/ancestry confirmed (coder 14f991d1, cleaner 0041f1a7, architect
5fcfa04e, hardener b4cd147b all ancestors of c9c931db5f), no prior bounce
evidence on `main` for BL-425, and the redirect path is genuinely wired live
(`ensureRoleTopics`/`readRoleTopicMap`/`redirectToRole` reached from the real
poll loop in `telegram-front-desk-bot.ts`, `decideSteeringAction` reached from
`processMessageUpdate` in `telegramFrontDeskBotCore.ts`). The ONLY defect is
this documentation inaccuracy.
