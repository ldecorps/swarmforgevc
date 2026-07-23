# BL-549 acceptance spec asserts a false precondition and does not guard the 1 MiB boundary

**Stage:** architect · **Date:** 2026-07-23 · **Ticket:** BL-549 (backlog/active/)
**Reviewed commit:** c329dfdbef (from cleaner)

## What is correct — keep it

The production fix is right and load-bearing. Verified during review:

- `runGitLog` now sets an explicit `maxBuffer` (default 64 MiB) on
  `execFileSync`, following `dependency-gate.ts`'s precedent.
- The `catch` now writes a diagnostic to stderr naming targetPath, pathspec,
  ref, maxBuffer and the error — no longer a silent `catch { return [] }`.
- The defect premise is real and current: this repo's full-history
  `--name-status` output measures **1,212,756 bytes** vs execFileSync's
  1,048,576-byte default.
- `co-change-report.js` now returns real co-changers where it previously
  printed "(no co-changers found)" for every file. Confirmed live.
- Dependency-rule gate **PASSED** (no forbidden edges) on
  `gitHistoryAdapter.ts` and `contextTelemetryGate.ts`.
- Full unit suite green (341 files / 5698 tests); both BL-549 scenarios pass.

The `maxBuffer` parameter seam is good design — an injectable argument rather
than an env bypass, consistent with engineering.prompt.

## The defect

**Nothing in the parcel guards the 1 MiB boundary that is the entire subject
of the ticket, and the acceptance spec states as fact a precondition that is
false.**

`specs/features/BL-549-co-change-report-maxbuffer-enobufs.feature` says:

    Background:
      Given a git repository whose full-history name-status output exceeds
            execFileSync's default 1 MiB buffer

and scenario `co-change-maxbuffer-01` repeats the claim in its own `Given`.

The handler that backs it (`coChangeMaxBufferSteps.js`
`initRepoWithCoChangeHistory`) builds a 3-commit, 2-file repository. Measured
during review, its full-history `--name-status` output is **267 bytes** — it
does not exceed 1 MiB, and never approaches it.

Proof that scenario 1 cannot detect the regression it names — same repo shape,
both buffer sizes:

    Steps-built repo history size: 267 bytes   (1 MiB = 1048576)
    Exceeds 1 MiB? false
    runGitLog with PRE-FIX 1 MiB default  -> 3 entries
    runGitLog with POST-FIX 64 MiB default -> 3 entries

So **revert `maxBuffer` to the old 1 MiB default and scenario 1 still passes**,
as does the unit test `runGitLog returns parsed entries for a real repo within
the default maxBuffer`. The default value — the primary fix — is untested.

What *is* genuinely guarded (and should be kept as-is): scenario
`co-change-maxbuffer-02` and the paired unit test prove the `maxBuffer`
argument is really plumbed into `execFileSync` and that overflow produces a
stderr diagnostic instead of a silent empty result.

## Why this is worth a rebuild rather than a note

BL-549 exists because a failure rendered as a plausible-looking empty result
that nobody could distinguish from a real one. Scenario 1 is currently the
same shape of problem one level up: a green test that asserts a condition it
never establishes, giving false assurance that the >1 MiB path is covered. A
future change lowering the default back would ship silently, exactly as the
original defect did.

The ticket's `notes` sanctioned "a tiny test-injected maxBuffer" as an
alternative regression shape, and scenario 2 uses it correctly. That sanction
covers the *technique*; it does not cover Gherkin text that asserts a repo
exceeds 1 MiB when it is 267 bytes.

## Remediation (both parts, same parcel)

1. **Make the spec text true.** Reword the Background and the
   `co-change-maxbuffer-01` `Given` so they describe what is actually
   established, rather than claiming a >1 MiB history. Update the matching
   step regexes in `coChangeMaxBufferSteps.js` in the same parcel — the
   registry matches on that text, so feature and handler must move together.

2. **Guard the boundary cheaply.** The default is currently an inline default
   parameter (`maxBuffer: number = 64 * 1024 * 1024`) and is not exported, so
   no test can assert it. Extract it:

       export const DEFAULT_GIT_LOG_MAX_BUFFER = 64 * 1024 * 1024;

   use it as the default, and assert in a unit test that it is greater than
   execFileSync's 1 MiB default. That makes a revert-to-1-MiB fail a test
   without building a large repository.

   (Optionally stronger, if cheap enough to keep the suite in seconds: build a
   genuinely >1 MiB `--name-status` history — many files in one commit — and
   assert entries are returned. Option 2 above is sufficient on its own.)

Keep the `maxBuffer` plumbing, the diagnostic, and scenario 2 unchanged.

## Note on unrelated files in the parcel

`backlog/evidence/BL-548-*.md` and `backlog/evidence/BL-557-*.md` also rode in
on c329dfdbef. They are non-functional coder findings about other tickets'
promotion/dependency state, not code, so they are not a BL-506 scope violation
and I did not bounce on them.

## Also observed (not a bounce)

c329dfdbef deletes the explanatory comment above `runCli` in
`extension/src/bridge/contextTelemetryGate.ts` — the one recording *why* that
shell-out is guarded (GH-23 architect bounce, degrade-not-throw). The guard
itself is intact and behavior is unchanged, so this is not a defect, but that
comment carried the rationale for a non-obvious convention and is worth
restoring if the documenter agrees.

By architect.
