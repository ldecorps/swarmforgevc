# BL-945 hardener pass — 2026-08-19

## Reviewed commit
`46c0903fbf` ("BL-945: architect pass - bounce fix (D1/D2) verified,
forwarding to hardener"), merged into hardener as this parcel. Bounce
history: 1 architect bounce (D1: citation scanner missed non-backtick
citations in its own scanned corpus; D2: required_wiring anchor literal
did not actually appear in the file), both fixed by coder and
independently re-verified by architect against the actual gate tools.

## Scope, precisely
`git diff 0bfd52db4^ e0f7ddb4c1` (full parcel, both the original coder
commit and the bounce-fix commit) scoped to BL-945's own 7 files: the
landed `docs/branding/icon-system.md`, the two new test files, the new
step handler, the new pure `constitutionDocCitations.js`, `index.js`'s
registry line, and `project.prompt`'s two backtick-normalized citations.

## Tooling scope check
No `extension/src/*.ts` touched — Stryker/CRAP/DRY inapplicable, same as
the rest of this batch. `constitutionDocCitations.js` lives under
`specs/pipeline/steps/lib/`, not `extension/src`.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load averages 22–38 on 4 cores —
   the busiest this pass has seen all session. 5 of 6 changed files
   reported `DECISION: skip-busy`, `index.js` reported `skip-cooldown`.
   No formal mutation tooling applies regardless (no `extension/src`
   touched).
2. **Independent re-run of both test files**:
   - `npx vitest run test/constitutionDocCitations.test.js` — **6/6
     pass**.
   - `npx vitest run --config vitest.properties.config.mjs
     test/constitutionDocCitationsInvariant.property.test.js` — **4/4
     pass**.
3. **Acceptance, independently re-run**: this ticket's own feature —
   **4/4 PASS**, matching both architect passes.
4. **D1 fix, independently re-confirmed by hand** (not trusted from
   either evidence file): `grep -rn "docs/"
   swarmforge/constitution/articles/ | grep -v '\`docs/'` — exactly one
   line remains, the pre-existing bare `docs/` directory mention with no
   filename (`engineering-detailed.prompt:655`), correctly still
   unflagged. Confirmed `project.prompt`'s two citations are now fully
   backtick-enclosed, including the space-containing
   `Milestone Roadmap.MD` filename (the exact fragility the bounce
   warned a regex-widening fix would risk truncating — the fix instead
   took the simpler backtick-normalization path, sidestepping that risk
   entirely). Confirmed both citations actually resolve on `main`
   (`git cat-file -e` on both paths).
5. **D2 fix, independently re-confirmed against the real gate tool**: ran
   `bb swarmforge/scripts/pre_qa_gate_cli.bb BL-945 e0f7ddb4c1` myself —
   no `wiring` failure line (previously `PRE_QA_GATE_FAIL wiring ... does
   not contain "constitution/articles"`). The `ancestry ... stranded on
   swarmforge-architect/swarmforge-hardender` lines that do print are the
   same known artifact of invoking this CLI standalone against
   non-live-handoff branch tips that both the architect's bounce and
   fix-pass evidence already disclaimed — not a wiring signal, not
   re-litigated here.
6. **Landed-doc integrity**: `git diff
   origin/branding/epic-marks:docs/branding/icon-system.md
   docs/branding/icon-system.md` — empty, byte-identical, independently
   re-confirmed (not just trusted from the architect's report).
7. **Leak/process check**: 0 leaked `sfvc-bl945-*` fixture dirs, no stray
   tmux servers, `git status --short` clean.
8. **Scope discipline**: confirmed (by the same `git diff --stat` used to
   scope this review) that `epicIcon.ts`, `topicIcon.ts`, Architecture
   Rule 6's substance, and the icon-pool assets/generator scripts are
   untouched — matches the ticket's own out-of-scope list exactly.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. Both bounced
defects (D1, D2) independently re-verified fixed, D2 specifically against
the real mechanical gate tool rather than by inspection. All suites and
the acceptance feature reconfirmed green under my own hand. The landed
document's byte-identity and both project.prompt citations' actual
resolution on main independently spot-checked.

Forwarding to documenter.

By hardener.
