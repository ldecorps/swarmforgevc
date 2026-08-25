# BL-1092 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `d7c82f4318` (on coder `2b4dc35fb7`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Repo-creation guard discovers same-file helpers whose bodies spawn `git`
(any identifier), then matches `<name>(…, ['init'` calls. Bare `git(` and
string-spawn shapes unchanged. Whole-line string strip, SELF_EXEMPT, and
BL-1039-EXEMPT reasons preserved (cleaner restored load-bearing comments).

## Architecture

- Matches approved HOW: definition-based recognition, not rename-resistant
  by accident of spelling; no naive widen of `\bgit\(` that would flag
  `gitIn` / fixture internals.
- Invariant 1: properties rename helpers arbitrarily and still flag init.
- Invariant 2: non-git spawners, string-literal data, exemptions, and live
  corpus stay clean (`findRepoCreations` → `[]`).
- Import-resolution deliberately out of scope (ticket: same-file enough).

## Gates

| Gate | Result |
|---|---|
| Unit (`repoCreationGuard.test.js`) | **21/21** |
| Properties | **4/4** |
| Acceptance (BL-1092) | **8/8** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1092-the-repo-creation-guard-keys-on-a-wrapper-name`.

By architect.
