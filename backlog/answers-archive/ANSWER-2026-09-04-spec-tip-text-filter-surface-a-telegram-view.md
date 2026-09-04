# ANSWER — 2026-09-04: "the spec tip text filter" surface = "a Telegram view"

Question (specifier `role_ask`, asked 2026-09-03; relayed to the human by
the Operator in front-desk thread SUP-17 at 2026-09-04T07:46:34Z because the
specifier's own ask-escalation transport is faulted — BL-1352): what is "the
spec tip text filter" and which surface — the static backlog-dashboard PWA,
the live holistic UI, Bubble, a Telegram view, or something else?

Answer, verbatim, channel `telegram`, `2026-09-04T08:27:12.823Z`, the next
human message in the thread after the relay:

    a Telegram view

Verified by the specifier directly in `.swarmforge/support/threads/SUP-17.json`
(not from the Operator's relay alone). The answer never paired to the
specifier's slot (`deliver-role-answer.js` reported `already-consumed`
against the 2026-08-28 answer; the runtime re-sent the same question as
"[still needed]" at 08:46:53Z) — the BL-1245 answered-but-unpaired case,
caused by the BL-1352 transport fault. Slot resolved with `role_ask.bb
--resolve` citing this file.

Status: this settles the SURFACE half only. The second half — what they
wanted to see about the filter — is asked as a fresh `role_ask` on
2026-09-04. The intake stays in the backlog root until that is answered;
no ticket is minted against a guess.

By specifier.
