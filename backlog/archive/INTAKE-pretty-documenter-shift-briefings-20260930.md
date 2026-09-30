# INTAKE — pretty documenter shift briefings again

**Source:** human via Let's Talk, 2026-09-30 ~10:47 BST, verbatim:
"Est-ce qu'il y aurait moyen d'avoir le documenteur qui fait des jolis briefs comme c'était le cas, il y a une semaine ou plus avec en intro ce qui s'est passé pendant le shift et puis à la fin un petit, il y a des suggestions pour améliorer le process ce genre de choses, mais parce que là les derniers étaient vraiment moches."

Preceding turn, same conversation, also verbatim: the emails for about a week have been quite ugly; go back to the state of a week ago when it was pretty, with a small intro saying what happened during the shift, a pause, then a bit of ticket detail (opened, closed, and so on).

## What is wanted

The morning briefing email should again be authored by the documenter, in the shape of the briefings from about a week ago or earlier (narrative, readable on a phone):

1. A short intro that tells what happened during the shift.
2. Then the ticket detail: opened, closed, and the rest of the usual snapshot.
3. At the end, a short set of suggestions for improving the process.

The recent mails are the headless closing-ceremony dump (a raw git-activity list). That form is what the human called ugly. The cause: the ceremony deadline writes that dump, then the documenter is forbidden to write a second briefing.

**Ruling, human via Let's Talk, 2026-09-30 ~10:50 BST, verbatim:**
"C'est ça le fixe qu'il faut laisser. Il faut attendre que le documentaliste est fini avant de fermer le shift."

The fix to leave in place: do not close the shift, and do not publish the headless dump, until the documenter has finished the briefing.

## Constraint

Preserve these human sentences verbatim in any minted ticket (Article 5.3). Do not drop the suggestions-at-the-end ask, the intro-then-ticket-detail ask, or the ruling to wait until the documenter has finished before closing the shift.

## Disposition (specifier, 2026-09-30)

Drained 1:N (Article 5.3: every human sentence above is carried verbatim
into both tickets' `source:`).

- Root cause, traced at mint: the closing ceremony's own control pause
  (`freeze`, until its hard deadline) holds its "produce the morning
  briefing" note in the documenter's inbox (e9f91d6746, 2026-09-21), so the
  documenter can only start after the stop, when the headless dump is
  already on main. -> **BL-1835** (high, auto-approved), 810f0cd0e3.
- The human's ruling "Il faut attendre que le documentaliste est fini avant
  de fermer le shift", with the edge the specifier asked about answered
  "A: stop, no dump, documenter writes after restart (recommended)" ->
  **BL-1836** (high: it also owns BL-1640's standing red, found at mint):
  the ceremony lands the documenter's briefing the moment it exists, ends
  when the day is recorded as sent, and never writes a briefing itself.
- The shape asked for (intro of the shift, then ticket detail, then process
  suggestions at the end), and "never copy a headless briefing" ->
  `swarmforge/roles/documenter.prompt`, landed by the specifier with
  810f0cd0e3.
