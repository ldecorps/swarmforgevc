# BL-927 — reclassify 3 gherkin survivors: host-masked, not BL-234 equivalent

## Context
Hardening pass `2a1a5e212` recorded 3 surviving `<box owner>` Examples-column
gherkin mutants (m1, m5, m9) as BL-234 equivalent mutants. The specifier's
`swarmforge/roles/hardender.prompt` amendment `6d7b87e71` corrected this: the
probe (case-insensitive volume masking the case-flip) explains why the
mutants survive, but does not make them equivalent under BL-234, which
requires the equivalence to be demonstrable from the code — interchangeable
by design, with no assertion able to ever differentiate. An assertion on a
case-sensitive volume WOULD differentiate. This is a third category:
**host-masked**.

## Evidence (re-verified this pass)
```
$ touch CaseTestFile_XYZ && ls casetestfile_xyz
-rw-r--r--  1 ldecorps  wheel  0 19 Aug 03:31 casetestfile_xyz
```
Confirms this worktree's root volume (APFS) is case-insensitive: `ls`
resolves the differently-cased name onto the same file. The BL-927 fixture's
`queueParcel` (`specs/pipeline/steps/bl927RotateGateLiveIdentitySteps.js`)
writes the parcel directly to
`path.join(dir, '.swarmforge', 'handoffs', role, 'inbox', 'in_process')`
using the raw `<box owner>` string with no normalization, so a case-flipped
example value (`cOder`, `codeR`, `cleAner`) collides on-disk with the real
`coder`/`cleaner` mailbox on this host, and no assertion here can observe the
mutation.

## Reclassification
m1 (`cleaner` → `cleAner`), m5 (`coder` → `cOder`), m9 (`coder` → `codeR`):
**HOST-MASKED**, not BL-234 equivalent. Same fixture mechanism as the
amendment's own worked example.

## Code-path check (per the amended rule's required follow-up)
Question: does the production path-building code derive the role name from
a fixed known set, or normalize case, before building the mailbox path — or
does it trust arbitrary casing?

Traced the real call chain `departing-role-blocking-handoff` ->
`load-role-info` -> `mailbox-dir`/`mailbox-base-dir`
(`swarmforge/scripts/handoff_lib.bb:272-291,255-270`):

- `load-role-info` matches a candidate role name against `roles.tsv` rows
  with **exact string equality** (`(= role role-name)`, line 287) — not a
  case-insensitive or normalized comparison. No row match -> `nil`.
- `mailbox-base-dir`/`mailbox-dir` never build a path from the raw candidate
  string directly. They build it exclusively from the **resolved
  `role-info`** (`:worktree-path`, `:role` off the matched tsv row) — i.e.
  only ever the fixed, known, exact tsv value, never an unresolved or
  case-varied caller-supplied string.
- The one raw, un-fixed-set input is `resident-live-role`
  (`handoff_lib.bb:615-642`), which regex-extracts the launch-script name
  straight off the live pane's actual `pane_start_command`
  (`launch/([^/]+)\.sh`) with no case normalization. But that extracted
  string is *never* used to build a path directly either — it is passed
  through `load-role-info` first (`departing-role-blocking-handoff`,
  `handoff_lib.bb:692`), which applies the same exact-match gate. A
  case-mismatched live identity (e.g. a pane launched as
  `launch/Coder.sh` on a case-insensitive host, which the OS runs
  successfully despite the mismatch) fails the exact match, returns `nil`,
  and the function falls through to `{:role nil :blocking-file nil}` —
  the same documented, deliberate fail-open path BL-805/BL-921 already
  specify for any unresolvable identity.

**Conclusion: it derives the role name from a fixed known set (exact match
against `roles.tsv`) and never builds a mailbox path from arbitrary-cased
input.** A case mismatch degrades to the existing, intentional fail-open
behavior (a real but already-accepted gap: BL-805/BL-921's own known limit,
not a new one this survivor reveals) rather than silently resolving to a
wrong or colliding path. No new `type: defect` ticket warranted from this
BL-927 survivor.

By hardener.
