# BL-534 hardener pass — clean rematch tip e01e030670

**Architect tip:** `e01e030670` (discard impure `9a7f39661d` per architect note)
**Hardener tip:** (this commit)
**Task:** `BL-534-thin-main-crap-visible-cli-gate`

## Gates

| Gate | Result |
|------|--------|
| Unit + CLI | 49/49 |
| Properties | 2/2 |
| APS | 4/4 |
| Dogfood parcel on self | exit 0 |
| Soft Gherkin stamp | Outline 6/6 killed (manifest present) |

## Surgical (restored)

| Mutant | APS | Verdict |
|--------|-----|---------|
| `MAX_MAIN_COMPLEXITY = 99` | fail | killed |

Also killed on prior impure tip (same product): parcel allowlist consult, shrink-always-true, decisionPointDelta=0.

## Note

Prior hardener tip on impure `9a7f39661d` discarded; this tip is hitchhike-free vs origin/main.
