# BL-1060 — coder pass, 2026-08-22: scenario 05 was unsatisfiable as written

Status: **RESOLVED.** The specifier amended the feature file at `47397456a`
("Amend BL-1060 scn05: assert each surface's own buttons, not an impossible
topic web_app"). After merging main, the feature runs **9 passed, 0 failed**,
alongside 60 unit tests, 4 property tests, and a fully green default unit lane
(467 files / 8275 tests). The parcel was then forwarded to the cleaner.

The record below is kept as filed, because the reasoning is what the
amendment was made from. Reported under Article 4.4 (spec gaps leave by note,
never a parcel bounce) rather than worked around in the handler.

## What is green

7 of 8 acceptance scenarios pass, plus 60 unit tests and 4 property tests.
Scenarios 01, 02, 03, 04 and 05's `Console` row all pass. `npm run compile` is
clean.

## The one that cannot

```gherkin
# BL-1060 pairing-button-scheme-05
Scenario Outline: The mini app buttons are unaffected
  When the "topic" keyboard is built
  Then it still offers the "<mini app>" button

  Examples:
    | mini app     |
    | Resident Spy |
    | Console      |
```

The `Resident Spy` row asserts about the **topic** keyboard. What the two
builders actually emit, read off the compiled tree at this commit:

```
TOPIC   : [ {text: "Open in browser",       url:       .../console?bearer=abc} ,
            {text: "Update Bubble pairing", url:       .../pair?token=abc} ]

PRIVATE : [ {text: "Open console",          webAppUrl: .../console?bearer=abc} ,
            {text: "Live screen",           webAppUrl: .../resident-spy?bearer=abc} ,
            {text: "Update Bubble pairing", url:       .../pair?token=abc} ]
```

The topic keyboard has never carried the Resident Spy live URL. It carries the
console URL and the pairing URL, and nothing else. So the `Console` row passes
and the `Resident Spy` row cannot — not because BL-1060 changed anything (it
changed only the `url:` field of the pairing button on both surfaces), but
because the assertion names a button that surface does not have and did not
have before this ticket either.

## Why it is a spec defect and not a code defect

`residentSpyTunnelNotify.ts` says it in the source, above the private builder:

> `/** web_app buttons work only in a private chat with the bot. */`

and above the topic builder:

> `/** Group/forum topics cannot use web_app buttons — url opens the system browser. */`

**Mini app buttons are `web_app` buttons, and a forum topic cannot have one.**
The scenario is titled "The mini app buttons are unaffected", and the mini app
buttons live — can only live — in the **private DM** keyboard. Reading `topic`
there asserts the opposite of what the scenario is named for.

## Proposed amendment (specifier's call)

One word, in the `When`:

```gherkin
  When the "private DM" keyboard is built
```

Both rows then assert what the scenario says: the two `web_app` mini app
buttons on the surface that has them, still present after the `url:` swap.
Confirmed against the builders — `private DM` + `Resident Spy` and
`private DM` + `Console` both pass with the handler exactly as written; the
step handler already knows both surfaces and both mini apps, so no handler
change is needed. Verified end to end: with that one word changed the feature
runs **8 passed, 0 failed**. The feature file was then restored unmodified —
the specifier owns Gherkin, and the coder does not hand-author it.

An alternative reading — keep `topic` and drop the `Resident Spy` row — also
works, but loses the coverage that BL-1060's swap did not disturb the Resident
Spy mini app button, which is the thing the scenario exists to check.

## What the coder did with the parcel

Held it until the amendment landed. The behaviour change, its unit tests, its
property tests and its step handler were committed at that point but NOT
forwarded, because forwarding a red acceptance gate pushes the defect
downstream.

The amendment arrived exactly as BL-317/BL-325 prescribes — a priority-00 note
to the holder of the parcel — and the holder merged `main` FIRST. That order
matters here and is not ceremony: the amended feature file existed only on
main, so re-running the gate against this worktree's stale copy would have
re-confirmed the old failure and read as the specifier not having fixed it.

## What the specifier changed

Better than the amendment proposed above. Rather than moving the whole outline
to `private DM`, the Examples table now pairs each surface with the apps that
surface actually carries:

```gherkin
    Examples:
      | surface    | app          |
      | topic      | Console      |
      | private DM | Console      |
      | private DM | Resident Spy |
```

That keeps the topic-surface coverage the single-surface fix would have lost,
and the scenario is renamed to "Every other button each surface carries is
unaffected", which is what it now asserts. No step-handler change was needed —
the handler already resolved a mini app by the URL its button opens rather
than by button text, so both surfaces and both apps were already known
values.
