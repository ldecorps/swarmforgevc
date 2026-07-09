# Article 4: Quality Gates

## 4.1 Pipeline Gates
1. **Specifier** – Acceptance criteria defined.
2. **Architect** – Design review passed.
3. **Hardener** – 100% test coverage, no surviving mutants, CRAP < 5.
4. **QA** – Final approval before merge.

## 4.2 Merge Criteria
- All gates must pass.
- No regressions in existing functionality.
- Documentation updated.
- QA notifies the coordinator; the coordinator integrates on `main` (not the specifier).

## 4.3 Rejection Protocol
- If a gate fails, the parcel is routed back to the appropriate role with a `note` explaining the issue.
