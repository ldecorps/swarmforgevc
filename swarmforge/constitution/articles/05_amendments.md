# Article 5: Amendments

## 5.1 Process
1. Create a new article in `swarmforge/constitution/articles/` (e.g., `99_proposed_change.md`).
2. Route it to the **specifier** via `git_handoff` with priority `00`.
3. The **specifier** incorporates approved constitution changes into spec/prompt
   files; **QA** lands them on `main` after approval and the coordinator does
   backlog bookkeeping (BL-247).

## 5.2 Voting (if needed)
- For controversial changes, the **coordinator** may call a vote among roles.
- Majority approval is required.

## 5.3 A Consolidation Never Drops A Human Sentence
- When intakes or tickets are merged, split, or otherwise reshaped before
  entering the pipeline, every directive quoted from a human survives
  verbatim into the resulting ticket(s); a consolidation that cannot
  preserve one is refused rather than trimmed. Binds the ACT of
  consolidating, not any one office. Ratified 2026-07-26 (BL-681). See
  **05-amendments-detailed.md** for the full rationale.
