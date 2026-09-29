# Headless closing-ceremony briefing's "Recent git activity" renders as one unbroken paragraph

**Artifact:** Daily briefing email (`docs/design/artifact-inventory.md`
row 1), specifically the variant produced by the headless/no-agent
closing-ceremony composer (`swarmforge/scripts/banked_briefing_lib.bb`,
`compose-banked-briefing`), which writes `docs/briefings/<day>.md`
directly (no coordinator/documenter prose pass). This composer's output
still goes through the ordinary send pipeline
(`briefing_email_lib.bb`'s `render-briefing-html` /
`markdown-to-html-lib/render-markdown-to-html`), the same as every other
briefing.

**What is wrong, as a human sees it:** the composer emits each git log
line as its own line of plain text with no leading `- ` bullet marker
and no blank line between entries (confirmed in
`docs/briefings/2026-09-27.md`, `2026-09-26.md`, and every earlier
closing-ceremony file checked back to `2026-09-25.md`). CommonMark
collapses consecutive non-blank lines with no bullet syntax into a
single paragraph, so the rendered email's "Recent git activity" section
is not a list at all — it is one unbroken `<p>` of ~30 commit
messages run together with single spaces, no line breaks, no visual
separation between commits. Rendering `2026-09-27.md` through the real
`render-briefing-html` pipeline produces a single paragraph 17,309
characters long with zero line breaks. Excerpt (first ~250 chars of that
paragraph, exactly as it appears in the rendered HTML body):

> 7311c620f7 BL-1789: mint - a vanished role session names how its agent
> ended (launch script records agent start/exit; session-missing CRIT
> appends the newest entry) ef28cd1655 BL topic record for BL-1789
> fbc1c1b053 BL topic record for BL-1708 c8165d7ca5 Promote BL-1708:
> paused → active for coder d5875013ef BL topic record for BL-1781 ...

On a ~390px phone mail client this is an unreadable wall of text: no
commit is visually separable from the next, the BL-1442 "bold the
leading ticket id" rule cannot even apply (there is no `<li>` for it to
find), and a reader cannot scan for a specific commit or ticket id at
all. This affects every closing-ceremony-composed briefing, which per
`docs/briefings/.sent.json` is currently landing several nights a week
(most recently 2026-09-26 and 2026-09-27, both sent with no art-director
sign-off recorded on either).

**Intended result, in observable terms:** each git log line in a
headless-composed briefing appears as its own visually separated line
in the sent email — either a real Markdown list (`- <line>` per commit,
one `<li>` per commit, consistent with the existing bulleted-list
handling and the BL-1442 bold-ticket-id rule) or, at minimum, a hard
line break the renderer preserves per source line. A reader opening the
email on a phone must be able to see where one commit ends and the next
begins without scanning character-by-character.

**Constraints of the surface:** phone mail client, ~390px effective
width (system.md's existing "Bounded single column, max-width:640px"
rule); no `<style>` blocks; CommonMark's soft-line-break behaviour
(a single trailing newline is not preserved as a visible break by
`markdown-to-html-lib`) is the actual mechanism causing the collapse, so
the fix belongs in how `compose-banked-briefing` formats
`git-activity-lines`, not in the render/email layer, which already
handles proper Markdown lists correctly for the header/backlog sections.

**Scope note:** this is a defect in the *headless* composer's Markdown
formatting only, not the ordinary coordinator/documenter-composed
briefing path (spot-checked `docs/briefings/2026-09-20.md`, which is
prose with proper section headers and does not exhibit this).
